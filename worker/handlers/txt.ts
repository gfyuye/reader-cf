import { jsonResponse, corsHeaders } from "../http";
import { resolveUserNs } from "../auth";
import { getEnv } from "../env";
import { Env } from "../types";
import * as documentHandlers from "../handlers/document";
import { triggerOnChangeSync } from "./webdav";
import { fallbackFetchFromRemoteWebdav } from "./webdav";

function decodeTxtBytes(bytes: Uint8Array): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder("utf-8").decode(bytes.subarray(3));
  }
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    try {
      return new TextDecoder("gb18030").decode(bytes);
    } catch {
      return new TextDecoder("utf-8").decode(bytes);
    }
  }
}

function scanTxtChapterOffsets(text: string, utf8Bytes: Uint8Array): Array<{ title: string; offset: number; length: number }> {
  const regex = /^\s*(第[0-9一二三四五六七八九十百千万零两]+[章回节卷集幕篇部话段]|Chapter\s+\d+|序章|引子|楔子|尾声|番外)[^\r\n]*$/gm;
  const matches: Array<{ title: string; charIndex: number }> = [];

  let match;
  while ((match = regex.exec(text)) !== null) {
    matches.push({
      title: match[0].trim(),
      charIndex: match.index,
    });
  }

  if (matches.length === 0) {
    return [{ title: "全本", offset: 0, length: utf8Bytes.length }];
  }

  let curChar = 0;
  let curByte = 0;
  let matchPtr = 0;

  const byteOffsets: number[] = [];
  while (curChar < text.length && matchPtr < matches.length) {
    if (curChar === matches[matchPtr].charIndex) {
      byteOffsets.push(curByte);
      matchPtr++;
    }
    const code = text.charCodeAt(curChar);
    curChar++;
    if (code <= 0x7f) curByte += 1;
    else if (code <= 0x7ff) curByte += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      curChar++;
      curByte += 4;
    } else curByte += 3;
  }

  const chapters: Array<{ title: string; offset: number; length: number }> = [];

  if (byteOffsets.length > 0 && byteOffsets[0] > 0) {
    chapters.push({
      title: "序章",
      offset: 0,
      length: byteOffsets[0],
    });
  }

  for (let i = 0; i < byteOffsets.length; i++) {
    const start = byteOffsets[i];
    const end = i + 1 < byteOffsets.length ? byteOffsets[i + 1] : utf8Bytes.length;
    const len = end - start;
    if (len > 0) {
      chapters.push({
        title: matches[i].title,
        offset: start,
        length: len,
      });
    }
  }

  return chapters;
}

export async function handleTxtUpload(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  try {
    const userNs = await resolveUserNs(request, env);
    if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });
    let fileName = "book.txt";
    let fileBuffer: ArrayBuffer;

    const contentType = request.headers.get("Content-Type") || "";
    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const file = formData.get("file") as unknown as File | null;
      if (!file) return jsonResponse({ isSuccess: false, errorMsg: "缺少 TXT 文件" });
      fileName = file.name || "book.txt";
      fileBuffer = await file.arrayBuffer();
    } else {
      fileName = request.headers.get("X-File-Name") || "book.txt";
      fileBuffer = await request.arrayBuffer();
    }

    const rawBytes = new Uint8Array(fileBuffer);
    if (rawBytes.length === 0) return jsonResponse({ isSuccess: false, errorMsg: "文件内容为空" });

    const text = decodeTxtBytes(rawBytes);
    const utf8Bytes = new TextEncoder().encode(text);
    const fileSize = utf8Bytes.length;

    const safeName = fileName.replace(/[/\\?%*:|"<>]/g, "_");
    const bookId = `txt_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const r2Key = `webdav/${userNs}/book/${safeName}`;

    await env.BUCKET.put(r2Key, utf8Bytes, {
      httpMetadata: { contentType: "text/plain; charset=utf-8" },
    });

    const chapters = scanTxtChapterOffsets(text, utf8Bytes);
    const totalChapters = chapters.length;
    const title = fileName.replace(/\.txt$/i, "");
    const now = Math.floor(Date.now() / 1000);

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

    const bookUrl = `local-txt:${bookId}`;
    const newBook = {
      name: title,
      author: "本地导入",
      bookUrl: bookUrl,
      origin: "local-txt",
      originName: "本地 TXT",
      tocUrl: bookUrl,
      canUpdate: false,
      durChapterIndex: 0,
      durChapterPos: 0,
      durChapterTitle: chapters[0]?.title || "第一章",
      durChapterTime: Date.now(),
      totalChapterNum: totalChapters,
      latestChapterTitle: chapters[chapters.length - 1]?.title,
      kind: "本地TXT",
      wordCount: `${text.length}字`,
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

    triggerOnChangeSync(env, userNs, ctx);

    return jsonResponse({
      isSuccess: true,
      data: newBook,
    });
  } catch (err: any) {
    return jsonResponse({ isSuccess: false, errorMsg: err.message });
  }
}

export async function handleTxtRead(bookId: string, chapterIndex: number, env: Env): Promise<Response> {
  try {
    const text = await readTxtChapterText(bookId, chapterIndex, env);
    return new Response(text, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        ...corsHeaders(),
      },
    });
  } catch (err: any) {
    return jsonResponse({ isSuccess: false, errorMsg: err.message });
  }
}

export async function readTxtChapterText(bookId: string, chapterIndex: number, env: Env): Promise<string> {
  const chapter = await env.DB.prepare(
    `SELECT c.byte_offset, c.byte_length, b.r2_key
     FROM txt_chapters c
     JOIN txt_books b ON c.book_id = b.book_id
     WHERE c.book_id = ?1 AND c.chapter_index = ?2`
  )
    .bind(bookId, chapterIndex)
    .first<{ byte_offset: number; byte_length: number; r2_key: string }>();

  if (!chapter) throw new Error("未找到该 TXT 章节切片");

  const obj = await env.BUCKET.get(chapter.r2_key, {
    range: { offset: chapter.byte_offset, length: chapter.byte_length },
  });
  let payload: Uint8Array | null = obj ? new Uint8Array(await obj.arrayBuffer()) : null;

  if (!payload) {
    payload = await fallbackFetchFromRemoteWebdav(env, chapter.r2_key, {
      offset: chapter.byte_offset,
      length: chapter.byte_length,
    });
  }

  if (!payload) throw new Error("本地书籍不存在，请重新导入");
  return new TextDecoder().decode(payload);
}

export async function handleTxtInfo(bookId: string, env: Env): Promise<Response> {
  const book = await env.DB.prepare(
    `SELECT book_id, file_name, title, author, total_chapters, file_size, status FROM txt_books WHERE book_id = ?1`
  )
    .bind(bookId)
    .first();

  if (!book) return jsonResponse({ isSuccess: false, errorMsg: "未找到该 TXT 书籍" });
  return jsonResponse({ isSuccess: true, data: book });
}
