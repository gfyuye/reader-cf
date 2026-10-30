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

  const shelfDoc = await documentHandlers.getDocument(env, userNs, "bookshelf.json");
  return jsonResponse({ isSuccess: true, data: shelfDoc || [] });
}

export async function handleSaveBook(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const book = await request.json<any>();
  let shelf: any[] = (await documentHandlers.getDocument(env, userNs, "bookshelf.json")) || [];

  const idx = shelf.findIndex((b) => b.bookUrl === book.bookUrl);
  if (idx >= 0) {
    shelf[idx] = { ...shelf[idx], ...book };
  } else {
    shelf.unshift(book);
  }

  await documentHandlers.saveDocument(env, userNs, "bookshelf.json", shelf);
  triggerOnChangeSync(env, userNs, ctx);
  return jsonResponse({ isSuccess: true, data: book });
}

export async function handleSaveBooks(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const newBooks = await request.json<any[]>();
  let shelf: any[] = (await documentHandlers.getDocument(env, userNs, "bookshelf.json")) || [];

  for (const book of newBooks) {
    const idx = shelf.findIndex((b) => b.bookUrl === book.bookUrl);
    if (idx >= 0) {
      shelf[idx] = { ...shelf[idx], ...book };
    } else {
      shelf.unshift(book);
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

    let shelf: any[] = (await documentHandlers.getDocument(env, userNs, "bookshelf.json")) || [];
    shelf = shelf.filter((b) => {
      if (bookUrl && (b.bookUrl === bookUrl || b.url === bookUrl)) return false;
      if (!bookUrl && name && b.name === name) return false;
      return true;
    });

    await documentHandlers.saveDocument(env, userNs, "bookshelf.json", shelf);

    if (bookUrl.startsWith("local-epub:")) {
      const bookId = bookUrl.split(":")[1]?.split("#")[0];
      if (bookId) {
        ctx.waitUntil(Promise.allSettled([
          env.DB.prepare(`DELETE FROM epub_chapters WHERE book_id = ?1`).bind(bookId).run(),
          env.DB.prepare(`DELETE FROM epub_books WHERE book_id = ?1`).bind(bookId).run(),
        ]));
      }
    } else if (bookUrl.startsWith("local-txt:")) {
      const bookId = bookUrl.split(":")[1]?.split("#")[0];
      if (bookId) {
        ctx.waitUntil(Promise.allSettled([
          env.DB.prepare(`DELETE FROM txt_chapters WHERE book_id = ?1`).bind(bookId).run(),
          env.DB.prepare(`DELETE FROM txt_books WHERE book_id = ?1`).bind(bookId).run(),
        ]));
      }
    } else if (bookUrl.startsWith("local-pdf:")) {
      const bookId = bookUrl.split(":")[1]?.split("#")[0];
      if (bookId) {
        ctx.waitUntil(Promise.allSettled([
          env.DB.prepare(`DELETE FROM pdf_outlines WHERE book_id = ?1`).bind(bookId).run(),
          env.DB.prepare(`DELETE FROM pdf_books WHERE book_id = ?1`).bind(bookId).run(),
        ]));
      }
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
  let shelf: any[] = (await documentHandlers.getDocument(env, userNs, "bookshelf.json")) || [];

  const targetUrl = progress.bookUrl || progress.url;
  const idx = shelf.findIndex((b) => b.bookUrl === targetUrl);
  if (idx >= 0) {
    const durChapterIndex = progress.durChapterIndex !== undefined ? progress.durChapterIndex : progress.index;
    const durChapterPos = progress.durChapterPos !== undefined ? progress.durChapterPos : progress.position;
    const durChapterTitle = progress.durChapterTitle || shelf[idx].durChapterTitle;
    const durChapterTime = progress.durChapterTime || Date.now();
    shelf[idx] = {
      ...shelf[idx],
      durChapterIndex: durChapterIndex !== undefined ? durChapterIndex : shelf[idx].durChapterIndex,
      durChapterTitle,
      durChapterPos: durChapterPos !== undefined ? durChapterPos : shelf[idx].durChapterPos,
      durChapterTime,
    };
    await documentHandlers.saveDocument(env, userNs, "bookshelf.json", shelf);
    triggerOnChangeSync(env, userNs, ctx);
  }

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
    return jsonResponse({ isSuccess: false, errorMsg: "缺少 bookUrl 或 bookSourceUrl" });
  }

  let shelf: any[] = (await documentHandlers.getDocument(env, userNs, "bookshelf.json")) || [];
  const idx = shelf.findIndex((b) => b.bookUrl === bookUrl);
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
    return jsonResponse({ isSuccess: false, errorMsg: "缺少 bookUrl 或 groupId" });
  }

  let shelf: any[] = (await documentHandlers.getDocument(env, userNs, "bookshelf.json")) || [];
  const idx = shelf.findIndex((b) => b.bookUrl === bookUrl);
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
  if (!bookUrl) {
    return jsonResponse({ isSuccess: false, errorMsg: "缺少 bookUrl" });
  }

  const shelf: any[] = (await documentHandlers.getDocument(env, userNs, "bookshelf.json")) || [];
  const book = shelf.find((b) => b.bookUrl === bookUrl || b.url === bookUrl);
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
  if (!bookUrl) {
    return jsonResponse({ isSuccess: false, errorMsg: "缺少 bookUrl" });
  }

  const shelf: any[] = (await documentHandlers.getDocument(env, userNs, "bookshelf.json")) || [];
  const book = shelf.find((b) => b.bookUrl === bookUrl || b.url === bookUrl);
  if (!book) {
    return jsonResponse({ isSuccess: false, errorMsg: "书架中未找到该书籍" });
  }

  // 构建缓存信息
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
