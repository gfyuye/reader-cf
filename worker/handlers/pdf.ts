import { jsonResponse, corsHeaders } from "../http";
import { resolveUserNs } from "../auth";
import { Env } from "../types";
import * as documentHandlers from "../handlers/document";
import { fallbackFetchFromRemoteWebdav } from "./webdav";

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

    await env.DB.prepare(
      `INSERT INTO pdf_books (book_id, user_ns, file_name, r2_key, file_size, total_pages, title, author, status, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'ready', ?9, ?10)`
    ).bind(bookId, userNs, fileName, r2Key, fileSize, totalPages, title, author, now, now).run();

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
      durChapterTime: Date.now(),
      totalChapterNum: totalPages,
      kind: "本地PDF",
    };

    let shelf: any[] = (await documentHandlers.getDocument(env, userNs, "bookshelf.json")) || [];
    const idx = shelf.findIndex(
      (b) => b.bookUrl === bookUrl || (b.name === newBook.name && b.origin === newBook.origin)
    );
    if (idx >= 0) {
      shelf[idx] = { ...shelf[idx], ...newBook, bookUrl: shelf[idx].bookUrl, durChapterTime: Date.now() };
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

  const book = await env.DB.prepare(
    `SELECT r2_key, file_size FROM pdf_books WHERE book_id = ?1`
  ).bind(bookId).first<{ r2_key: string; file_size: number }>();

  if (!book) return jsonResponse({ isSuccess: false, errorMsg: "未找到该 PDF 书籍" });

  const rangeHeader = request.headers.get("Range");
  const r2Options: R2GetOptions = {};
  let rangeOffset = 0;
  let rangeLength: number | undefined;

  if (rangeHeader) {
    const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
    if (match) {
      const offset = parseInt(match[1], 10);
      if (offset >= book.file_size) {
        const headers = new Headers(corsHeaders());
        headers.set("Content-Range", `bytes */${book.file_size}`);
        return new Response(null, { status: 416, headers });
      }
      const rawEnd = match[2] ? parseInt(match[2], 10) : undefined;
      const end = rawEnd !== undefined ? Math.min(rawEnd, book.file_size - 1) : book.file_size - 1;
      const length = Math.max(0, end - offset + 1);
      rangeOffset = offset;
      rangeLength = length;
      r2Options.range = { offset, length };
    }
  }

  const obj = await env.BUCKET.get(book.r2_key, r2Options);
  let bodyStream: any = null;
  let byteLen = 0;

  if (obj) {
    bodyStream = obj.body;
    byteLen = rangeLength !== undefined ? rangeLength : Math.max(0, book.file_size - rangeOffset);
  } else {
    const remoteBytes = await fallbackFetchFromRemoteWebdav(env, book.r2_key, {
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
    headers.set("Content-Range", `bytes ${rangeOffset}-${end}/${book.file_size}`);
    headers.set("Content-Length", byteLen.toString());
    return new Response(bodyStream, { status: 206, headers });
  }

  headers.set("Content-Length", book.file_size.toString());
  return new Response(bodyStream, { status: 200, headers });
}

export async function handlePdfInfo(bookId: string, env: Env): Promise<Response> {
  const book = await env.DB.prepare(
    `SELECT book_id, file_name, title, author, total_pages, file_size, status FROM pdf_books WHERE book_id = ?1`
  ).bind(bookId).first();
  return jsonResponse({ isSuccess: true, data: book });
}

export async function handlePdfToc(bookId: string, env: Env): Promise<Response> {
  const outlines = await env.DB.prepare(
    `SELECT title, dest_page, level FROM pdf_outlines WHERE book_id = ?1 ORDER BY dest_page ASC`
  ).bind(bookId).all();
  return jsonResponse({ isSuccess: true, data: outlines.results });
}
