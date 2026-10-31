import { jsonResponse } from "../http";
import { resolveUserNs } from "../auth";
import { randomString } from "../utils";
import { Env } from "../types";
import * as documentHandlers from "../handlers/document";
import { indexEpubIntoDatabase } from "../handlers/epub";
import { decodeTxtBytes, scanTxtChapterOffsets } from "../handlers/txt";
import { triggerOnChangeSync } from "./webdav";

export async function handleChunkedUploadInit(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });
  const body = await request.json<any>();
  const { fileName, fileSize, totalParts, mimeType } = body || {};
  if (!fileName || !fileSize || !totalParts) {
    return jsonResponse({ isSuccess: false, errorMsg: "缺少上传参数" });
  }
  const uploadId = randomString(16);
  const now = Math.floor(Date.now() / 1000);
  const key = `uploads/${userNs}/${uploadId}/${fileName.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS chunked_uploads (upload_id TEXT PRIMARY KEY, user_ns TEXT NOT NULL, file_name TEXT NOT NULL, file_size INTEGER NOT NULL, total_parts INTEGER NOT NULL, key TEXT NOT NULL, mime_type TEXT, status TEXT NOT NULL, created_at INTEGER NOT NULL)`
  ).run();
  await env.DB.prepare(
    `INSERT INTO chunked_uploads (upload_id, user_ns, file_name, file_size, total_parts, key, mime_type, status, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'init', ?8)`
  )
    .bind(uploadId, userNs, fileName, fileSize, totalParts, key, mimeType || "", now)
    .run();
  return jsonResponse({ isSuccess: true, data: { uploadId, key } });
}

export async function handleChunkedUploadPart(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });
  const formData = await request.formData();
  const uploadId = formData.get("uploadId") as string;
  const partNumber = parseInt(formData.get("partNumber") as string, 10);
  const file = formData.get("file") as unknown as File;
  if (!uploadId || !partNumber || !file) {
    return jsonResponse({ isSuccess: false, errorMsg: "缺少分片参数" });
  }
  const row = await env.DB.prepare(`SELECT * FROM chunked_uploads WHERE upload_id = ?1 AND user_ns = ?2`)
    .bind(uploadId, userNs)
    .first<any>();
  if (!row) return jsonResponse({ isSuccess: false, errorMsg: "上传任务不存在" });
  const partKey = `${row.key}.part${partNumber}`;
  await env.BUCKET.put(partKey, file.stream());
  return jsonResponse({ isSuccess: true, data: { partNumber } });
}

export async function handleChunkedUploadComplete(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });
  const body = await request.json<any>();
  const { uploadId, fileName, target, path } = body || {};
  if (!uploadId) return jsonResponse({ isSuccess: false, errorMsg: "缺少 uploadId" });
  const row = await env.DB.prepare(`SELECT * FROM chunked_uploads WHERE upload_id = ?1 AND user_ns = ?2`)
    .bind(uploadId, userNs)
    .first<any>();
  if (!row) return jsonResponse({ isSuccess: false, errorMsg: "上传任务不存在" });
  // 合并分片：将首个分片复制为最终文件
  const partKey = `${row.key}.part1`;
  const part = await env.BUCKET.get(partKey);
  if (part) {
    await env.BUCKET.put(row.key, part.body);
  }
  const now = Math.floor(Date.now() / 1000);
  const safeName = fileName.replace(/[/\\?%*:|"<>]/g, "_");
  const lowerName = safeName.toLowerCase();
  const bookId = `${target}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  const r2Key = row.key;
  const fileObj = await env.BUCKET.get(r2Key);
  const bodyBytes = fileObj ? new Uint8Array(await fileObj.arrayBuffer()) : new Uint8Array(0);
  const fileSize = bodyBytes.byteLength;

  let newBook: any;
  if (lowerName.endsWith(".epub")) {
    const { title, author, totalChapters } = await indexEpubIntoDatabase(env, userNs, bookId, fileName, r2Key, fileSize);
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
      .bind(bookId, userNs, fileName, r2Key, fileSize, totalChapters, displayTitle, author || "未知作者", now, now)
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
    ).bind(bookId, userNs, fileName, r2Key, fileSize, totalPages, title, author, now, now).run();
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
      .bind(bookId, userNs, fileName, r2Key, fileSize, totalChapters, title, now, now)
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
  let shelf: any[] = (await documentHandlers.getDocument(env, userNs, "bookshelf.json")) || [];
  const idx = shelf.findIndex(
    (b) => b.bookUrl === newBook.bookUrl || (b.name === newBook.name && b.origin === newBook.origin)
  );
  if (idx >= 0) {
    shelf[idx] = { ...shelf[idx], ...newBook, bookUrl: shelf[idx].bookUrl, durChapterTime: now };
  } else {
    shelf.unshift(newBook);
  }
  await documentHandlers.saveDocument(env, userNs, "bookshelf.json", shelf);
  triggerOnChangeSync(env, userNs, ctx);

  await env.DB.prepare(`UPDATE chunked_uploads SET status = 'complete' WHERE upload_id = ?1`).bind(uploadId).run();
  return jsonResponse({ isSuccess: true, data: newBook });
}

export async function handleImportWebdavBook(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });
  const body = await request.json<any>();
  const { path } = body || {};
  if (!path) return jsonResponse({ isSuccess: false, errorMsg: "缺少文件路径" });
  return jsonResponse({ isSuccess: true, data: { ok: true } });
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
