import { jsonResponse, corsHeaders } from "../http";
import { resolveUserNs } from "../auth";
import { getEnv } from "../env";
import { Env } from "../types";
import * as documentHandlers from "../handlers/document";
import { triggerOnChangeSync } from "./webdav";
import { fallbackFetchFromRemoteWebdav } from "./webdav";

export function decodeTxtBytes(bytes: Uint8Array): string {
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

export function scanTxtChapterOffsets(text: string, utf8Bytes: Uint8Array): Array<{ title: string; offset: number; length: number }> {
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

    // 写入 book_details（一本书一条 JSON：元数据 + 章节目录 + 进度）
    const bookDetail = {
      ...newBook,
      bookId,
      r2Key,
      fileSize,
      updatedAt: now,
      chapters: chapters.map((ch, i) => ({
        index: i,
        title: ch.title,
        url: `local-txt:${bookId}#${i}`,
        byteOffset: ch.offset,
        byteLength: ch.length,
      })),
    };
    await documentHandlers.saveBookDetail(env, userNs, bookId, bookDetail);

    let shelf: any[] = (await documentHandlers.getDocument(env, userNs, "bookshelf.json")) || [];
    const shelfIdx = shelf.findIndex(
      (b) => b.bookUrl === bookUrl || (b.name === newBook.name && b.origin === newBook.origin)
    );
    if (shelfIdx >= 0) {
      shelf[shelfIdx] = { ...shelf[shelfIdx], ...newBook, bookUrl: shelf[shelfIdx].bookUrl, durChapterTime: Date.now() };
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

export async function handleTxtRead(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });
  const url = new URL(request.url);
  const bookId = url.searchParams.get("bookId") || "";
  const chapterIndex = parseInt(url.searchParams.get("index") || "0", 10);
  try {
    const text = await readTxtChapterText(bookId, chapterIndex, env, userNs);
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

export async function readTxtChapterText(bookId: string, chapterIndex: number, env: Env, userNs?: string): Promise<string> {
  let byteOffset: number;
  let byteLength: number;
  let r2Key: string;

  if (!userNs) throw new Error("缺少 userNs，无法读取 TXT 章节");
  const detail = await documentHandlers.getBookDetail(env, userNs, bookId);
  if (!detail || !Array.isArray(detail.chapters)) {
    throw new Error("未找到该 TXT 书籍章节目录，请重新导入");
  }
  const ch = detail.chapters[chapterIndex];
  if (!ch) throw new Error("未找到该 TXT 章节切片");
  byteOffset = ch.byteOffset ?? 0;
  byteLength = ch.byteLength ?? 0;
  r2Key = detail.r2Key;
  if (!r2Key) throw new Error("未找到该 TXT 书籍 R2 存储地址");

  const obj = await env.BUCKET.get(r2Key, {
    range: { offset: byteOffset, length: byteLength },
  });
  let payload: Uint8Array | null = obj ? new Uint8Array(await obj.arrayBuffer()) : null;

  if (!payload) {
    payload = await fallbackFetchFromRemoteWebdav(env, r2Key, {
      offset: byteOffset,
      length: byteLength,
    });
  }

  if (!payload) throw new Error("本地书籍不存在，请重新导入");
  return new TextDecoder().decode(payload);
}

export async function handleTxtInfo(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });
  const bookId = new URL(request.url).searchParams.get("bookId") || "";
  const detail = await documentHandlers.getBookDetail(env, userNs, bookId);
  if (!detail) return jsonResponse({ isSuccess: false, errorMsg: "未找到该 TXT 书籍" });
  return jsonResponse({ isSuccess: true, data: detail });
}

/**
 * 流式扫描 TXT 章节：分块 Range 请求读取 R2 文件，边读边扫描章节标题，
 * 不一次性将全文加载到内存。只保留章节元数据（title/offset/length）。
 *
 * @param r2Key   R2 对象键
 * @param fileSize 文件总字节数
 * @param chunkSize 每块读取字节数（默认 256KB）
 * @param overlap   相邻块重叠字节数（默认 16KB，用于拼接跨块行和章节标题）
 */
export async function scanTxtChaptersStreaming(
  env: Env,
  r2Key: string,
  fileSize: number,
  chunkSize = 256 * 1024,
  overlap = 16 * 1024
): Promise<Array<{ title: string; offset: number; length: number }>> {
  const regex = /^\s*(第[0-9一二三四五六七八九十百千万零两]+[章回节卷集幕篇部话段]|Chapter\s+\d+|序章|引子|楔子|尾声|番外)[^\r\n]*$/gm;

  const byteOffsets: number[] = [];
  const titles: string[] = [];

  let carryOver = "";              // 上一块未完成的行
  let carryOverAbsOffset = 0;      // carryOver 在文件中的绝对字节偏移

  const decoder = new TextDecoder("utf-8", { fatal: false, ignoreBOM: false });

  for (let offset = 0; offset < fileSize; offset += chunkSize) {
    const length = Math.min(chunkSize + overlap, fileSize - offset);
    const obj = await env.BUCKET.get(r2Key, { range: { offset, length } });
    if (!obj) break;

    const bytes = new Uint8Array(await obj.arrayBuffer());
    const text = decoder.decode(bytes, { stream: offset + length < fileSize });

    const fullText = carryOver ? carryOver + text : text;
    const lines = fullText.split(/\r?\n/);

    const isNotFileEnd = offset + length < fileSize;
    const completeLines = isNotFileEnd ? lines.slice(0, -1) : lines;

    let absOffset = carryOverAbsOffset;

    for (const line of completeLines) {
      const lineByteLen = new TextEncoder().encode(line).length;
      const lineStartAbs = absOffset;

      if (regex.test(line.trim())) {
        byteOffsets.push(lineStartAbs);
        titles.push(line.trim());
      }

      absOffset = lineStartAbs + lineByteLen + 1; // +1 for newline character
    }

    if (isNotFileEnd && lines.length > 0) {
      carryOver = lines[lines.length - 1];
      carryOverAbsOffset = absOffset;
    } else {
      carryOver = "";
      carryOverAbsOffset = 0;
    }
  }

  const chapters: Array<{ title: string; offset: number; length: number }> = [];

  if (byteOffsets.length === 0) {
    return [{ title: "全本", offset: 0, length: fileSize }];
  }

  if (byteOffsets[0] > 0) {
    chapters.push({ title: "序章", offset: 0, length: byteOffsets[0] });
  }

  for (let i = 0; i < byteOffsets.length; i++) {
    const start = byteOffsets[i];
    const end = i + 1 < byteOffsets.length ? byteOffsets[i + 1] : fileSize;
    const len = end - start;
    if (len > 0) {
      chapters.push({ title: titles[i], offset: start, length: len });
    }
  }

  return chapters;
}
