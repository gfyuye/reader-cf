import { jsonResponse } from "../http";
import { resolveUserNs } from "../auth";
import { Env } from "../types";
import * as documentHandlers from "../handlers/document";
import { indexEpubIntoDatabase } from "../handlers/epub";
import { decodeTxtBytes, scanTxtChapterOffsets } from "../handlers/txt";
import { triggerOnChangeSync } from "./webdav";

export async function handleChunkedUploadInit(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });
  const body = await request.json<any>();
  const { fileName, fileSize, totalParts, mimeType, target, path } = body || {};
  if (!fileName || !fileSize) {
    return jsonResponse({ isSuccess: false, errorMsg: "缺少上传参数" });
  }
  const cleanPath = (path || "/").replace(/^\/+/, "").replace(/\/$/, "");
  const safeName = fileName.replace(/[/\\?%*:|"<>]/g, "_");

  let r2Key = "";
  if (target === "webdav") {
    r2Key = cleanPath ? `webdav/${userNs}/${cleanPath}/${safeName}` : `webdav/${userNs}/${safeName}`;
  } else {
    r2Key = `webdav/${userNs}/book/${safeName}`;
  }

  let contentType = mimeType || "application/octet-stream";
  const lower = safeName.toLowerCase();
  if (lower.endsWith(".epub")) contentType = "application/epub+zip";
  else if (lower.endsWith(".txt")) contentType = "text/plain; charset=utf-8";
  else if (lower.endsWith(".pdf")) contentType = "application/pdf";

  try {
    const mp = await env.BUCKET.createMultipartUpload(r2Key, {
      httpMetadata: { contentType },
    });
    return jsonResponse({
      isSuccess: true,
      data: {
        uploadId: mp.uploadId,
        key: mp.key,
        chunkSize: 10 * 1024 * 1024,
      },
    });
  } catch (err: any) {
    return jsonResponse({ isSuccess: false, errorMsg: err.message || "初始化分片上传失败" });
  }
}

export async function handleChunkedUploadPart(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const url = new URL(request.url);
  const uploadId = url.searchParams.get("uploadId") || request.headers.get("X-Upload-Id") || "";
  const key = url.searchParams.get("key") || request.headers.get("X-Key") || "";
  const partNumberStr = url.searchParams.get("partNumber") || request.headers.get("X-Part-Number") || "1";
  const partNumber = parseInt(partNumberStr, 10);

  if (!uploadId || !key || isNaN(partNumber) || partNumber < 1) {
    return jsonResponse({ isSuccess: false, errorMsg: "分片参数缺失" });
  }

  let partBytes: Uint8Array;
  const contentType = request.headers.get("Content-Type") || "";
  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    const fileEntry = formData.get("file");
    const file = fileEntry as unknown as File;
    if (!file || !(file instanceof File)) return jsonResponse({ isSuccess: false, errorMsg: "缺少分片数据" });
    partBytes = new Uint8Array(await file.arrayBuffer());
  } else {
    partBytes = new Uint8Array(await request.arrayBuffer());
  }

  try {
    const mp = env.BUCKET.resumeMultipartUpload(key, uploadId);
    const uploaded = await mp.uploadPart(partNumber, partBytes);
    return jsonResponse({
      isSuccess: true,
      data: {
        partNumber,
        etag: uploaded.etag,
      },
    });
  } catch (err: any) {
    return jsonResponse({ isSuccess: false, errorMsg: err.message || "上传分片失败" });
  }
}

export async function handleChunkedUploadComplete(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });
  const body = await request.json<any>();
  const { uploadId, key, parts, fileName, fileSize, target } = body;

  if (!uploadId || !key || !Array.isArray(parts)) {
    return jsonResponse({ isSuccess: false, errorMsg: "参数缺失" });
  }

  try {
    const mp = env.BUCKET.resumeMultipartUpload(key, uploadId);
    await mp.complete(parts);

    // 上传阶段：只负责文件合并和存储，不做书籍解析，不保存书架
    // 所有书籍解析由 handleImportWebdavBook 独立完成
    triggerOnChangeSync(env, userNs, ctx);
    return jsonResponse({
      isSuccess: true,
      data: { key, name: fileName, size: fileSize },
    });
  } catch (err: any) {
    return jsonResponse({ isSuccess: false, errorMsg: err.message || "合并分片失败" });
  }
}

export async function handleImportWebdavBook(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });
  const body = await request.json<any>();
  const { path } = body || {};
  if (!path) return jsonResponse({ isSuccess: false, errorMsg: "缺少文件路径" });

  // 导入书架阶段：检查重名、转移文件、解析书籍、保存书架
  const shelf: any[] = (await documentHandlers.getDocument(env, userNs, "bookshelf.json")) || [];
  const fileName = path.split("/").pop() || path;
  const safeName = fileName.replace(/[/\\?%*:|"<>]/g, "_");
  const lowerName = safeName.toLowerCase();

  // 检查书架中是否已有同名的本地书籍
  const existingIdx = shelf.findIndex((b) => b.name === fileName && (b.origin === "local-epub" || b.origin === "local-pdf" || b.origin === "local-txt"));
  if (existingIdx >= 0) {
    return jsonResponse({ isSuccess: false, errorMsg: `书架中已存在同名书籍《${fileName}》，请先删除或重命名` });
  }

  // 将文件从 WebDAV 路径移动到 book 文件夹
  const sourceKey = path.startsWith(`webdav/${userNs}/`) ? path : `webdav/${userNs}/${safeName}`;
  const bookKey = `webdav/${userNs}/book/${safeName}`;
  const fileObj = await env.BUCKET.get(sourceKey);
  if (!fileObj) return jsonResponse({ isSuccess: false, errorMsg: "源文件不存在，请先上传" });
  const bodyBytes = new Uint8Array(await fileObj.arrayBuffer());
  const fileSize = bodyBytes.byteLength;
  await env.BUCKET.put(bookKey, bodyBytes, {
    httpMetadata: lowerName.endsWith(".epub") ? { contentType: "application/epub+zip" } : lowerName.endsWith(".pdf") ? { contentType: "application/pdf" } : { contentType: "text/plain; charset=utf-8" },
  });
  await env.BUCKET.delete(sourceKey);

  const now = Math.floor(Date.now() / 1000);
  const bookId = `local_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  let newBook: any;

  if (lowerName.endsWith(".epub")) {
    const { title, author, totalChapters } = await indexEpubIntoDatabase(env, userNs, bookId, fileName, bookKey, fileSize);
    const displayTitle = title || safeName.replace(/\.epub$/i, "");
    newBook = {
      name: displayTitle,
      author: author || "未知作者",
      bookUrl: `local-epub:${bookId}`,
      origin: "local-epub",
      originName: "本地 EPUB",
      tocUrl: `local-epub:${bookId}`,
      canUpdate: false,
      durChapterIndex: 0,
      durChapterPos: 0,
      durChapterTitle: "第 1 节",
      durChapterTime: now,
      totalChapterNum: totalChapters,
      kind: "本地EPUB",
    };
    await env.DB.prepare(
      `INSERT INTO epub_books (book_id, user_ns, file_name, r2_key, file_size, status, total_chapters, parsed_chapters, title, author, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, 'ready', ?6, ?6, ?7, ?8, ?9, ?10)
       ON CONFLICT(book_id) DO UPDATE SET status='ready', total_chapters=excluded.total_chapters, parsed_chapters=excluded.parsed_chapters, updated_at=excluded.updated_at`
    )
      .bind(bookId, userNs, fileName, bookKey, fileSize, totalChapters, displayTitle, author || "未知作者", now, now)
      .run();
  } else if (lowerName.endsWith(".pdf")) {
    const tailSize = Math.min(65536, fileSize);
    const tailText = new TextDecoder().decode(bodyBytes.subarray(fileSize - tailSize));
    const countMatch = tailText.match(/\/Count\s+(\d+)/);
    const totalPages = countMatch ? parseInt(countMatch[1], 10) : 1;
    const titleMatch = tailText.match(/\/Title\s*\(([^)]+)\)/);
    const authorMatch = tailText.match(/\/Author\s*\(([^)]+)\)/);
    const title = titleMatch ? titleMatch[1].trim() : safeName.replace(/\.pdf$/i, "");
    const author = authorMatch ? authorMatch[1].trim() : "未知作者";
    newBook = {
      name: title,
      author: author,
      bookUrl: `local-pdf:${bookId}`,
      origin: "local-pdf",
      originName: "本地 PDF",
      tocUrl: `local-pdf:${bookId}`,
      canUpdate: false,
      durChapterIndex: 1,
      durChapterPos: 0,
      durChapterTitle: "第 1 页",
      durChapterTime: now,
      totalChapterNum: totalPages,
      kind: "本地PDF",
    };
    await env.DB.prepare(
      `INSERT INTO pdf_books (book_id, user_ns, file_name, r2_key, file_size, total_pages, title, author, status, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'ready', ?9, ?10)`
    ).bind(bookId, userNs, fileName, bookKey, fileSize, totalPages, title, author, now, now).run();
  } else if (lowerName.endsWith(".txt")) {
    const text = decodeTxtBytes(bodyBytes);
    const utf8Bytes = new TextEncoder().encode(text);
    const chapters = scanTxtChapterOffsets(text, utf8Bytes);
    const totalChapters = chapters.length;
    const title = safeName.replace(/\.txt$/i, "");
    newBook = {
      name: title,
      author: "本地导入",
      bookUrl: `local-txt:${bookId}`,
      origin: "local-txt",
      originName: "本地 TXT",
      tocUrl: `local-txt:${bookId}`,
      canUpdate: false,
      durChapterIndex: 0,
      durChapterPos: 0,
      durChapterTitle: chapters[0]?.title || "第一章",
      durChapterTime: now,
      totalChapterNum: totalChapters,
      latestChapterTitle: chapters[chapters.length - 1]?.title,
      kind: "本地TXT",
      wordCount: `${text.length}字`,
    };
    await env.DB.prepare(
      `INSERT INTO txt_books (book_id, user_ns, file_name, r2_key, file_size, total_chapters, title, author, status, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, '本地导入', 'ready', ?8, ?9)
       ON CONFLICT(book_id) DO UPDATE SET file_size=excluded.file_size, total_chapters=excluded.total_chapters, title=excluded.title, updated_at=excluded.updated_at`
    )
      .bind(bookId, userNs, fileName, bookKey, fileSize, totalChapters, title, now, now)
      .run();
    const stmts = chapters.map((ch, idx) =>
      env.DB.prepare(
        `INSERT INTO txt_chapters (book_id, chapter_index, title, byte_offset, byte_length, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(book_id, chapter_index) DO UPDATE SET byte_offset=excluded.byte_offset, byte_length=excluded.byte_length`
      ).bind(bookId, idx, ch.title, ch.offset, ch.length, now)
    );
    for (let i = 0; i < stmts.length; i += 50) {
      await env.DB.batch(stmts.slice(i, i + 50));
    }
  } else {
    return jsonResponse({ isSuccess: false, errorMsg: "不支持的文件类型" });
  }

  // 保存书架
  const shelfIdx = shelf.findIndex((b) => b.bookUrl === newBook.bookUrl || (b.name === newBook.name && b.origin === newBook.origin));
  if (shelfIdx >= 0) {
    shelf[shelfIdx] = { ...shelf[shelfIdx], ...newBook, bookUrl: shelf[shelfIdx].bookUrl, durChapterTime: now };
  } else {
    shelf.unshift(newBook);
  }
  await documentHandlers.saveDocument(env, userNs, "bookshelf.json", shelf);
  triggerOnChangeSync(env, userNs, ctx);

  return jsonResponse({ isSuccess: true, data: newBook });
}

export async function handleUploadFile(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const formData = await request.formData();
  const file = formData.get("file") as unknown as File | null;
  if (!file) return jsonResponse({ isSuccess: false, errorMsg: "缺少上传文件" });

  const rawName = file.name || "file";
  const baseName = rawName.split("/").pop()?.split("\\").pop() || "file";
  const safeName = baseName.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/^\.+/, "") || "file";
  const fileType = new URL(request.url).searchParams.get("fileType") || "images";
  const safeFileType = /^[a-zA-Z0-9_-]+$/.test(fileType) ? fileType : "images";
  const r2Key = `assets/${userNs}/${safeFileType}/${safeName}`;

  await env.BUCKET.put(r2Key, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type || "application/octet-stream" },
  });

  return jsonResponse({
    isSuccess: true,
    data: [`/assets/${userNs}/${safeFileType}/${safeName}`],
  });
}

export async function handleDeleteFile(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const { url } = await request.json<{ url: string }>();
  const prefix = `/assets/${userNs}/`;
  if (!url || !url.startsWith(prefix) || url.includes("..") || url.includes("\\")) {
    return jsonResponse({ isSuccess: false, errorMsg: "非法文件路径" });
  }

  const rel = url.substring(prefix.length);
  const parts = rel.split("/").filter(Boolean);
  if (parts.length === 0 || parts.some((p) => p === "." || p === "..")) {
    return jsonResponse({ isSuccess: false, errorMsg: "非法文件路径" });
  }

  const r2Key = `assets/${userNs}/${parts.join("/")}`;
  await env.BUCKET.delete(r2Key);
  return jsonResponse({ isSuccess: true, data: "" });
}
