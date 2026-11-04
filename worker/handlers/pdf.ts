import { jsonResponse, corsHeaders } from "../http";
import { resolveUserNs } from "../auth";
import { Env } from "../types";
import * as documentHandlers from "../handlers/document";
import { fallbackFetchFromRemoteWebdav } from "./webdav";

export async function indexPdfIntoDatabase(
  env: Env,
  userNs: string,
  bookId: string,
  fileName: string,
  r2Key: string,
  fileSize: number
): Promise<{ title: string; author: string; totalPages: number }> {
  const tailSize = Math.min(65536, fileSize);
  const tailObj = await env.BUCKET.get(r2Key, {
    range: { offset: Math.max(0, fileSize - tailSize), length: tailSize },
  });
  const tailBytes = tailObj ? new Uint8Array(await tailObj.arrayBuffer()) : new Uint8Array(0);
  const tailText = new TextDecoder().decode(tailBytes);

  const countMatch = tailText.match(/\/Count\s+(\d+)/);
  const totalPages = countMatch ? parseInt(countMatch[1], 10) : 1;
  const titleMatch = tailText.match(/\/Title\s*\(([^)]+)\)/);
  const authorMatch = tailText.match(/\/Author\s*\(([^)]+)\)/);

  const title = titleMatch ? titleMatch[1].trim() : fileName.replace(/\.pdf$/i, "");
  const author = authorMatch ? authorMatch[1].trim() : "未知作者";

  return { title, author, totalPages };
}

export async function handlePdfUpload(request: Request, env: Env): Promise<Response> {
  try {
    const userNs = await resolveUserNs(request, env);
    if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

    let fileName = "book.pdf";
    let bodyBytes: Uint8Array;
    const contentType = request.headers.get("Content-Type") || "";
    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const file = formData.get("file") as unknown as File | null;
      if (!file) return jsonResponse({ isSuccess: false, errorMsg: "缺少 PDF 文件" });
      fileName = file.name || "book.pdf";
      bodyBytes = new Uint8Array(await file.arrayBuffer());
    } else {
      const rawHeaderName = request.headers.get("X-File-Name");
      fileName = rawHeaderName ? decodeURIComponent(rawHeaderName) : "book.pdf";
      bodyBytes = new Uint8Array(await request.arrayBuffer());
    }

    const safeName = fileName.replace(/[/\\?%*:|"<>]/g, "_");
    const bookId = `pdf_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const r2Key = `webdav/${userNs}/book/${safeName}`;

    await env.BUCKET.put(r2Key, bodyBytes, {
      httpMetadata: { contentType: "application/pdf" },
    });

    const fileSize = bodyBytes.byteLength;
    const tailSize = Math.min(65536, fileSize);
    const tailText = new TextDecoder().decode(bodyBytes.subarray(fileSize - tailSize));

    const countMatch = tailText.match(/\/Count\s+(\d+)/);
    const totalPages = countMatch ? parseInt(countMatch[1], 10) : 1;
    const titleMatch = tailText.match(/\/Title\s*\(([^)]+)\)/);
    const authorMatch = tailText.match(/\/Author\s*\(([^)]+)\)/);

    const title = titleMatch ? titleMatch[1].trim() : fileName.replace(/\.pdf$/i, "");
    const author = authorMatch ? authorMatch[1].trim() : "未知作者";
    const now = Math.floor(Date.now() / 1000);

    const bookUrl = `local-pdf:${bookId}`;
    const newBook = {
      name: title,
      author: author,
      bookUrl,
      origin: "local-pdf",
      originName: "本地 PDF",
      tocUrl: bookUrl,
      canUpdate: false,
      durChapterIndex: 1,
      durChapterPos: 0,
      durChapterTitle: "第 1 页",
      durChapterTime: now,
      totalChapterNum: totalPages,
      kind: "本地PDF",
    };

    // 写入 book_details（一本书一条 JSON：元数据 + 章节目录 + 进度）
    const bookDetail = {
      ...newBook,
      bookId,
      r2Key,
      fileSize: bodyBytes.byteLength,
      updatedAt: now,
      chapters: Array.from({ length: totalPages }, (_, i) => ({
        index: i,
        title: `第 ${i + 1} 页`,
        url: `local-pdf:${bookId}#${i}`,
      })),
    };
    await documentHandlers.saveBookDetail(env, userNs, bookId, bookDetail);

    let shelf: any[] = (await documentHandlers.getDocument(env, userNs, "bookshelf.json")) || [];
    const idx = shelf.findIndex(
      (b) => b.bookUrl === bookUrl || (b.name === newBook.name && b.origin === newBook.origin)
    );
    if (idx >= 0) {
      shelf[idx] = { ...shelf[idx], ...newBook, bookUrl: shelf[idx].bookUrl, durChapterTime: now };
    } else {
      shelf.unshift(newBook);
    }
    await documentHandlers.saveDocument(env, userNs, "bookshelf.json", shelf);

    return jsonResponse({
      isSuccess: true,
      data: newBook,
    });
  } catch (err: any) {
    return jsonResponse({ isSuccess: false, errorMsg: err.message });
  }
}

export async function handlePdfStream(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const url = new URL(request.url);
  const bookId = url.searchParams.get("bookId") || "";

  let r2Key: string | null = null;
  let fileSize = 0;

  // 优先从 book_details 读取
  const detail = await documentHandlers.getBookDetail(env, userNs, bookId);
  if (detail && detail.r2Key) {
    r2Key = detail.r2Key;
    fileSize = detail.fileSize || 0;
  }

  if (!r2Key) return jsonResponse({ isSuccess: false, errorMsg: "未找到该 PDF 书籍" });
  let bodyStream: any = null;
  let byteLen = 0;

  const rangeHeader = request.headers.get("Range");
  let rangeOffset = 0;
  let rangeLength: number | undefined;

  if (rangeHeader) {
    const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
    if (match) {
      const offset = parseInt(match[1], 10);
      if (offset >= fileSize) {
        const headers = new Headers(corsHeaders());
        headers.set("Content-Range", `bytes */${fileSize}`);
        return new Response(null, { status: 416, headers });
      }
      const rawEnd = match[2] ? parseInt(match[2], 10) : undefined;
      const end = rawEnd !== undefined ? Math.min(rawEnd, fileSize - 1) : fileSize - 1;
      const length = Math.max(0, end - offset + 1);
      rangeOffset = offset;
      rangeLength = length;
    }
  }

  const obj = await env.BUCKET.get(r2Key!, { range: rangeLength !== undefined ? { offset: rangeOffset, length: rangeLength } : undefined });

  if (obj) {
    bodyStream = obj.body;
    byteLen = rangeLength !== undefined ? rangeLength : Math.max(0, fileSize - rangeOffset);
  } else {
    const remoteBytes = await fallbackFetchFromRemoteWebdav(env, r2Key!, {
      offset: rangeOffset,
      length: rangeLength,
    });
    if (remoteBytes) {
      bodyStream = remoteBytes;
      byteLen = remoteBytes.length;
    }
  }

  if (!bodyStream) return jsonResponse({ isSuccess: false, errorMsg: "文件未找到 (R2 与远端 WebDAV 均未命中)" });

  const headers = new Headers(corsHeaders());
  headers.set("Content-Type", "application/pdf");
  headers.set("Accept-Ranges", "bytes");
  headers.set("Access-Control-Expose-Headers", "Accept-Ranges, Content-Range, Content-Length");

  if (rangeLength !== undefined) {
    const end = rangeOffset + byteLen - 1;
    headers.set("Content-Range", `bytes ${rangeOffset}-${end}/${fileSize}`);
    headers.set("Content-Length", byteLen.toString());
    return new Response(bodyStream, { status: 206, headers });
  }

  headers.set("Content-Length", fileSize.toString());
  return new Response(bodyStream, { status: 200, headers });
}

export async function handlePdfInfo(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });
  const bookId = new URL(request.url).searchParams.get("bookId") || "";
  const detail = await documentHandlers.getBookDetail(env, userNs, bookId);
  if (!detail) return jsonResponse({ isSuccess: false, errorMsg: "未找到该 PDF 书籍" });
  return jsonResponse({ isSuccess: true, data: detail });
}

export async function handlePdfToc(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });
  const bookId = new URL(request.url).searchParams.get("bookId") || "";
  const detail = await documentHandlers.getBookDetail(env, userNs, bookId);
  if (!detail) return jsonResponse({ isSuccess: false, errorMsg: "未找到该 PDF 书籍" });
  const chapters = Array.isArray(detail.chapters) ? detail.chapters : [];
  return jsonResponse({ isSuccess: true, data: chapters });
}
