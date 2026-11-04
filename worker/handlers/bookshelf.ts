import { jsonResponse } from "../http";
import { resolveUserNs } from "../auth";
import { getEnv } from "../env";
import { Env } from "../types";
import * as documentHandlers from "../handlers/document";
import { triggerOnChangeSync } from "./webdav";
import { md5Hex as md5 } from "../md5";

export async function handleGetBookshelf(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const shelf: any[] = (await documentHandlers.getDocument(env, userNs, "bookshelf.json")) || [];
  return jsonResponse({ isSuccess: true, data: shelf });
}

export async function handleSaveBook(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const book = await request.json<any>();
  if (!book.bookUrl) {
    return jsonResponse({ isSuccess: false, errorMsg: "bookUrl required" });
  }

  const bookId = book.bookId || extractBookId(book.bookUrl);
  if (!bookId) {
    return jsonResponse({ isSuccess: false, errorMsg: "无法解析 bookId" });
  }

  book.bookId = bookId;
  book.updatedAt = Math.floor(Date.now() / 1000);

  // 写入 book_details（一本书一条 JSON，含元数据+章节目录+进度）
  await documentHandlers.saveBookDetail(env, userNs, bookId, book);

  // 更新书架索引（轻量级列表）
  let shelf: any[] = (await documentHandlers.getDocument(env, userNs, "bookshelf.json")) || [];
  const shelfItem = {
    bookId,
    bookUrl: book.bookUrl,
    name: book.name,
    author: book.author,
    origin: book.origin,
    originName: book.originName,
    coverUrl: book.coverUrl,
    durChapterIndex: book.durChapterIndex,
    durChapterPos: book.durChapterPos,
    durChapterTitle: book.durChapterTitle,
    durChapterTime: book.durChapterTime,
    totalChapterNum: book.totalChapterNum,
    kind: book.kind,
    updatedAt: book.updatedAt,
  };
  const idx = shelf.findIndex((b) => b.bookId === bookId || b.bookUrl === book.bookUrl);
  if (idx >= 0) {
    shelf[idx] = { ...shelf[idx], ...shelfItem };
  } else {
    shelf.unshift(shelfItem);
  }
  await documentHandlers.saveDocument(env, userNs, "bookshelf.json", shelf);
  triggerOnChangeSync(env, userNs, ctx);
  return jsonResponse({ isSuccess: true, data: book });
}

export async function handleSaveBooks(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const newBooks = await request.json<any[]>();
  const now = Math.floor(Date.now() / 1000);

  const shelfItems: any[] = [];
  for (const book of newBooks) {
    if (!book.bookUrl) continue;
    const bookId = book.bookId || extractBookId(book.bookUrl);
    if (!bookId) continue;
    book.bookId = bookId;
    book.updatedAt = book.updatedAt || now;
    await documentHandlers.saveBookDetail(env, userNs, bookId, book);
    shelfItems.push({
      bookId,
      bookUrl: book.bookUrl,
      name: book.name,
      author: book.author,
      origin: book.origin,
      originName: book.originName,
      coverUrl: book.coverUrl,
      durChapterIndex: book.durChapterIndex,
      durChapterPos: book.durChapterPos,
      durChapterTitle: book.durChapterTitle,
      durChapterTime: book.durChapterTime,
      totalChapterNum: book.totalChapterNum,
      kind: book.kind,
      updatedAt: book.updatedAt,
    });
  }

  let shelf: any[] = (await documentHandlers.getDocument(env, userNs, "bookshelf.json")) || [];
  for (const item of shelfItems) {
    const idx = shelf.findIndex((b) => b.bookId === item.bookId || b.bookUrl === item.bookUrl);
    if (idx >= 0) {
      shelf[idx] = { ...shelf[idx], ...item };
    } else {
      shelf.unshift(item);
    }
  }
  await documentHandlers.saveDocument(env, userNs, "bookshelf.json", shelf);
  triggerOnChangeSync(env, userNs, ctx);
  return jsonResponse({ isSuccess: true, data: "书架更新成功" });
}

export async function handleDeleteBook(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  try {
    const userNs = await resolveUserNs(request, env);
    if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

    const body = await request.json<any>().catch(() => ({}));
    const bookUrl = body.bookUrl || body.url || "";
    const name = body.name || "";
    const bookId = body.bookId || extractBookId(bookUrl);

    let shelf: any[] = (await documentHandlers.getDocument(env, userNs, "bookshelf.json")) || [];
    shelf = shelf.filter((b) => {
      if (bookUrl && (b.bookUrl === bookUrl || b.url === bookUrl)) return false;
      if (!bookUrl && name && b.name === name) return false;
      return true;
    });

    await documentHandlers.saveDocument(env, userNs, "bookshelf.json", shelf);

    // 删除 book_details
    if (bookId) {
      await documentHandlers.deleteBookDetail(env, userNs, bookId);
    }

    triggerOnChangeSync(env, userNs, ctx);
    return jsonResponse({ isSuccess: true, data: "书籍已移出书架" });
  } catch (err: any) {
    console.error("handleDeleteBook error:", err);
    return jsonResponse({ isSuccess: false, errorMsg: err.message || "删除书籍失败" });
  }
}

export async function handleDeleteBooks(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  try {
    const userNs = await resolveUserNs(request, env);
    if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

    const list = await request.json<any[]>().catch(() => []);
    const deleteUrls = new Set(list.map((b) => (typeof b === "string" ? b : b.bookUrl || b.url)));
    let shelf: any[] = (await documentHandlers.getDocument(env, userNs, "bookshelf.json")) || [];
    shelf = shelf.filter((b) => !deleteUrls.has(b.bookUrl) && !deleteUrls.has(b.url));

    await documentHandlers.saveDocument(env, userNs, "bookshelf.json", shelf);

    // 清理 book_details 和格式表
    const bookIds = list.map((b) => {
      const bookUrl = typeof b === "string" ? b : b.bookUrl || b.url;
      const bookId = typeof b === "string" ? null : b.bookId;
      if (!bookUrl) return null;
      return { bookId: bookId || extractBookId(bookUrl), bookUrl };
    }).filter(Boolean);

    if (bookIds.length > 0) {
      const stmts: any[] = [];
      for (const item of bookIds) {
        if (item.bookId) {
          stmts.push(env.DB.prepare(`DELETE FROM book_details WHERE book_id = ?1 AND user_ns = ?2`).bind(item.bookId, userNs).run());
        }
      }
      if (stmts.length > 0) {
        ctx.waitUntil(Promise.allSettled(stmts));
      }
    }

    triggerOnChangeSync(env, userNs, ctx);
    return jsonResponse({ isSuccess: true, data: "批量删除成功" });
  } catch (err: any) {
    console.error("handleDeleteBooks error:", err);
    return jsonResponse({ isSuccess: false, errorMsg: err.message || "批量删除失败" });
  }
}

export async function handleSaveBookProgress(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const progress = await request.json<any>();
  const targetUrl = progress.bookUrl || progress.url;
  const bookId = progress.bookId || extractBookId(targetUrl);
  if (!bookId) {
    return jsonResponse({ isSuccess: false, errorMsg: "缺少 bookId" });
  }

  const durChapterIndex = progress.durChapterIndex !== undefined ? progress.durChapterIndex : progress.index;
  const durChapterPos = progress.durChapterPos !== undefined ? progress.durChapterPos : progress.position;
  const durChapterTitle = progress.durChapterTitle;
  const durChapterTime = progress.durChapterTime || Date.now();

  // 更新 book_details 中的进度
  const detail = await documentHandlers.getBookDetail(env, userNs, bookId);
  if (detail) {
    if (durChapterIndex !== undefined) detail.durChapterIndex = durChapterIndex;
    if (durChapterPos !== undefined) detail.durChapterPos = durChapterPos;
    if (durChapterTitle) detail.durChapterTitle = durChapterTitle;
    detail.durChapterTime = durChapterTime;
    await documentHandlers.saveBookDetail(env, userNs, bookId, detail);
  }

  // 同步更新书架索引
  let shelf: any[] = (await documentHandlers.getDocument(env, userNs, "bookshelf.json")) || [];
  const idx = shelf.findIndex((b) => b.bookId === bookId || b.bookUrl === targetUrl);
  if (idx >= 0) {
    shelf[idx] = {
      ...shelf[idx],
      durChapterIndex: durChapterIndex !== undefined ? durChapterIndex : shelf[idx].durChapterIndex,
      durChapterPos: durChapterPos !== undefined ? durChapterPos : shelf[idx].durChapterPos,
      durChapterTitle: durChapterTitle || shelf[idx].durChapterTitle,
      durChapterTime,
    };
    await documentHandlers.saveDocument(env, userNs, "bookshelf.json", shelf);
  }

  triggerOnChangeSync(env, userNs, ctx);
  return jsonResponse({ isSuccess: true, data: "进度已同步" });
}


export function getDynamicHeaders(source: any, targetUrl = ""): Record<string, string> {
  let domain = "";
  try {
    const u = targetUrl || source?.bookSourceUrl || "";
    if (u) domain = new URL(u).origin;
  } catch {}

  const headers: Record<string, string> = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml,application/json;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9",
  };
  const isIp = /^https?:\/\/\d+\.\d+\.\d+\.\d+/.test(targetUrl);
  if (domain && !isIp) {
    headers["Referer"] = `${domain}/`;
  }

  const isXiaoXiao = (targetUrl && targetUrl.includes("chuangke.tv")) || (source?.bookSourceUrl || "").includes("chuangke.tv");
  if (isXiaoXiao) {
    const pkg = "com.xxyuedu.chasingbooks";
    const ts = Math.round(Date.now() / 1000);
    const sign = md5(`${pkg}1${ts}vhjJVz1St6tK7!8n#B0MqRIuE2Dh7!C#`);
    headers["pt"] = "1";
    headers["time"] = String(ts);
    headers["sign"] = sign;
    headers["package"] = pkg;
    headers["User-Agent"] = `Mozilla/5.0 (iPhone; CPU iPhone OS 7_1_2 like Mac OS X) AppleWebKit/537.51.2 (KHTML, like Gecko) Version/7.0 Mobile/11D167 Safari/9537.53_${pkg}`;
    return headers;
  }

  if (source?.header) {
    const hdr = String(source.header).trim();
    if (!hdr.startsWith("@js:")) {
      try {
        Object.assign(headers, JSON.parse(hdr));
      } catch {}
    }
  }

  return headers;
}

// ==========================================
// Stubs for routes referenced by router.ts but not yet implemented
// ==========================================

export async function handleSetBookSource(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const body = await request.json<any>();
  const { bookUrl, bookSourceUrl } = body;
  if (!bookUrl || !bookSourceUrl) {
    return jsonResponse({ isSuccess: false, errorMsg: "缺少bookurl 1" });
  }

  const bookId = extractBookId(bookUrl);

  // 更新 book_details
  if (bookId) {
    const detail = await documentHandlers.getBookDetail(env, userNs, bookId);
    if (detail) {
      detail.bookSourceUrl = bookSourceUrl;
      detail.source = bookSourceUrl;
      detail.origin = bookSourceUrl;
      await documentHandlers.saveBookDetail(env, userNs, bookId, detail);
    }
  }

  // 更新书架索引
  let shelf: any[] = (await documentHandlers.getDocument(env, userNs, "bookshelf.json")) || [];
  const idx = shelf.findIndex((b) => b.bookUrl === bookUrl || b.bookId === bookId);
  if (idx < 0) {
    return jsonResponse({ isSuccess: false, errorMsg: "书架中未找到该书籍" });
  }
  shelf[idx] = { ...shelf[idx], bookSourceUrl, source: bookSourceUrl };
  await documentHandlers.saveDocument(env, userNs, "bookshelf.json", shelf);
  return jsonResponse({ isSuccess: true, data: "书源已绑定" });
}

export async function handleSaveBookGroupId(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const body = await request.json<any>();
  const { bookUrl, groupId } = body;
  if (!bookUrl || groupId === undefined) {
    return jsonResponse({ isSuccess: false, errorMsg: "缺少bookurl 2" });
  }

  const bookId = extractBookId(bookUrl);

  // 更新 book_details
  if (bookId) {
    const detail = await documentHandlers.getBookDetail(env, userNs, bookId);
    if (detail) {
      detail.groupId = groupId;
      await documentHandlers.saveBookDetail(env, userNs, bookId, detail);
    }
  }

  // 更新书架索引
  let shelf: any[] = (await documentHandlers.getDocument(env, userNs, "bookshelf.json")) || [];
  const idx = shelf.findIndex((b) => b.bookUrl === bookUrl || b.bookId === bookId);
  if (idx < 0) {
    return jsonResponse({ isSuccess: false, errorMsg: "书架中未找到该书籍" });
  }
  shelf[idx] = { ...shelf[idx], groupId };
  await documentHandlers.saveDocument(env, userNs, "bookshelf.json", shelf);
  triggerOnChangeSync(env, userNs, ctx);
  return jsonResponse({ isSuccess: true, data: "分组 ID 已保存" });
}

export async function handleGetShelfBook(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const url = new URL(request.url);
  const bookUrl = url.searchParams.get("bookUrl") || url.searchParams.get("url") || "";
  const bookId = url.searchParams.get("bookId") || "";
  if (!bookUrl && !bookId) {
    return jsonResponse({ isSuccess: false, errorMsg: "缺少bookurl或bookId" });
  }

  // 优先从 book_details 读取完整详情
  const bid = bookId || extractBookId(bookUrl);
  if (bid) {
    const detail = await documentHandlers.getBookDetail(env, userNs, bid);
    if (detail) {
      return jsonResponse({ isSuccess: true, data: detail });
    }
  }

  // Fallback to bookshelf index
  const shelf: any[] = (await documentHandlers.getDocument(env, userNs, "bookshelf.json")) || [];
  const book = shelf.find((b) => b.bookUrl === bookUrl || b.url === bookUrl || b.bookId === bookId);
  if (!book) {
    return jsonResponse({ isSuccess: false, errorMsg: "书架中未找到该书籍" });
  }
  return jsonResponse({ isSuccess: true, data: book });
}

export async function handleGetShelfBookWithCacheInfo(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const url = new URL(request.url);
  const bookUrl = url.searchParams.get("bookUrl") || url.searchParams.get("url") || "";

  const shelf: any[] = (await documentHandlers.getDocument(env, userNs, "bookshelf.json")) || [];

  // 如果没有指定 bookUrl，返回全部书架书籍的缓存信息列表（供 fetchBooks 使用）
  if (!bookUrl) {
    const list = shelf.map((b) => ({
      ...b,
      cacheInfo: {
        bookUrl: b.bookUrl || b.url || "",
        hasEpubCache: (b.bookUrl || b.url || "").startsWith("local-epub:"),
        hasTxtCache: (b.bookUrl || b.url || "").startsWith("local-txt:"),
        hasPdfCache: (b.bookUrl || b.url || "").startsWith("local-pdf:"),
        durChapterIndex: b.durChapterIndex ?? 0,
        durChapterPos: b.durChapterPos ?? 0,
        durChapterTitle: b.durChapterTitle ?? "",
        durChapterTime: b.durChapterTime ?? 0,
        totalChapterNum: b.totalChapterNum ?? 0,
      },
    }));
    return jsonResponse({ isSuccess: true, data: list });
  }

  const book = shelf.find((b) => b.bookUrl === bookUrl || b.url === bookUrl);
  if (!book) {
    return jsonResponse({ isSuccess: false, errorMsg: "书架中未找到该书籍" });
  }

  // 构建单本书缓存信息
  const cacheInfo = {
    bookUrl,
    hasEpubCache: bookUrl.startsWith("local-epub:"),
    hasTxtCache: bookUrl.startsWith("local-txt:"),
    hasPdfCache: bookUrl.startsWith("local-pdf:"),
    durChapterIndex: book.durChapterIndex ?? 0,
    durChapterPos: book.durChapterPos ?? 0,
    durChapterTitle: book.durChapterTitle ?? "",
    durChapterTime: book.durChapterTime ?? 0,
    totalChapterNum: book.totalChapterNum ?? 0,
  };

  return jsonResponse({ isSuccess: true, data: { ...book, cacheInfo } });
}

export async function handleGetBookInfo(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  let url = new URL(request.url).searchParams.get("url") || "";
  const bookId = new URL(request.url).searchParams.get("bookId") || "";
  if (!url && request.method === "POST") {
    try {
      const body = await request.json<any>();
      url = body.url || "";
    } catch {}
  }

  // 优先从 book_details 读取完整详情
  const bid = bookId || extractBookId(url);
  if (bid) {
    const detail = await documentHandlers.getBookDetail(env, userNs, bid);
    if (detail) {
      return jsonResponse({ isSuccess: true, data: detail });
    }
  }


  // Fallback to bookshelf
  const shelf: any[] = (await documentHandlers.getDocument(env, userNs, "bookshelf.json")) || [];
  const book = shelf.find((b) => b.bookUrl === url);
  return jsonResponse({ isSuccess: true, data: book || { bookUrl: url, name: "书籍详情" } });
}

export async function handleGetChapterList(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  let bookUrl = new URL(request.url).searchParams.get("bookUrl") || "";
  let tocUrl = new URL(request.url).searchParams.get("tocUrl") || "";
  let bookName = "";
  if (request.method === "POST") {
    try {
      const body = await request.json<any>();
      bookUrl = body.bookUrl || bookUrl;
      tocUrl = body.tocUrl || tocUrl;
      bookName = (body.name || "").trim();
    } catch {}
  }

  const targetUrl = bookUrl || tocUrl;
  const cleanTarget = decodeURIComponent(targetUrl);
  const fileNameCandidate = cleanTarget.split("/").pop()?.split("#")[0]?.trim() || "";

  // 1. Local books: read chapters from book_details JSON (one book, one JSON)
  if (targetUrl.startsWith("local-txt:") || targetUrl.startsWith("local-epub:") || targetUrl.startsWith("local-pdf:")) {
    const bookId = targetUrl.split(":")[1]?.split("#")[0] || "";
    if (bookId) {
      const detail = await documentHandlers.getBookDetail(env, userNs, bookId);
      if (detail && Array.isArray(detail.chapters) && detail.chapters.length > 0) {
        const chapters = detail.chapters.map((ch: any, i: number) => ({
          index: ch.index ?? i,
          title: ch.title,
          url: ch.url || (`local-${detail.kind?.includes("TXT") ? "txt" : detail.kind?.includes("EPUB") ? "epub" : "pdf"}:${bookId}#${ch.index ?? i}`),
          byteOffset: ch.byteOffset,
          byteLength: ch.byteLength,
        }));
        return jsonResponse({ isSuccess: true, data: chapters });
      }
      // PDF: generate page list from totalChapterNum
      if (targetUrl.startsWith("local-pdf:") && detail) {
        const count = Math.max(1, detail.totalChapterNum || 1);
        const chapters = Array.from({ length: count }, (_, i) => ({
          index: i,
          title: `第 ${i + 1} 页`,
          url: `local-pdf:${bookId}#${i}`,
        }));
        return jsonResponse({ isSuccess: true, data: chapters });
      }
    }
    return jsonResponse({ isSuccess: false, errorMsg: "书籍不存在，请重新上传" });
  }


  return jsonResponse({ isSuccess: true, data: [] });
}

function extractBookId(bookUrl: string): string | null {
  if (!bookUrl) return null;
  const m = bookUrl.match(/^local-(txt|epub|pdf):([^#]+)/);
  if (m) return m[2];
  // 在线书源：用 bookUrl 本身作为 bookId
  return bookUrl;
}
