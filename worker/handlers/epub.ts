import { jsonResponse, corsHeaders } from "../http";
import { resolveUserNs } from "../auth";
import { getEnv } from "../env";
import { Env } from "../types";
import * as documentHandlers from "../handlers/document";
import { md5Hex as md5 } from "../md5";
import { fallbackFetchFromRemoteWebdav } from "./webdav";

function crc32(data: Uint8Array): number {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

export async function compressDeflate(data: Uint8Array): Promise<{ bytes: Uint8Array; method: number }> {
  try {
    const cs = new CompressionStream("deflate-raw");
    const writer = cs.writable.getWriter();
    writer.write(data);
    writer.close();
    const compressed = await new Response(cs.readable).arrayBuffer();
    return { bytes: new Uint8Array(compressed), method: 8 };
  } catch {
    return { bytes: data, method: 0 };
  }
}

export async function createZipArchive(files: Record<string, string>): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const fileRecords: Array<{
    nameBytes: Uint8Array;
    crc: number;
    compressedBytes: Uint8Array;
    uncompressedSize: number;
    method: number;
    localHeaderOffset: number;
  }> = [];

  const localChunks: Uint8Array[] = [];
  let currentOffset = 0;

  for (const [name, content] of Object.entries(files)) {
    const data = encoder.encode(content);
    const nameBytes = encoder.encode(name);
    const crc = crc32(data);
    const uncompressedSize = data.length;

    const { bytes: compressedBytes, method } = await compressDeflate(data);
    const localHeaderOffset = currentOffset;

    const localHeader = new Uint8Array(30 + nameBytes.length);
    const view = new DataView(localHeader.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0x0800, true);
    view.setUint16(8, method, true);
    view.setUint16(10, 0, true);
    view.setUint16(12, 0, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, compressedBytes.length, true);
    view.setUint32(22, uncompressedSize, true);
    view.setUint16(26, nameBytes.length, true);
    view.setUint16(28, 0, true);
    localHeader.set(nameBytes, 30);

    localChunks.push(localHeader);
    localChunks.push(compressedBytes);
    currentOffset += localHeader.length + compressedBytes.length;

    fileRecords.push({
      nameBytes,
      crc,
      compressedBytes,
      uncompressedSize,
      method,
      localHeaderOffset,
    });
  }

  const centralDirOffset = currentOffset;
  const centralChunks: Uint8Array[] = [];

  for (const record of fileRecords) {
    const cdHeader = new Uint8Array(46 + record.nameBytes.length);
    const view = new DataView(cdHeader.buffer);
    view.setUint32(0, 0x02014b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 20, true);
    view.setUint16(8, 0x0800, true);
    view.setUint16(10, record.method, true);
    view.setUint16(12, 0, true);
    view.setUint16(14, 0, true);
    view.setUint32(16, record.crc, true);
    view.setUint32(20, record.compressedBytes.length, true);
    view.setUint32(24, record.uncompressedSize, true);
    view.setUint16(28, record.nameBytes.length, true);
    view.setUint16(30, 0, true);
    view.setUint16(32, 0, true);
    view.setUint16(34, 0, true);
    view.setUint16(36, 0, true);
    view.setUint32(38, 0, true);
    view.setUint32(42, record.localHeaderOffset, true);
    cdHeader.set(record.nameBytes, 46);

    centralChunks.push(cdHeader);
    currentOffset += cdHeader.length;
  }

  const centralDirSize = currentOffset - centralDirOffset;

  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true);
  eocdView.setUint16(4, 0, true);
  eocdView.setUint16(6, 0, true);
  eocdView.setUint16(8, fileRecords.length, true);
  eocdView.setUint16(10, fileRecords.length, true);
  eocdView.setUint32(12, centralDirSize, true);
  eocdView.setUint32(16, centralDirOffset, true);
  eocdView.setUint16(20, 0, true);

  const totalLength = currentOffset + eocd.length;
  const result = new Uint8Array(totalLength);
  let pos = 0;
  for (const chunk of [...localChunks, ...centralChunks, eocd]) {
    result.set(chunk, pos);
    pos += chunk.length;
  }
  return result;
}

export async function handleEpubUpload(request: Request, env: Env): Promise<Response> {
  try {
    const userNs = await resolveUserNs(request, env);
    if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

    let fileName = "book.epub";
    let bodyBytes: Uint8Array;
    const contentType = request.headers.get("Content-Type") || "";
    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const file = formData.get("file") as unknown as File | null;
      if (!file) return jsonResponse({ isSuccess: false, errorMsg: "缺少 EPUB 文件" });
      fileName = file.name || "book.epub";
      bodyBytes = new Uint8Array(await file.arrayBuffer());
    } else {
      const rawHeaderName = request.headers.get("X-File-Name");
      fileName = rawHeaderName ? decodeURIComponent(rawHeaderName) : "book.epub";
      bodyBytes = new Uint8Array(await request.arrayBuffer());
    }

    const safeName = fileName.replace(/[/\\?%*:|"<>]/g, "_");
    const bookId = `epub_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const r2Key = `webdav/${userNs}/book/${safeName}`;
    const fileSize = bodyBytes.byteLength;

    await env.BUCKET.put(r2Key, bodyBytes, {
      httpMetadata: { contentType: "application/epub+zip" },
    });

    const { title, author, totalChapters, chapters } = await indexEpubIntoDatabase(
      env,
      userNs,
      bookId,
      fileName,
      r2Key,
      fileSize
    );

    const bookUrl = `local-epub:${bookId}`;
    const now = Math.floor(Date.now() / 1000);
    const newBook = {
      name: title,
      author: author,
      bookUrl,
      origin: "local-epub",
      originName: "本地 EPUB",
      tocUrl: bookUrl,
      canUpdate: false,
      durChapterIndex: 0,
      durChapterPos: 0,
      durChapterTitle: "第 1 节",
      durChapterTime: now,
      totalChapterNum: totalChapters,
      kind: "本地EPUB",
    };

    // 写入 book_details（一本书一条 JSON：元数据 + 章节目录 + 进度）
    const bookDetail = {
      ...newBook,
      bookId,
      r2Key,
      fileSize,
      updatedAt: now,
      chapters: chapters.map((ch) => ({
        index: ch.index,
        title: ch.title,
        url: `local-epub:${bookId}#${ch.index}`,
        byteOffset: ch.byteOffset,
        byteLength: ch.byteLength,
        fileName: ch.fileName,
        compressionMethod: ch.compressionMethod,
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

export async function handleEpubRead(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });
  const url = new URL(request.url);
  const bookId = url.searchParams.get("bookId") || "";
  const chapterIndex = parseInt(url.searchParams.get("page") || "0", 10);
  try {
    const html = await readEpubChapterHtml(bookId, chapterIndex, env, userNs);
    return new Response(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        ...corsHeaders(),
      },
    });
  } catch (err: any) {
    return jsonResponse({ isSuccess: false, errorMsg: err.message });
  }
}

export async function readEpubChapterHtml(bookId: string, chapterIndex: number, env: Env, userNs?: string): Promise<string> {
  let byteOffset: number;
  let byteLength: number;
  let compressionMethod: number;
  let fileName: string;
  let r2Key: string;

  if (!userNs) throw new Error("缺少 userNs，无法读取 EPUB 章节");
  const detail = await documentHandlers.getBookDetail(env, userNs, bookId);
  if (!detail || !Array.isArray(detail.chapters)) {
    throw new Error("未找到该 EPUB 书籍章节目录，请重新导入");
  }
  const ch = detail.chapters[chapterIndex];
  if (!ch) throw new Error("章节尚未完成分片索引");
  byteOffset = ch.byteOffset ?? 0;
  byteLength = ch.byteLength ?? 0;
  compressionMethod = ch.compressionMethod ?? 0;
  fileName = ch.fileName ?? "";
  r2Key = detail.r2Key;
  if (!r2Key) throw new Error("未找到该 EPUB 书籍 R2 存储地址");

  const localHdrObj = await env.BUCKET.get(r2Key, {
    range: { offset: byteOffset, length: 30 },
  });
  if (!localHdrObj) throw new Error("无法读取章节本地头数据");
  const localHdrBytes = new Uint8Array(await localHdrObj.arrayBuffer());
  const dataOffset = parseLocalHeaderDataOffset(localHdrBytes, byteOffset);

  const obj = await env.BUCKET.get(r2Key, {
    range: { offset: dataOffset, length: byteLength },
  });
  let payload: Uint8Array | null = obj ? new Uint8Array(await obj.arrayBuffer()) : null;

  if (!payload) {
    payload = await fallbackFetchFromRemoteWebdav(env, r2Key, {
      offset: dataOffset,
      length: byteLength,
    });
  }

  if (!payload) throw new Error("本地书籍不存在，请重新导入");

  let rawHtml = "";
  if (compressionMethod === 0) {
    rawHtml = new TextDecoder().decode(payload);
  } else if (compressionMethod === 8) {
    const stream = new Response(payload as unknown as BodyInit).body!.pipeThrough(new DecompressionStream("deflate-raw"));
    const buf = await new Response(stream).arrayBuffer();
    rawHtml = new TextDecoder().decode(buf);
  } else {
    throw new Error(`不支持的压缩格式: ${compressionMethod}`);
  }

  const nextChapter = detail.chapters[chapterIndex + 1];
  let nextFile = "";
  let nextAnchor = "";
  if (nextChapter) {
    nextFile = nextChapter.fileName?.split("#")[0] || "";
    nextAnchor = (nextFile === fileName && nextChapter.fileName?.includes("#"))
      ? nextChapter.fileName.split("#")[1]
      : "";
  }

  const currentFile = fileName.split("#")[0] || "";
  const startAnchor = fileName.includes("#") ? fileName.split("#")[1] : "";

  let html = sliceHtmlByAnchors(rawHtml, startAnchor, nextAnchor);
  html = rewriteEpubHtmlAssets(html, bookId, currentFile);

  return html;
}

export async function handleEpubStatus(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });
  const bookId = new URL(request.url).searchParams.get("bookId") || "";
  const detail = await documentHandlers.getBookDetail(env, userNs, bookId);
  if (!detail) return jsonResponse({ isSuccess: false, errorMsg: "未找到该 EPUB 书籍" });
  return jsonResponse({ isSuccess: true, data: {
    book_id: detail.bookId,
    file_name: detail.name,
    status: detail.status || 'ready',
    total_chapters: detail.totalChapterNum,
    parsed_chapters: detail.totalChapterNum,
    title: detail.name,
    author: detail.author,
  } });
}

// === ZIP / EPUB Helpers ===

interface CentralDirEntry {
  fileName: string;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

function findEOCD(tail: Uint8Array, totalFileSize: number): { cdOffset: number; cdSize: number } | null {
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail[i] === 0x50 && tail[i + 1] === 0x4b && tail[i + 2] === 0x05 && tail[i + 3] === 0x06) {
      const view = new DataView(tail.buffer, tail.byteOffset + i, 22);
      const cdSize = view.getUint32(12, true);
      const cdOffset = view.getUint32(16, true);
      if (cdOffset + cdSize <= totalFileSize) return { cdOffset, cdSize };
    }
  }
  return null;
}

function parseCentralDirectory(cd: Uint8Array): CentralDirEntry[] {
  const entries: CentralDirEntry[] = [];
  let pos = 0;
  const view = new DataView(cd.buffer, cd.byteOffset, cd.byteLength);

  while (pos + 46 <= cd.length) {
    if (cd[pos] !== 0x50 || cd[pos + 1] !== 0x4b || cd[pos + 2] !== 0x01 || cd[pos + 3] !== 0x02) break;
    const compressionMethod = view.getUint16(pos + 10, true);
    const compressedSize = view.getUint32(pos + 20, true);
    const uncompressedSize = view.getUint32(pos + 24, true);
    const nameLen = view.getUint16(pos + 28, true);
    const extraLen = view.getUint16(pos + 30, true);
    const commentLen = view.getUint16(pos + 32, true);
    const localHeaderOffset = view.getUint32(pos + 42, true);

    pos += 46;
    if (pos + nameLen <= cd.length) {
      const fileName = new TextDecoder().decode(cd.subarray(pos, pos + nameLen));
      entries.push({ fileName, compressionMethod, compressedSize, uncompressedSize, localHeaderOffset });
    }
    pos += nameLen + extraLen + commentLen;
  }
  return entries;
}

function parseLocalHeaderDataOffset(hdr: Uint8Array, localHeaderOffset: number): number {
  const view = new DataView(hdr.buffer, hdr.byteOffset, hdr.byteLength);
  const nameLen = view.getUint16(26, true);
  const extraLen = view.getUint16(28, true);
  return localHeaderOffset + 30 + nameLen + extraLen;
}

async function readZipEntryText(r2Key: string, entry: CentralDirEntry, env: Env): Promise<string> {
  const localHdrObj = await env.BUCKET.get(r2Key, { range: { offset: entry.localHeaderOffset, length: 30 } });
  if (!localHdrObj) throw new Error("无法读取本地头");
  const localHdrBytes = new Uint8Array(await localHdrObj.arrayBuffer());
  const dataOffset = parseLocalHeaderDataOffset(localHdrBytes, entry.localHeaderOffset);

  const dataObj = await env.BUCKET.get(r2Key, { range: { offset: dataOffset, length: entry.compressedSize } });
  if (!dataObj) throw new Error("无法读取数据切片");
  const dataBytes = new Uint8Array(await dataObj.arrayBuffer());

  if (entry.compressionMethod === 0) {
    return new TextDecoder().decode(dataBytes);
  } else if (entry.compressionMethod === 8) {
    const stream = new Response(dataBytes as unknown as BodyInit).body!.pipeThrough(new DecompressionStream("deflate-raw"));
    const decompressed = await new Response(stream).arrayBuffer();
    return new TextDecoder().decode(decompressed);
  }
  throw new Error(`不支持的压缩格式: ${entry.compressionMethod}`);
}

function parseContainerOpfPath(xml: string): string | null {
  const match = xml.match(/full-path=["']([^"']+)["']/i);
  return match ? match[1] : null;
}

function parseOpfPackage(xml: string, opfDir: string): {
  title: string;
  author: string;
  spinePaths: string[];
  ncxPath: string | null;
  navPath: string | null;
} {
  const titleMatch = xml.match(/<dc:title[^>]*>([^<]+)<\/dc:title>/i);
  const authorMatch = xml.match(/<dc:creator[^>]*>([^<]+)<\/dc:creator>/i);

  const manifest = new Map<string, string>();
  let ncxId: string | null = null;
  let navPath: string | null = null;

  const itemTagRegex = /<item\b([^>]*?)\/?>/gi;
  let match;
  while ((match = itemTagRegex.exec(xml)) !== null) {
    const attrs = match[1];
    const idMatch = attrs.match(/\bid=["']([^"']+)["']/i);
    const hrefMatch = attrs.match(/\bhref=["']([^"']+)["']/i);
    const mediaMatch = attrs.match(/\bmedia-type=["']([^"']+)["']/i);
    const propMatch = attrs.match(/\bproperties=["']([^"']+)["']/i);

    if (idMatch && hrefMatch) {
      const id = idMatch[1];
      let href = hrefMatch[1].trim();
      if (href.includes("#")) href = href.split("#")[0];
      try { href = decodeURIComponent(href); } catch {}
      const cleanHref = href.replace(/^\.?\//, "");
      const fullPath = opfDir ? `${opfDir.replace(/\/$/, "")}/${cleanHref}` : cleanHref;
      manifest.set(id, fullPath);

      if (mediaMatch && mediaMatch[1] === "application/x-dtbncx+xml") {
        ncxId = id;
      }
      if (propMatch && propMatch[1].includes("nav")) {
        navPath = fullPath;
      }
    }
  }

  const spineMatch = xml.match(/<spine\b[^>]*\btoc=["']([^"']+)["']/i);
  if (spineMatch) {
    ncxId = spineMatch[1];
  }
  const ncxPath = ncxId ? manifest.get(ncxId) || null : null;

  const spinePaths: string[] = [];
  const itemrefRegex = /<itemref\b([^>]*?)\/?>/gi;
  while ((match = itemrefRegex.exec(xml)) !== null) {
    const attrs = match[1];
    const idrefMatch = attrs.match(/\bidref=["']([^"']+)["']/i);
    if (idrefMatch) {
      const idref = idrefMatch[1];
      const path = manifest.get(idref);
      if (path && !spinePaths.includes(path)) spinePaths.push(path);
    }
  }

  if (spinePaths.length === 0) {
    for (const [_, path] of manifest.entries()) {
      const lower = path.toLowerCase();
      if (lower.endsWith(".xhtml") || lower.endsWith(".html") || lower.endsWith(".htm")) {
        spinePaths.push(path);
      }
    }
  }

  return {
    title: titleMatch ? titleMatch[1].trim() : "未知书名",
    author: authorMatch ? authorMatch[1].trim() : "未知作者",
    spinePaths,
    ncxPath,
    navPath,
  };
}

interface EpubTocItem {
  title: string;
  href: string;
}

function parseNcxToc(xml: string, opfDir: string): EpubTocItem[] {
  const items: EpubTocItem[] = [];
  const navPointRegex = /<navPoint\b[^>]*>([\s\S]*?)<\/navPoint>/gi;
  let match;
  while ((match = navPointRegex.exec(xml)) !== null) {
    const block = match[1];
    const textMatch = block.match(/<text[^>]*>([\s\S]*?)<\/text>/i);
    const srcMatch = block.match(/<content\b[^>]*\bsrc=["']([^"']+)["']/i);
    if (textMatch && srcMatch) {
      const title = textMatch[1].replace(/<[^>]+>/g, "").trim();
      let src = srcMatch[1].trim();
      try { src = decodeURIComponent(src); } catch {}
      const cleanSrc = src.replace(/^\.?\//, "");
      const fullPath = opfDir ? `${opfDir.replace(/\/$/, "")}/${cleanSrc}` : cleanSrc;
      if (title) {
        items.push({ title, href: fullPath });
      }
    }
  }
  return items;
}

function parseNavXhtmlToc(html: string, opfDir: string): EpubTocItem[] {
  const items: EpubTocItem[] = [];
  const linkRegex = /<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = linkRegex.exec(html)) !== null) {
    let href = match[1].trim();
    const title = match[2].replace(/<[^>]+>/g, "").trim();
    if (title && href) {
      try { href = decodeURIComponent(href); } catch {}
      const cleanHref = href.replace(/^\.?\//, "");
      const fullPath = opfDir ? `${opfDir.replace(/\/$/, "")}/${cleanHref}` : cleanHref;
      items.push({ title, href: fullPath });
    }
  }
  return items;
}

function sliceHtmlByAnchors(html: string, startAnchor: string, nextAnchor?: string): string {
  let startIdx = 0;
  if (startAnchor) {
    const escapedStart = startAnchor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const anchorRegex = new RegExp(`(<[^>]+(?:id|name)=["']${escapedStart}["'][^>]*>)`, "i");
    const match = anchorRegex.exec(html);
    if (match) {
      startIdx = match.index;
    }
  }

  let endIdx = html.length;
  if (nextAnchor) {
    const escapedNext = nextAnchor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const nextRegex = new RegExp(`(<[^>]+(?:id|name)=["']${escapedNext}["'][^>]*>)`, "i");
    const afterStart = html.substring(startIdx + 1);
    const nextMatch = nextRegex.exec(afterStart);
    if (nextMatch) {
      endIdx = startIdx + 1 + nextMatch.index;
    }
  }

  return html.substring(startIdx, endIdx);
}

function sliceHtmlByAnchor(html: string, anchor: string): string {
  return sliceHtmlByAnchors(html, anchor);
}

function rewriteEpubHtmlAssets(html: string, bookId: string, chapterPath: string): string {
  const baseDir = chapterPath.includes("/") ? chapterPath.substring(0, chapterPath.lastIndexOf("/")) : "";

  function resolveRel(src: string): string {
    if (src.startsWith("http://") || src.startsWith("https://") || src.startsWith("data:")) {
      return src;
    }
    const cleanSrc = src.trim().replace(/^['"]|['"]$/g, "");
    const parts = (baseDir ? baseDir.split("/") : []).concat(cleanSrc.split("/"));
    const resolved: string[] = [];
    for (const p of parts) {
      if (!p || p === ".") continue;
      if (p === "..") resolved.pop();
      else resolved.push(p);
    }
    const resolvedPath = resolved.join("/");
    return `/reader3/epub/asset?bookId=${encodeURIComponent(bookId)}&path=${encodeURIComponent(resolvedPath)}`;
  }

  let rewritten = html.replace(/<img\b([^>]*?)\bsrc=["']([^"']+)["']([^>]*?)>/gi, (_match, prefix, src, suffix) => {
    return `<img${prefix}src="${resolveRel(src)}"${suffix}>`;
  });

  rewritten = rewritten.replace(/<image\b([^>]*?)\b(?:href|xlink:href)=["']([^"']+)["']([^>]*?)>/gi, (_match, prefix, href, suffix) => {
    return `<image${prefix}href="${resolveRel(href)}"${suffix}>`;
  });

  return rewritten;
}

async function readZipEntryBytes(r2Key: string, entry: CentralDirEntry, env: Env): Promise<Uint8Array> {
  const localHdrObj = await env.BUCKET.get(r2Key, { range: { offset: entry.localHeaderOffset, length: 30 } });
  if (!localHdrObj) throw new Error("无法读取本地头");
  const localHdrBytes = new Uint8Array(await localHdrObj.arrayBuffer());
  const dataOffset = parseLocalHeaderDataOffset(localHdrBytes, entry.localHeaderOffset);

  const dataObj = await env.BUCKET.get(r2Key, { range: { offset: dataOffset, length: entry.compressedSize } });
  if (!dataObj) throw new Error("无法读取数据切片");
  const dataBytes = new Uint8Array(await dataObj.arrayBuffer());

  if (entry.compressionMethod === 0) {
    return dataBytes;
  } else if (entry.compressionMethod === 8) {
    const stream = new Response(dataBytes as unknown as BodyInit).body!.pipeThrough(new DecompressionStream("deflate-raw"));
    const decompressed = await new Response(stream).arrayBuffer();
    return new Uint8Array(decompressed);
  }
  throw new Error(`不支持的压缩格式: ${entry.compressionMethod}`);
}

export async function handleEpubAsset(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return new Response("Unauthorized", { status: 401, headers: corsHeaders() });

  const url = new URL(request.url);
  const bookId = url.searchParams.get("bookId") || "";
  const rawPath = url.searchParams.get("path") || "";
  if (!bookId || !rawPath) return new Response("Not Found", { status: 404, headers: corsHeaders() });

  const targetPath = decodeURIComponent(rawPath).replace(/^\.?\//, "");

  const detail = await documentHandlers.getBookDetail(env, userNs, bookId);
  if (!detail) return new Response("Book Not Found", { status: 404, headers: corsHeaders() });
  const r2Key = detail.r2Key;
  const fileSize = detail.fileSize || 0;

  const tailSize = Math.min(65536, fileSize);
  const tailObj = await env.BUCKET.get(r2Key, {
    range: { offset: fileSize - tailSize, length: tailSize },
  });
  if (!tailObj) return new Response("Failed to read R2", { status: 500, headers: corsHeaders() });
  const tailBytes = new Uint8Array(await tailObj.arrayBuffer());
  const eocd = findEOCD(tailBytes, fileSize);
  if (!eocd) return new Response("EOCD Not Found", { status: 500, headers: corsHeaders() });

  const cdObj = await env.BUCKET.get(r2Key, {
    range: { offset: eocd.cdOffset, length: eocd.cdSize },
  });
  if (!cdObj) return new Response("Central Directory Not Found", { status: 500, headers: corsHeaders() });
  const cdBytes = new Uint8Array(await cdObj.arrayBuffer());
  const entries = parseCentralDirectory(cdBytes);

  let entry = entries.find((e) => e.fileName === targetPath || e.fileName.replace(/^\.?\//, "") === targetPath);
  if (!entry) {
    const baseName = targetPath.split("/").pop() || "";
    entry = entries.find((e) => e.fileName.endsWith("/" + baseName) || e.fileName === baseName);
  }

  if (!entry) return new Response("Asset Not Found", { status: 404, headers: corsHeaders() });

  const imageBytes = await readZipEntryBytes(r2Key, entry, env);

  let contentType = "application/octet-stream";
  const lower = entry.fileName.toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) contentType = "image/jpeg";
  else if (lower.endsWith(".png")) contentType = "image/png";
  else if (lower.endsWith(".gif")) contentType = "image/gif";
  else if (lower.endsWith(".webp")) contentType = "image/webp";
  else if (lower.endsWith(".svg")) contentType = "image/svg+xml";

  const headers = new Headers(corsHeaders());
  headers.set("Content-Type", contentType);
  headers.set("Cache-Control", "public, max-age=31536000");

  return new Response(imageBytes, { headers });
}

export async function indexEpubIntoDatabase(
  env: Env,
  userNs: string,
  bookId: string,
  fileName: string,
  r2Key: string,
  fileSize: number
): Promise<{ title: string; author: string; totalChapters: number; chapters: Array<{ index: number; title: string; url: string; byteOffset: number; byteLength: number; fileName: string; compressionMethod: number }> }> {
  console.log(`[EpubIndex] start bookId=${bookId} r2Key=${r2Key} fileSize=${fileSize}`);
  const tailSize = Math.min(65536, fileSize);
  const tailObj = await env.BUCKET.get(r2Key, {
    range: { offset: fileSize - tailSize, length: tailSize },
  });
  if (!tailObj) {
    console.log(`[EpubIndex] tailObj not found bookId=${bookId}`);
    throw new Error("无法读取 R2 数据");
  }

  const tailBytes = new Uint8Array(await tailObj.arrayBuffer());
  const eocd = findEOCD(tailBytes, fileSize);
  if (!eocd) {
    console.log(`[EpubIndex] EOCD not found bookId=${bookId}`);
    throw new Error("未找到 EPUB EOCD 记录");
  }

  const cdObj = await env.BUCKET.get(r2Key, {
    range: { offset: eocd.cdOffset, length: eocd.cdSize },
  });
  if (!cdObj) {
    console.log(`[EpubIndex] central directory not found bookId=${bookId}`);
    throw new Error("无法读取中央目录");
  }

  const cdBytes = new Uint8Array(await cdObj.arrayBuffer());
  const entries = parseCentralDirectory(cdBytes);
  const entryMap = new Map(entries.map((e) => [e.fileName, e]));

  const containerEntry = entries.find((e) => e.fileName === "META-INF/container.xml");
  if (!containerEntry) {
    console.log(`[EpubIndex] container.xml not found bookId=${bookId}`);
    throw new Error("缺少 container.xml");
  }

  const containerXml = await readZipEntryText(r2Key, containerEntry, env);
  const opfPath = parseContainerOpfPath(containerXml);
  if (!opfPath) {
    console.log(`[EpubIndex] opfPath not found bookId=${bookId}`);
    throw new Error("缺少 OPF 路径");
  }

  const opfEntry = entries.find(
    (e) => e.fileName === opfPath || e.fileName.endsWith("/" + (opfPath?.split("/").pop() || ""))
  );
  if (!opfEntry) {
    console.log(`[EpubIndex] opfEntry not found bookId=${bookId} opfPath=${opfPath}`);
    throw new Error(`缺少 OPF 文件: ${opfPath}`);
  }

  const opfXml = await readZipEntryText(r2Key, opfEntry, env);
  const opfDir = opfPath.includes("/") ? opfPath.substring(0, opfPath.lastIndexOf("/")) : "";
  const { title, author, spinePaths, ncxPath, navPath } = parseOpfPackage(opfXml, opfDir);

  console.log(`[EpubIndex] parsed bookId=${bookId} title=${title} author=${author} spinePaths=${spinePaths.length} ncxPath=${ncxPath} navPath=${navPath}`);

  let tocItems: EpubTocItem[] = [];
  const targetNcx = ncxPath || "toc.ncx";
  let ncxEntry = entries.find(
    (e) => e.fileName === targetNcx || e.fileName.endsWith("/" + targetNcx) || e.fileName.toLowerCase().endsWith(".ncx")
  );
  if (ncxEntry) {
    try {
      const ncxXml = await readZipEntryText(r2Key, ncxEntry, env);
      const ncxDir = ncxEntry.fileName.includes("/") ? ncxEntry.fileName.substring(0, ncxEntry.fileName.lastIndexOf("/")) : "";
      tocItems = parseNcxToc(ncxXml, ncxDir || opfDir);
    } catch {}
  }

  if (tocItems.length === 0 && navPath) {
    let navEntry = entries.find((e) => e.fileName === navPath || e.fileName.endsWith("/" + navPath));
    if (navEntry) {
      try {
        const navHtml = await readZipEntryText(r2Key, navEntry, env);
        const navDir = navEntry.fileName.includes("/") ? navEntry.fileName.substring(0, navEntry.fileName.lastIndexOf("/")) : "";
        tocItems = parseNavXhtmlToc(navHtml, navDir || opfDir);
      } catch {}
    }
  }

  console.log(`[EpubIndex] TOC items=${tocItems.length} bookId=${bookId}`);

  const now = Math.floor(Date.now() / 1000);
  const chapters: Array<{ index: number; title: string; url: string; byteOffset: number; byteLength: number; fileName: string; compressionMethod: number }> = [];
  let chapterIndex = 0;

  if (tocItems.length > 0) {
    for (const item of tocItems) {
      const filePath = item.href.split("#")[0];
      let entry = entryMap.get(filePath);
      if (!entry) {
        const clean = filePath.replace(/^\.?\//, "");
        entry = entryMap.get(clean);
      }
      if (!entry) {
        const baseName = filePath.split("/").pop() || "";
        entry = entries.find((e) => e.fileName.endsWith("/" + baseName) || e.fileName === baseName);
      }
      if (entry) {
        chapters.push({
          index: chapterIndex++,
          title: item.title,
          url: item.href,
          byteOffset: entry.localHeaderOffset,
          byteLength: entry.compressedSize,
          fileName: entry.fileName,
          compressionMethod: entry.compressionMethod,
        });
      }
    }
  } else {
    for (let i = 0; i < spinePaths.length; i++) {
      const path = spinePaths[i];
      let entry = entryMap.get(path);
      if (!entry) {
        const clean = path.replace(/^\.?\//, "");
        entry = entryMap.get(clean);
      }
      if (!entry) {
        const baseName = path.split("/").pop() || "";
        entry = entries.find((e) => e.fileName.endsWith("/" + baseName) || e.fileName === baseName);
      }
      if (entry) {
        chapters.push({
          index: chapterIndex++,
          title: `第 ${i + 1} 章`,
          url: entry.fileName,
          byteOffset: entry.localHeaderOffset,
          byteLength: entry.compressedSize,
          fileName: entry.fileName,
          compressionMethod: entry.compressionMethod,
        });
      }
    }
  }

  const totalChapters = chapterIndex || spinePaths.length;


  return { title, author, totalChapters, chapters };
}
