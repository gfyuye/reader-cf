import { ENV_DEFAULTS } from "./env-defaults";
import { md5Hex as md5 } from "./md5";
import {
  parseSearchResultsWithRules,
  parseChapterListWithRules,
  parseContentWithRules,
  executeLegadoJs,
} from "./legado-engine";
import { Env, EpubQueueMessage } from "./types";
import { corsHeaders, jsonResponse, getAccessToken } from "./http";
import { getEnv } from "./env";
import { randomString, isSafeRemoteUrl, fetchTextWithEncoding } from "./utils";
import { isAuthorizedAdmin, resolveUserNs } from "./auth";
import * as documentHandlers from "./handlers/document";
import * as authHandlers from "./handlers/auth";
import * as userAdminHandlers from "./handlers/user-admin";
import * as cryptoUtils from "./crypto";

export type { Env, EpubQueueMessage, CentralDirEntry, EpubTocItem } from "./types";

/**
 * Cloudflare Worker Backend for reader-rust
 * Full Serverless implementation on Cloudflare Edge:
 * - D1 Database: Users, Sessions, Book Sources, Bookmarks, Replace Rules, AI Memory, EPUB/PDF/MOBI Index
 * - R2 Object Storage: EPUB, PDF, MOBI, Uploaded Assets, Book Covers
 * - Cloudflare Queues: Chunked EPUB parsing under free tier time budget
 * - Kitesurf Browser Rendering: Dynamic JavaScript crawling with 429 cooldown & fallback
 * - Zero-parse Range streaming: EPUB, PDF (206 Partial Content), MOBI
 */

/**
 * Reads variable from runtime env (Cloudflare Dashboard / Secrets) with build-time fallback from .env.example
 */

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // 0. Handle CORS Preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(),
      });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // 1. User Authentication & Profile
      if (path === "/reader3/login" && request.method === "POST") {
        return authHandlers.handleLogin(request, env);
      }
      if (path === "/reader3/logout" && request.method === "POST") {
        return authHandlers.handleLogout(request, env);
      }
      if (path === "/reader3/getUserInfo" && request.method === "GET") {
        return authHandlers.handleGetUserInfo(request, env);
      }

      // 2. Book Sources (书源管理 - D1)
      if (path === "/reader3/getBookSources") {
        return handleGetBookSources(request, env);
      }
      if (path === "/reader3/getBookSource") {
        return handleGetBookSource(request, env);
      }
      if (path === "/reader3/saveBookSource" && request.method === "POST") {
        return handleSaveBookSource(request, env, ctx);
      }
      if (path === "/reader3/saveBookSources" && request.method === "POST") {
        return handleSaveBookSources(request, env, ctx);
      }
      if (path === "/reader3/deleteBookSource" && request.method === "POST") {
        return handleDeleteBookSource(request, env, ctx);
      }
      if (path === "/reader3/deleteBookSources" && request.method === "POST") {
        return handleDeleteBookSources(request, env, ctx);
      }
      if (path === "/reader3/deleteAllBookSources" && request.method === "POST") {
        return handleDeleteAllBookSources(request, env, ctx);
      }
      if (path === "/reader3/readRemoteSourceFile" && request.method === "POST") {
        return handleReadRemoteSourceFile(request, env);
      }

      // Multi-Source Search (Client-Driven Chunking / Scheme 1)
      if (path === "/reader3/searchBookMulti" && request.method === "POST") {
        return handleSearchBookMulti(request, env);
      }
      if (path === "/reader3/testBookSources" && request.method === "POST") {
        return handleTestBookSources(request, env);
      }
      if (path === "/reader3/exploreBook" && request.method === "POST") {
        return handleExploreBook(request, env);
      }

      // 3. Bookshelf & Reading Progress (书架与进度 - D1)
      if ((path === "/reader3/getBookshelf" || path === "/reader3/getShelfBookWithCacheInfo") && request.method === "GET") {
        return handleGetBookshelf(request, env);
      }
      if (path === "/reader3/saveBook" && request.method === "POST") {
        return handleSaveBook(request, env, ctx);
      }
      if (path === "/reader3/saveBooks" && request.method === "POST") {
        return handleSaveBooks(request, env, ctx);
      }
      if (path === "/reader3/deleteBook" && request.method === "POST") {
        return handleDeleteBook(request, env, ctx);
      }
      if (path === "/reader3/deleteBooks" && request.method === "POST") {
        return handleDeleteBooks(request, env, ctx);
      }
      if (path === "/reader3/saveBookProgress" && request.method === "POST") {
        return handleSaveBookProgress(request, env, ctx);
      }
      if (path === "/reader3/getShelfBook") {
        return handleGetShelfBook(request, env);
      }
      if (path === "/reader3/getBookInfo") {
        return handleGetBookInfo(request, env);
      }
      if (path === "/reader3/getChapterList") {
        return handleGetChapterList(request, env);
      }
      if (path === "/reader3/saveBookGroupId" && request.method === "POST") {
        return handleSaveBookGroupId(request, env, ctx);
      }

      // 4. Chapter Content Router (EPUB, PDF, MOBI, Web)
      if (path === "/reader3/getBookContent") {
        return handleGetBookContent(request, env);
      }

      // 5. Document Management: Bookmarks, ReplaceRules, BookGroups
      if (path === "/reader3/getBookmarks") return documentHandlers.handleGetDocument(request, env, "bookmark.json");
      if (path === "/reader3/saveBookmark" && request.method === "POST") return documentHandlers.handleSaveDocumentItem(request, env, "bookmark.json", ctx);
      if (path === "/reader3/deleteBookmark" && request.method === "POST") return documentHandlers.handleDeleteDocumentItem(request, env, "bookmark.json", ctx);

      if (path === "/reader3/getReplaceRules") return documentHandlers.handleGetDocument(request, env, "replaceRule.json");
      if (path === "/reader3/saveReplaceRule" && request.method === "POST") return documentHandlers.handleSaveDocumentItem(request, env, "replaceRule.json", ctx);
      if (path === "/reader3/deleteReplaceRule" && request.method === "POST") return documentHandlers.handleDeleteDocumentItem(request, env, "replaceRule.json", ctx);

      if (path === "/reader3/getBookGroups") return documentHandlers.handleGetDocument(request, env, "bookGroup.json");
      if (path === "/reader3/saveBookGroup" && request.method === "POST") return documentHandlers.handleSaveDocumentItem(request, env, "bookGroup.json", ctx);
      if (path === "/reader3/deleteBookGroup" && request.method === "POST") return documentHandlers.handleDeleteDocumentItem(request, env, "bookGroup.json", ctx);

      // RSS Sources & Articles
      if (path === "/reader3/getRssSources") return documentHandlers.handleGetDocument(request, env, "rssSource.json");
      if (path === "/reader3/saveRssSource" && request.method === "POST") return documentHandlers.handleSaveDocumentItem(request, env, "rssSource.json", ctx);
      if (path === "/reader3/saveRssSources" && request.method === "POST") return documentHandlers.handleSaveDocumentItems(request, env, "rssSource.json", ctx);
      if (path === "/reader3/deleteRssSource" && request.method === "POST") return documentHandlers.handleDeleteDocumentItem(request, env, "rssSource.json", ctx);
      if (path === "/reader3/deleteRssSources" && request.method === "POST") return documentHandlers.handleDeleteDocumentItems(request, env, "rssSource.json", ctx);
      if (path === "/reader3/getRssArticles") return handleGetRssArticles(request, env);
      if (path === "/reader3/getRssContent") return handleGetRssContent(request, env);

      // 6. EPUB Streaming & Indexing
      if ((path === "/reader3/epub/upload" || path === "/reader3/uploadEpubBook") && request.method === "POST") return handleEpubUpload(request, env);
      if (path === "/reader3/epub/read" && request.method === "GET") {
        const bookId = url.searchParams.get("bookId") || "";
        const pageIndex = parseInt(url.searchParams.get("page") || "0", 10);
        return handleEpubRead(bookId, pageIndex, env);
      }
      if (path === "/reader3/epub/status" && request.method === "GET") {
        return handleEpubStatus(url.searchParams.get("bookId") || "", env);
      }
      if (path === "/reader3/epub/asset" && request.method === "GET") {
        return handleEpubAsset(request, env);
      }

      // 7. PDF Streaming & TOC
      if ((path === "/reader3/pdf/upload" || path === "/reader3/uploadPdfBook") && request.method === "POST") return handlePdfUpload(request, env);
      if (path === "/reader3/pdf/stream" && request.method === "GET") return handlePdfStream(request, env);
      if (path === "/reader3/pdf/info" && request.method === "GET") return handlePdfInfo(url.searchParams.get("bookId") || "", env);
      if (path === "/reader3/pdf/toc" && request.method === "GET") return handlePdfToc(url.searchParams.get("bookId") || "", env);

      // 8. TXT Streaming & Heading Indexing
      if ((path === "/reader3/txt/upload" || path === "/reader3/uploadLocalBook" || path === "/reader3/uploadTxtBook") && request.method === "POST") {
        return handleTxtUpload(request, env, ctx);
      }
      if (path === "/reader3/txt/read" && request.method === "GET") {
        const bookId = url.searchParams.get("bookId") || "";
        const chapterIndex = parseInt(url.searchParams.get("index") || "0", 10);
        return handleTxtRead(bookId, chapterIndex, env);
      }
      if (path === "/reader3/txt/info" && request.method === "GET") {
        return handleTxtInfo(url.searchParams.get("bookId") || "", env);
      }

      // 10. WebDAV Book Import & Move
      if (path === "/reader3/importWebdavBook" && request.method === "POST") {
        return handleImportWebdavBook(request, env, ctx);
      }

      // Chunked Upload for Big Files (100MB ~ 1GB+)
      if (path === "/reader3/upload/init" && request.method === "POST") return handleChunkedUploadInit(request, env);
      if (path === "/reader3/upload/part" && request.method === "POST") return handleChunkedUploadPart(request, env);
      if (path === "/reader3/upload/complete" && request.method === "POST") return handleChunkedUploadComplete(request, env, ctx);

      // 10. Assets & Covers (R2)
      if (path === "/reader3/uploadFile" && request.method === "POST") return handleUploadFile(request, env);
      if (path === "/reader3/deleteFile" && request.method === "POST") return handleDeleteFile(request, env);
      if (path.startsWith("/assets/") || path === "/reader3/cover") return handleGetAsset(request, env);

      // 10. WebDAV Protocol & REST APIs (for Web & App)
      if (path.startsWith("/reader3/webdav")) return handleWebdav(request, env);
      if (path === "/reader3/getWebdavFileList" && request.method === "GET") return handleGetWebdavFileList(request, env);
      if (path === "/reader3/getWebdavFile" && request.method === "GET") return handleGetWebdavFile(request, env);
      if (path === "/reader3/uploadFileToWebdav" && request.method === "POST") return handleUploadFileToWebdav(request, env);
      if (path === "/reader3/deleteWebdavFile" && request.method === "POST") return handleDeleteWebdavFile(request, env);
      if (path === "/reader3/deleteWebdavFileList" && request.method === "POST") return handleDeleteWebdavFileList(request, env);

      // User Management
      if (path === "/reader3/changePassword" && request.method === "POST") return userAdminHandlers.handleChangePassword(request, env);
      if (path === "/reader3/getUserList") return userAdminHandlers.handleGetUserList(request, env);
      if (path === "/reader3/addUser" && request.method === "POST") return userAdminHandlers.handleAddUser(request, env);
      if (path === "/reader3/updateUser" && request.method === "POST") return userAdminHandlers.handleUpdateUser(request, env);
      if (path === "/reader3/deleteUsers" && request.method === "POST") return userAdminHandlers.handleDeleteUsers(request, env);
      if (path === "/reader3/resetPassword" && request.method === "POST") return userAdminHandlers.handleResetPassword(request, env);

      // 11. Remote WebDAV Sync Configuration & Actions
      if (path === "/reader3/user/remoteWebdav" && request.method === "GET") {
        return handleGetRemoteWebdav(request, env);
      }
      if (path === "/reader3/user/remoteWebdav" && request.method === "POST") {
        return handleSaveRemoteWebdav(request, env);
      }
      if (path === "/reader3/user/remoteWebdav/test" && request.method === "POST") {
        return handleTestRemoteWebdav(request, env);
      }
      if (path === "/reader3/user/remoteWebdav/syncNow" && request.method === "POST") {
        return handleSyncRemoteWebdavNow(request, env);
      }

      // 12. AI Companion & Reading Assistant (D1 + LLM Proxy)
      if (path === "/reader3/getAiBookMemory") return handleGetAiBookMemory(request, env);
      if (path === "/reader3/saveAiBookMemory" && request.method === "POST") return handleSaveAiBookMemory(request, env);
      if (path === "/reader3/deleteAiBookMemory" && request.method === "POST") return handleDeleteAiBookMemory(request, env);
      if (path === "/reader3/getAiModelConfig") return documentHandlers.handleGetDocument(request, env, "ai-model-config.json");
      if (path === "/reader3/saveAiModelConfig" && request.method === "POST") return documentHandlers.handleSaveDocumentItem(request, env, "ai-model-config.json", ctx);
      if (path === "/reader3/aiProxy" && request.method === "POST") return handleAiProxy(request, env);
      if (path === "/reader3/aiProxyImage" && request.method === "POST") return handleAiProxyImage(request, env);

      // Health check
      if (path === "/health") {
        return jsonResponse({ status: "ok", service: "reader-rust-cloudflare-worker" });
      }

      // Fallback to static assets if binding exists
      if (env.ASSETS) {
        return env.ASSETS.fetch(request);
      }

      return jsonResponse({ isSuccess: false, errorMsg: "接口未找到" }, 404);
    } catch (err: any) {
      return jsonResponse({ isSuccess: false, errorMsg: err.message || "服务器内部错误" }, 500);
    }
  },
};

// ==========================================
// 1. User Authentication & Sessions (D1)
// ==========================================

async function handleGetBookSources(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const rows = await env.DB.prepare(
    `SELECT json FROM book_sources WHERE user_ns = ?1 ORDER BY updated_at DESC`
  )
    .bind(userNs)
    .all<{ json: string }>();

  const list = (rows.results || []).map((r) => {
    try {
      return JSON.parse(r.json);
    } catch {
      return null;
    }
  }).filter(Boolean);

  return jsonResponse({ isSuccess: true, data: list });
}

async function handleGetBookSource(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const url = new URL(request.url);
  const sourceUrl = url.searchParams.get("url") || "";

  const row = await env.DB.prepare(
    `SELECT json FROM book_sources WHERE user_ns = ?1 AND book_source_url = ?2`
  )
    .bind(userNs, sourceUrl)
    .first<{ json: string }>();

  if (!row) return jsonResponse({ isSuccess: false, errorMsg: "未找到该书源" });
  return jsonResponse({ isSuccess: true, data: JSON.parse(row.json) });
}

async function handleSaveBookSource(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const source = await request.json<any>();
  const sourceUrl = source.bookSourceUrl || "";
  const sourceName = source.bookSourceName || "";
  if (!sourceUrl) return jsonResponse({ isSuccess: false, errorMsg: "书源地址不能为空" });

  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `INSERT INTO book_sources (user_ns, book_source_url, book_source_name, json, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5)
     ON CONFLICT(user_ns, book_source_url) DO UPDATE SET
     book_source_name=excluded.book_source_name, json=excluded.json, updated_at=excluded.updated_at`
  )
    .bind(userNs, sourceUrl, sourceName, JSON.stringify(source), now)
    .run();

  triggerOnChangeSync(env, userNs, ctx);
  return jsonResponse({ isSuccess: true, data: "保存成功" });
}

async function handleSaveBookSources(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const sources = await request.json<any[]>();
  if (!Array.isArray(sources)) return jsonResponse({ isSuccess: false, errorMsg: "格式错误" });

  const existingRows = await env.DB.prepare(
    `SELECT book_source_url, json FROM book_sources WHERE user_ns = ?1`
  ).bind(userNs).all<{ book_source_url: string; json: string }>();
  const existingMap = new Map((existingRows.results || []).map((r) => [r.book_source_url, r.json]));

  const now = Math.floor(Date.now() / 1000);
  const toWrite = sources.filter((s) => {
    if (!s || !s.bookSourceUrl) return false;
    const oldJson = existingMap.get(s.bookSourceUrl);
    if (!oldJson) return true;
    return oldJson !== JSON.stringify(s);
  });

  if (toWrite.length > 0) {
    const stmts = toWrite.map((s) =>
      env.DB.prepare(
        `INSERT INTO book_sources (user_ns, book_source_url, book_source_name, json, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(user_ns, book_source_url) DO UPDATE SET
         book_source_name=excluded.book_source_name, json=excluded.json, updated_at=excluded.updated_at`
      ).bind(userNs, s.bookSourceUrl, s.bookSourceName || "", JSON.stringify(s), now)
    );

    for (let i = 0; i < stmts.length; i += 50) {
      await env.DB.batch(stmts.slice(i, i + 50));
    }
  }

  triggerOnChangeSync(env, userNs, ctx);
  return jsonResponse({ isSuccess: true, data: `成功同步 ${sources.length} 个书源 (更新 ${toWrite.length} 项)` });
}

async function handleDeleteBookSource(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const body = await request.json<any>();
  const url = body.bookSourceUrl || "";
  await env.DB.prepare(`DELETE FROM book_sources WHERE user_ns = ?1 AND book_source_url = ?2`)
    .bind(userNs, url)
    .run();

  triggerOnChangeSync(env, userNs, ctx);
  return jsonResponse({ isSuccess: true, data: "删除成功" });
}

async function handleDeleteBookSources(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const list = await request.json<string[]>();
  if (!Array.isArray(list)) return jsonResponse({ isSuccess: false, errorMsg: "格式错误" });

  const stmts = list.map((url) =>
    env.DB.prepare(`DELETE FROM book_sources WHERE user_ns = ?1 AND book_source_url = ?2`).bind(userNs, url)
  );

  for (let i = 0; i < stmts.length; i += 50) {
    await env.DB.batch(stmts.slice(i, i + 50));
  }

  triggerOnChangeSync(env, userNs, ctx);
  return jsonResponse({ isSuccess: true, data: "批量删除成功" });
}

async function handleDeleteAllBookSources(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  await env.DB.prepare(`DELETE FROM book_sources WHERE user_ns = ?1`).bind(userNs).run();
  triggerOnChangeSync(env, userNs, ctx);
  return jsonResponse({ isSuccess: true, data: "全部书源已清空" });
}

async function handleReadRemoteSourceFile(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const { url } = await request.json<{ url: string }>();
  if (!url || !isSafeRemoteUrl(url)) {
    return jsonResponse({ isSuccess: false, errorMsg: "无效或受限制的 URL (SSRF 防御)" });
  }

  const resp = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
  });

  const text = await resp.text();
  const parsed = JSON.parse(text);
  const sources = Array.isArray(parsed) ? parsed : [parsed];

  return jsonResponse({ isSuccess: true, data: [JSON.stringify(sources)] });
}

// ==========================================
// 3. Bookshelf & Reading Progress (D1)
// ==========================================

async function handleGetBookshelf(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const shelfDoc = await documentHandlers.getDocument(env, userNs, "bookshelf.json");
  return jsonResponse({ isSuccess: true, data: shelfDoc || [] });
}

async function handleSaveBook(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
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

async function handleSaveBooks(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
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

async function handleDeleteBook(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
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

async function handleDeleteBooks(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
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

async function handleSaveBookProgress(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
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


function getDynamicHeaders(source: any, targetUrl = ""): Record<string, string> {
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
// 4. Unified Chapter Content Router
// ==========================================

async function handleGetBookContent(request: Request, env: Env): Promise<Response> {
  try {
    const userNs = await resolveUserNs(request, env);
    if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

    let chapterUrl = "";
    let bookUrl = "";
    let bookSourceUrl = "";
    let index = 0;

    const url = new URL(request.url);
    chapterUrl = url.searchParams.get("url") || url.searchParams.get("chapterUrl") || "";
    bookUrl = url.searchParams.get("bookUrl") || "";
    bookSourceUrl = url.searchParams.get("bookSourceUrl") || "";
    index = parseInt(url.searchParams.get("index") || "0", 10);

    if (request.method === "POST") {
      try {
        const body = await request.clone().json<any>();
        chapterUrl = body.chapterUrl || body.url || chapterUrl;
        bookUrl = body.bookUrl || body.url || bookUrl;
        bookSourceUrl = body.bookSourceUrl || body.origin || bookSourceUrl;
        if (body.index !== undefined) {
          index = parseInt(body.index, 10);
        }
      } catch {}
    }

  // Extract index from #anchor if present
  if (chapterUrl.includes("#")) {
    const parts = chapterUrl.split("#");
    const parsedIdx = parseInt(parts[1], 10);
    if (!isNaN(parsedIdx)) {
      index = parsedIdx;
    }
  }

  // 0. TXT Book
  if (bookUrl.startsWith("local-txt:") || chapterUrl.startsWith("local-txt:")) {
    const rawId = (bookUrl || chapterUrl).split(":")[1].split("#")[0];
    const text = await readTxtChapterText(rawId, index, env);
    return jsonResponse({ isSuccess: true, data: text });
  }

  // 1. EPUB Book
  if (bookUrl.startsWith("local-epub:") || chapterUrl.startsWith("local-epub:")) {
    const bookId = (bookUrl || chapterUrl).split(":")[1].split("#")[0];
    const html = await readEpubChapterHtml(bookId, index, env);
    return jsonResponse({ isSuccess: true, data: html });
  }

  // 2. PDF Book
  if (bookUrl.startsWith("local-pdf:") || chapterUrl.startsWith("local-pdf:")) {
    const bookId = (bookUrl || chapterUrl).split(":")[1].split("#")[0];
    const page = index >= 0 ? index + 1 : 1;
    const streamUrl = `/reader3/pdf/stream?bookId=${encodeURIComponent(bookId)}#page=${page}`;
    const html = `<div class="pdf-reader-frame-container" style="width: 100%; height: 85vh; min-height: 600px; display: flex; flex-direction: column;">
      <iframe src="${streamUrl}" style="width: 100%; height: 100%; flex: 1; border: none; border-radius: 8px; background: #fff;" allowfullscreen></iframe>
    </div>`;
    return jsonResponse({ isSuccess: true, data: html });
  }

  // 3. Web Novel (Direct fetch or Kitesurf)
  if (chapterUrl.startsWith("http://") || chapterUrl.startsWith("https://")) {
    if (!isSafeRemoteUrl(chapterUrl)) {
      return jsonResponse({ isSuccess: false, errorMsg: "禁止访问内网或本地地址 (SSRF 防御)" });
    }

    const isWebView = url.searchParams.get("webView") === "true";
    const cfAccountId = getEnv(env, "CF_ACCOUNT_ID");
    const cfApiToken = getEnv(env, "CF_API_TOKEN");
    const kitesurfEnabled = getEnv(env, "CF_KITESURF_ENABLED", "true") !== "false";
    const remoteWebview = getEnv(env, "REMOTE_WEBVIEW_API");
    const remoteWebviewKey = getEnv(env, "REMOTE_WEBVIEW_API_KEY");

    if (isWebView && cfAccountId && cfApiToken && kitesurfEnabled) {
      // 1. Try Kitesurf
      try {
        const kitesurfUrl = `https://api.cloudflare.com/client/v4/accounts/${cfAccountId}/browser-run/content?browser=kitesurf`;
        const kResp = await fetch(kitesurfUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${cfApiToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            url: chapterUrl,
            rejectResourceTypes: ["image", "media", "font"],
          }),
        });
        if (kResp.ok) {
          const html = await kResp.text();
          return jsonResponse({ isSuccess: true, data: html });
        }
      } catch (e) {
        // Fall through to backup
      }
    }

    // 2. Try Remote WebView API if webView was requested
    if (isWebView && remoteWebview) {
      try {
        const rResp = await fetch(`${remoteWebview.replace(/\/$/, "")}/render.html`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(remoteWebviewKey ? { Authorization: `Bearer ${remoteWebviewKey}` } : {}),
          },
          body: JSON.stringify({
            url: chapterUrl,
            http_method: "GET",
          }),
        });
        if (rResp.ok) {
          const html = await rResp.text();
          return jsonResponse({ isSuccess: true, data: html });
        }
      } catch (e) {
        // Fall through to direct fetch
      }
    }

    // 3. Direct HTTP fetch fallback
    let source: any = null;
    if (bookSourceUrl) {
      const sRow = await env.DB.prepare(
        `SELECT json FROM book_sources WHERE user_ns = ?1 AND book_source_url = ?2`
      ).bind(userNs, bookSourceUrl).first<{ json: string }>();
      if (sRow) {
        try { source = JSON.parse(sRow.json); } catch {}
      }
    }

    let reqUrl = chapterUrl;
    let fetchOpts: RequestInit = {
      headers: {},
    };
    if (chapterUrl.includes(",{") || chapterUrl.includes(", {")) {
      const idx = chapterUrl.indexOf(",{") !== -1 ? chapterUrl.indexOf(",{") : chapterUrl.indexOf(", {");
      try {
        const cfg = JSON.parse(chapterUrl.substring(idx + 1));
        reqUrl = chapterUrl.substring(0, idx).trim();
        if (cfg.method) fetchOpts.method = cfg.method.toUpperCase();
        if (cfg.headers) Object.assign(fetchOpts.headers as any, cfg.headers);
        if (cfg.body) {
          fetchOpts.body = typeof cfg.body === "string" ? cfg.body : JSON.stringify(cfg.body);
          if (typeof cfg.body !== "string") {
            (fetchOpts.headers as any)["Content-Type"] = "application/json";
          }
        }
      } catch {}
    }

    const dynamicHeaders = getDynamicHeaders(source, reqUrl);
    fetchOpts.headers = {
      ...dynamicHeaders,
      ...(fetchOpts.headers as Record<string, string>),
    };
    if (fetchOpts.body && !(fetchOpts.headers as any)["Content-Type"]) {
      (fetchOpts.headers as any)["Content-Type"] = "application/json";
    }

    try {
      const resp = await fetch(reqUrl, fetchOpts);
      if (!resp.ok) {
        return jsonResponse({
          isSuccess: false,
          errorMsg: `源站返回 HTTP ${resp.status} (${resp.statusText || "访问受限"})`,
        });
      }
      const raw = await fetchTextWithEncoding(resp);

      // Try rule-based content extraction using Legado Engine first
      if (source?.ruleContent?.content) {
        try {
          const ruleBody = await parseContentWithRules(raw, source, reqUrl);
          if (ruleBody && ruleBody.trim().length > 0) {
            return jsonResponse({ isSuccess: true, data: ruleBody });
          }
        } catch {}
      }

      if (raw.trim().startsWith("{") || raw.trim().startsWith("[")) {
        try {
          const j = JSON.parse(raw);
          let contentVal = "";
          const findContent = (obj: any) => {
            if (!obj || contentVal) return;
            if (typeof obj === "object") {
              for (const [k, v] of Object.entries(obj)) {
                if (k.toLowerCase() === "content" && typeof v === "string" && v.length > contentVal.length) {
                  contentVal = v;
                } else {
                  findContent(v);
                }
              }
            }
          };
          findContent(j);
          if (contentVal) {
            if (contentVal.length > 50 && /^[A-Za-z0-9+/=]+$/.test(contentVal)) {
              try {
                contentVal = await cryptoUtils.decryptAes128Cbc(contentVal, "Pxga!h*e4@T8xfOm", "E&z!EHGLd$fli*8R");
              } catch {}
            }
            return jsonResponse({ isSuccess: true, data: contentVal });
          }
        } catch {}
      }

      // HTML response: extract body content from standard content containers
      const contentMatch =
        raw.match(/<div[^>]+(?:id|class)=["'][^"']*(?:novelcontent|read-content|chapter-content|content)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i) ||
        raw.match(/<article[^>]*>([\s\S]*?)<\/article>/i);

      if (contentMatch) {
        return jsonResponse({ isSuccess: true, data: contentMatch[1] });
      }

      return jsonResponse({ isSuccess: true, data: raw });
    } catch (err: any) {
      return jsonResponse({ isSuccess: false, errorMsg: err.message || "获取章节正文失败" });
    }
  }

    return jsonResponse({ isSuccess: false, errorMsg: "未识别的书籍格式" });
  } catch (err: any) {
    console.error("handleGetBookContent error:", err);
    return jsonResponse({ isSuccess: false, errorMsg: err.message || "读取章节正文失败" });
  }
}

async function handleEpubUpload(request: Request, env: Env): Promise<Response> {
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

    const { title, author, totalChapters } = await indexEpubIntoDatabase(
      env,
      userNs,
      bookId,
      fileName,
      r2Key,
      fileSize
    );

    const bookUrl = `local-epub:${bookId}`;
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
      durChapterTime: Date.now(),
      totalChapterNum: totalChapters,
      kind: "本地EPUB",
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

async function handleEpubRead(bookId: string, chapterIndex: number, env: Env): Promise<Response> {
  try {
    const html = await readEpubChapterHtml(bookId, chapterIndex, env);
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

async function readEpubChapterHtml(bookId: string, chapterIndex: number, env: Env): Promise<string> {
  const chapter = await env.DB.prepare(
    `SELECT c.byte_offset, c.byte_length, c.compression_method, c.file_name, b.r2_key
     FROM epub_chapters c
     JOIN epub_books b ON c.book_id = b.book_id
     WHERE c.book_id = ?1 AND c.chapter_index = ?2`
  )
    .bind(bookId, chapterIndex)
    .first<{ byte_offset: number; byte_length: number; compression_method: number; file_name: string; r2_key: string }>();

  if (!chapter) throw new Error("章节尚未完成分片索引");

  // Read 30-byte local header to compute exact data offset with extra fields
  const localHdrObj = await env.BUCKET.get(chapter.r2_key, {
    range: { offset: chapter.byte_offset, length: 30 },
  });
  if (!localHdrObj) throw new Error("无法读取章节本地头数据");
  const localHdrBytes = new Uint8Array(await localHdrObj.arrayBuffer());
  const dataOffset = parseLocalHeaderDataOffset(localHdrBytes, chapter.byte_offset);

  const obj = await env.BUCKET.get(chapter.r2_key, {
    range: { offset: dataOffset, length: chapter.byte_length },
  });
  let payload: Uint8Array | null = obj ? new Uint8Array(await obj.arrayBuffer()) : null;

  if (!payload) {
    // Fallback to remote WebDAV if R2 is unavailable or missing object
    payload = await fallbackFetchFromRemoteWebdav(env, chapter.r2_key, {
      offset: dataOffset,
      length: chapter.byte_length,
    });
  }

  if (!payload) throw new Error("本地书籍不存在，请重新导入");

  let rawHtml = "";
  if (chapter.compression_method === 0) {
    rawHtml = new TextDecoder().decode(payload);
  } else if (chapter.compression_method === 8) {
    const stream = new Response(payload as unknown as BodyInit).body!.pipeThrough(new DecompressionStream("deflate-raw"));
    const buf = await new Response(stream).arrayBuffer();
    rawHtml = new TextDecoder().decode(buf);
  } else {
    throw new Error(`不支持的压缩格式: ${chapter.compression_method}`);
  }

  // Read next chapter info to determine boundary if in same file
  const nextChapter = await env.DB.prepare(
    `SELECT file_name FROM epub_chapters WHERE book_id = ?1 AND chapter_index = ?2`
  ).bind(bookId, chapterIndex + 1).first<{ file_name: string }>();

  // 1. Slice by anchors: start anchor and next anchor in same file
  const currentFile = chapter.file_name?.split("#")[0] || "";
  const nextFile = nextChapter?.file_name?.split("#")[0] || "";
  const startAnchor = chapter.file_name?.includes("#") ? chapter.file_name.split("#")[1] : "";
  const nextAnchor = (nextFile === currentFile && nextChapter?.file_name?.includes("#"))
    ? nextChapter.file_name.split("#")[1]
    : "";

  let html = sliceHtmlByAnchors(rawHtml, startAnchor, nextAnchor);

  // 2. Rewrite all image URLs to /reader3/epub/asset?bookId=...&path=...
  html = rewriteEpubHtmlAssets(html, bookId, chapter.file_name?.split("#")[0] || "");

  return html;
}

async function handleEpubStatus(bookId: string, env: Env): Promise<Response> {
  const book = await env.DB.prepare(
    `SELECT book_id, file_name, status, total_chapters, parsed_chapters, title, author FROM epub_books WHERE book_id = ?1`
  )
    .bind(bookId)
    .first();
  return jsonResponse({ isSuccess: true, data: book });
}

async function processEpubChunkWithBudget(
  bookId: string,
  startTime: number,
  timeBudgetMs: number,
  env: Env
): Promise<{ needsMore: boolean }> {
  const book = await env.DB.prepare(
    `SELECT r2_key, file_size FROM epub_books WHERE book_id = ?1`
  )
    .bind(bookId)
    .first<{ r2_key: string; file_size: number }>();
  if (!book) return { needsMore: false };

  const cp = await env.DB.prepare(
    `SELECT last_processed_index, spine_json FROM epub_parse_checkpoints WHERE book_id = ?1`
  )
    .bind(bookId)
    .first<{ last_processed_index: number; spine_json: string }>();
  if (!cp) return { needsMore: false };

  const spine: string[] = JSON.parse(cp.spine_json || "[]");
  const total = spine.length;
  let curIdx = cp.last_processed_index;

  if (curIdx >= total) {
    await markBookReady(bookId, total, env);
    return { needsMore: false };
  }

  const tailSize = Math.min(65536, book.file_size);
  const tailObj = await env.BUCKET.get(book.r2_key, {
    range: { offset: book.file_size - tailSize, length: tailSize },
  });
  if (!tailObj) return { needsMore: false };
  const tailBytes = new Uint8Array(await tailObj.arrayBuffer());
  const eocd = findEOCD(tailBytes, book.file_size);
  if (!eocd) return { needsMore: false };

  const cdObj = await env.BUCKET.get(book.r2_key, {
    range: { offset: eocd.cdOffset, length: eocd.cdSize },
  });
  if (!cdObj) return { needsMore: false };
  const cdBytes = new Uint8Array(await cdObj.arrayBuffer());
  const entries = parseCentralDirectory(cdBytes);
  const entryMap = new Map(entries.map((e) => [e.fileName, e]));

  while (curIdx < total) {
    if (Date.now() - startTime >= timeBudgetMs) {
      const now = Math.floor(Date.now() / 1000);
      await env.DB.prepare(
        `UPDATE epub_parse_checkpoints SET last_processed_index = ?1, updated_at = ?2 WHERE book_id = ?3`
      ).bind(curIdx, now, bookId).run();
      await env.DB.prepare(
        `UPDATE epub_books SET parsed_chapters = ?1, updated_at = ?2 WHERE book_id = ?3`
      ).bind(curIdx, now, bookId).run();
      return { needsMore: true };
    }

    const path = spine[curIdx];
    const entry = entryMap.get(path);
    if (entry) {
      const localHdrObj = await env.BUCKET.get(book.r2_key, {
        range: { offset: entry.localHeaderOffset, length: 30 },
      });
      if (localHdrObj) {
        const localHdrBytes = new Uint8Array(await localHdrObj.arrayBuffer());
        const dataOffset = parseLocalHeaderDataOffset(localHdrBytes, entry.localHeaderOffset);
        const now = Math.floor(Date.now() / 1000);

        await env.DB.prepare(
          `INSERT INTO epub_chapters (book_id, chapter_index, title, file_name, byte_offset, byte_length, uncompressed_length, compression_method, created_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
           ON CONFLICT(book_id, chapter_index) DO UPDATE SET byte_offset = excluded.byte_offset, byte_length = excluded.byte_length`
        ).bind(
          bookId,
          curIdx,
          `第 ${curIdx + 1} 节`,
          path,
          dataOffset,
          entry.compressedSize,
          entry.uncompressedSize,
          entry.compressionMethod,
          now
        ).run();
      }
    }
    curIdx++;
  }

  await markBookReady(bookId, total, env);
  return { needsMore: false };
}

async function markBookReady(bookId: string, total: number, env: Env): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `UPDATE epub_books SET status = 'ready', parsed_chapters = ?1, updated_at = ?2 WHERE book_id = ?3`
  ).bind(total, now, bookId).run();
  await env.DB.prepare(`DELETE FROM epub_parse_checkpoints WHERE book_id = ?1`).bind(bookId).run();
}

// ==========================================
// 8. PDF Streaming Implementation
// ==========================================

async function handlePdfUpload(request: Request, env: Env): Promise<Response> {
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

async function handlePdfStream(request: Request, env: Env): Promise<Response> {
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
    // Fallback to remote WebDAV
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

async function handlePdfInfo(bookId: string, env: Env): Promise<Response> {
  const book = await env.DB.prepare(
    `SELECT book_id, file_name, title, author, total_pages, file_size, status FROM pdf_books WHERE book_id = ?1`
  ).bind(bookId).first();
  return jsonResponse({ isSuccess: true, data: book });
}

async function handlePdfToc(bookId: string, env: Env): Promise<Response> {
  const outlines = await env.DB.prepare(
    `SELECT title, dest_page, level FROM pdf_outlines WHERE book_id = ?1 ORDER BY dest_page ASC`
  ).bind(bookId).all();
  return jsonResponse({ isSuccess: true, data: outlines.results });
}

// ==========================================
// 9. Utilities: Security, CORS, Parsing
// ==========================================

function generateSessionToken(username: string): string {
  return `${Date.now()}_${randomString(16)}`;
}



function genEncryptedPassword(password: string, salt: string): string {
  const first = md5(password + salt);
  return md5(first + salt);
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

  // Match <item ...> regardless of attribute order
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

  // Fallback: if spine is empty, take all xhtml/html items from manifest
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

async function handleEpubAsset(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const bookId = url.searchParams.get("bookId") || "";
  const rawPath = url.searchParams.get("path") || "";
  if (!bookId || !rawPath) return new Response("Not Found", { status: 404, headers: corsHeaders() });

  const targetPath = decodeURIComponent(rawPath).replace(/^\.?\//, "");

  const book = await env.DB.prepare(
    `SELECT r2_key, file_size FROM epub_books WHERE book_id = ?1`
  ).bind(bookId).first<{ r2_key: string; file_size: number }>();
  if (!book) return new Response("Book Not Found", { status: 404, headers: corsHeaders() });

  const tailSize = Math.min(65536, book.file_size);
  const tailObj = await env.BUCKET.get(book.r2_key, {
    range: { offset: book.file_size - tailSize, length: tailSize },
  });
  if (!tailObj) return new Response("Failed to read R2", { status: 500, headers: corsHeaders() });
  const tailBytes = new Uint8Array(await tailObj.arrayBuffer());
  const eocd = findEOCD(tailBytes, book.file_size);
  if (!eocd) return new Response("EOCD Not Found", { status: 500, headers: corsHeaders() });

  const cdObj = await env.BUCKET.get(book.r2_key, {
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

  const imageBytes = await readZipEntryBytes(book.r2_key, entry, env);

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

async function indexEpubIntoDatabase(
  env: Env,
  userNs: string,
  bookId: string,
  fileName: string,
  r2Key: string,
  fileSize: number
): Promise<{ title: string; author: string; totalChapters: number }> {
  const tailSize = Math.min(65536, fileSize);
  const tailObj = await env.BUCKET.get(r2Key, {
    range: { offset: fileSize - tailSize, length: tailSize },
  });
  if (!tailObj) throw new Error("无法读取 R2 数据");

  const tailBytes = new Uint8Array(await tailObj.arrayBuffer());
  const eocd = findEOCD(tailBytes, fileSize);
  if (!eocd) throw new Error("未找到 EPUB EOCD 记录");

  const cdObj = await env.BUCKET.get(r2Key, {
    range: { offset: eocd.cdOffset, length: eocd.cdSize },
  });
  if (!cdObj) throw new Error("无法读取中央目录");

  const cdBytes = new Uint8Array(await cdObj.arrayBuffer());
  const entries = parseCentralDirectory(cdBytes);
  const entryMap = new Map(entries.map((e) => [e.fileName, e]));

  const containerEntry = entries.find((e) => e.fileName === "META-INF/container.xml");
  if (!containerEntry) throw new Error("缺少 container.xml");

  const containerXml = await readZipEntryText(r2Key, containerEntry, env);
  const opfPath = parseContainerOpfPath(containerXml);
  if (!opfPath) throw new Error("缺少 OPF 路径");

  const opfEntry = entries.find(
    (e) => e.fileName === opfPath || e.fileName.endsWith("/" + (opfPath?.split("/").pop() || ""))
  );
  if (!opfEntry) throw new Error(`缺少 OPF 文件: ${opfPath}`);

  const opfXml = await readZipEntryText(r2Key, opfEntry, env);
  const opfDir = opfPath.includes("/") ? opfPath.substring(0, opfPath.lastIndexOf("/")) : "";
  const { title, author, spinePaths, ncxPath, navPath } = parseOpfPackage(opfXml, opfDir);

  // Read TOC (NCX or Nav)
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

  const now = Math.floor(Date.now() / 1000);
  const stmts = [];
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
        stmts.push(
          env.DB.prepare(
            `INSERT INTO epub_chapters (book_id, chapter_index, title, file_name, byte_offset, byte_length, uncompressed_length, compression_method, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT(book_id, chapter_index) DO UPDATE SET title = excluded.title, byte_offset = excluded.byte_offset, byte_length = excluded.byte_length`
          ).bind(
            bookId,
            chapterIndex++,
            item.title,
            item.href,
            entry.localHeaderOffset,
            entry.compressedSize,
            entry.uncompressedSize,
            entry.compressionMethod,
            now
          )
        );
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
        stmts.push(
          env.DB.prepare(
            `INSERT INTO epub_chapters (book_id, chapter_index, title, file_name, byte_offset, byte_length, uncompressed_length, compression_method, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT(book_id, chapter_index) DO UPDATE SET title = excluded.title, byte_offset = excluded.byte_offset, byte_length = excluded.byte_length`
          ).bind(
            bookId,
            chapterIndex++,
            `第 ${i + 1} 章`,
            entry.fileName,
            entry.localHeaderOffset,
            entry.compressedSize,
            entry.uncompressedSize,
            entry.compressionMethod,
            now
          )
        );
      }
    }
  }

  for (let i = 0; i < stmts.length; i += 50) {
    await env.DB.batch(stmts.slice(i, i + 50));
  }

  const totalChapters = chapterIndex || spinePaths.length;

  await env.DB.prepare(
    `INSERT INTO epub_books (book_id, user_ns, file_name, r2_key, file_size, status, total_chapters, parsed_chapters, title, author, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, 'ready', ?6, ?6, ?7, ?8, ?9, ?10)
     ON CONFLICT(book_id) DO UPDATE SET status='ready', total_chapters=excluded.total_chapters, parsed_chapters=excluded.parsed_chapters, updated_at=excluded.updated_at`
  )
    .bind(bookId, userNs, fileName, r2Key, fileSize, totalChapters, title, author, now, now)
    .run();

  return { title, author, totalChapters };
}

// ==========================================
// 10. Standard WebDAV Protocol (Legado App Sync)
// ==========================================

async function resolveWebdavUser(request: Request, env: Env): Promise<string | null> {
  const auth = request.headers.get("Authorization") || "";
  if (!auth.toLowerCase().startsWith("basic ")) return null;
  const b64 = auth.substring(6).trim();
  let decoded = "";
  try {
    decoded = atob(b64);
  } catch {
    return null;
  }
  const [username, password] = decoded.split(":");
  if (!username || !password) return null;

  const user = await env.DB.prepare(
    `SELECT username, password, salt, enable_webdav FROM users WHERE username = ?1`
  )
    .bind(username)
    .first<{ username: string; password: string; salt: string; enable_webdav: number }>();

  if (!user || user.enable_webdav !== 1) return null;
  if (!(await cryptoUtils.verifyPassword(password, user.salt, user.password))) return null;
  return user.username;
}

async function handleWebdav(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveWebdavUser(request, env);
  if (!userNs) {
    return new Response("Unauthorized", {
      status: 401,
      headers: {
        "WWW-Authenticate": 'Basic realm="reader-webdav"',
        ...corsHeaders(),
      },
    });
  }

  const url = new URL(request.url);
  const rawRelPath = url.pathname.replace(/^\/reader3\/webdav\/?/, "");
  if (rawRelPath.includes("..") || rawRelPath.includes("\\")) {
    return new Response("Forbidden", { status: 403, headers: corsHeaders() });
  }

  const cleanPath = rawRelPath.replace(/^\/+/, "");
  const r2Key = cleanPath ? `webdav/${userNs}/${cleanPath}` : `webdav/${userNs}/`;
  const method = request.method.toUpperCase();

  // 1. OPTIONS: Capability discovery
  if (method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: {
        DAV: "1, 2",
        Allow: "OPTIONS, GET, HEAD, POST, PUT, DELETE, PROPFIND, MKCOL, MOVE, COPY, LOCK, UNLOCK",
        ...corsHeaders(),
      },
    });
  }

  // 2. PROPFIND: Directory / File Property Discovery (XML Multi-Status)
  if (method === "PROPFIND") {
    const isRoot = !cleanPath || cleanPath === "";
    const prefix = isRoot ? `webdav/${userNs}/` : r2Key;
    const listed = await env.BUCKET.list({ prefix, delimiter: "/" });

    let xml = `<?xml version="1.0" encoding="utf-8"?><D:multistatus xmlns:D="DAV:">`;
    const hrefBase = `/reader3/webdav/${cleanPath ? cleanPath.replace(/\/$/, "") + "/" : ""}`;

    // Add current collection entry
    xml += `<D:response><D:href>/reader3/webdav/${cleanPath ? cleanPath : ""}</D:href><D:propstat><D:status>HTTP/1.1 200 OK</D:status><D:prop><D:resourcetype><D:collection/></D:resourcetype></D:prop></D:propstat></D:response>`;

    // Add subdirectories
    for (const delimitedPrefix of listed.delimitedPrefixes || []) {
      const subName = delimitedPrefix.replace(prefix, "").replace(/\/$/, "");
      if (!subName) continue;
      const subHref = `${hrefBase}${subName}/`;
      xml += `<D:response><D:href>${subHref}</D:href><D:propstat><D:status>HTTP/1.1 200 OK</D:status><D:prop><D:resourcetype><D:collection/></D:resourcetype></D:prop></D:propstat></D:response>`;
    }

    // Add files
    for (const obj of listed.objects || []) {
      const fileName = obj.key.replace(prefix, "");
      if (!fileName || fileName.includes("/")) continue;
      const fileHref = `${hrefBase}${fileName}`;
      const mod = Math.floor(obj.uploaded.getTime() / 1000);
      xml += `<D:response><D:href>${fileHref}</D:href><D:propstat><D:status>HTTP/1.1 200 OK</D:status><D:prop><D:getlastmodified>${mod}</D:getlastmodified><D:getcontentlength>${obj.size}</D:getcontentlength><D:resourcetype/></D:prop></D:propstat></D:response>`;
    }

    xml += `</D:multistatus>`;
    return new Response(xml, {
      status: 207,
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        ...corsHeaders(),
      },
    });
  }

  // 3. MKCOL: Create Directory
  if (method === "MKCOL") {
    await env.BUCKET.put(`${r2Key.replace(/\/$/, "")}/`, new Uint8Array(0));
    return new Response(null, { status: 201, headers: corsHeaders() });
  }

  // 4. PUT: Upload File
  if (method === "PUT") {
    const body = await request.arrayBuffer();
    await env.BUCKET.put(r2Key, body, {
      httpMetadata: { contentType: request.headers.get("Content-Type") || "application/octet-stream" },
    });

    // Bridge Legado WebDAV sync to D1 database for real-time progress & source synchronization
    const baseDocName = cleanPath.split("/").pop() || "";
    if (
      baseDocName === "bookshelf.json" ||
      baseDocName === "bookSource.json" ||
      baseDocName === "bookmark.json" ||
      baseDocName === "replaceRule.json"
    ) {
      try {
        const text = new TextDecoder().decode(body);
        const data = JSON.parse(text);
        if (baseDocName === "bookshelf.json" && Array.isArray(data)) {
          await documentHandlers.saveDocument(env, userNs, "bookshelf.json", data);
        } else if (baseDocName === "bookSource.json" && Array.isArray(data)) {
          const now = Math.floor(Date.now() / 1000);
          const stmts = data.filter((s: any) => s && s.bookSourceUrl).map((s: any) =>
            env.DB.prepare(
              `INSERT INTO book_sources (user_ns, book_source_url, book_source_name, json, updated_at)
               VALUES (?1, ?2, ?3, ?4, ?5)
               ON CONFLICT(user_ns, book_source_url) DO UPDATE SET
               book_source_name=excluded.book_source_name, json=excluded.json, updated_at=excluded.updated_at`
            ).bind(userNs, s.bookSourceUrl, s.bookSourceName || "", JSON.stringify(s), now)
          );
          for (let i = 0; i < stmts.length; i += 50) {
            await env.DB.batch(stmts.slice(i, i + 50));
          }
        } else {
          await documentHandlers.saveDocument(env, userNs, baseDocName, data);
        }
      } catch (e) {
        console.error("WebDAV to D1 bridge error:", e);
      }
    }

    return new Response(null, { status: 201, headers: corsHeaders() });
  }

  // 5. GET / HEAD: Download File
  if (method === "GET" || method === "HEAD") {
    const baseDocName = cleanPath.split("/").pop() || "";
    if (
      baseDocName === "bookshelf.json" ||
      baseDocName === "bookmark.json" ||
      baseDocName === "replaceRule.json"
    ) {
      const doc = await documentHandlers.getDocument(env, userNs, baseDocName);
      if (doc) {
        const jsonText = JSON.stringify(doc, null, 2);
        const bytes = new TextEncoder().encode(jsonText);
        return new Response(method === "HEAD" ? null : bytes, {
          status: 200,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Content-Length": bytes.length.toString(),
            ...corsHeaders(),
          },
        });
      }
    }

    const obj = await env.BUCKET.get(r2Key);
    if (!obj) return new Response("Not Found", { status: 404, headers: corsHeaders() });
    const headers = new Headers(corsHeaders());
    headers.set("Content-Type", obj.httpMetadata?.contentType || "application/octet-stream");
    headers.set("Content-Length", obj.size.toString());
    return new Response(method === "HEAD" ? null : obj.body, { status: 200, headers });
  }

  // MOVE: Move/Rename file in R2
  if (method === "MOVE") {
    const destination = request.headers.get("Destination") || "";
    const destMatch = destination.match(/\/reader3\/webdav\/?(.*)/);
    if (!destMatch) return new Response("Bad Destination", { status: 400, headers: corsHeaders() });
    const targetClean = destMatch[1].replace(/^\/+/, "");
    const targetKey = `webdav/${userNs}/${targetClean}`;

    const sourceObj = await env.BUCKET.get(r2Key);
    if (!sourceObj) return new Response("Not Found", { status: 404, headers: corsHeaders() });

    await env.BUCKET.put(targetKey, sourceObj.body, {
      httpMetadata: sourceObj.httpMetadata,
    });
    await env.BUCKET.delete(r2Key);
    return new Response(null, { status: 201, headers: corsHeaders() });
  }

  // 6. DELETE: Remove File or Directory
  if (method === "DELETE") {
    await env.BUCKET.delete(r2Key);
    const listed = await env.BUCKET.list({ prefix: `${r2Key}/` });
    for (const obj of listed.objects || []) {
      await env.BUCKET.delete(obj.key);
    }
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  // 7. LOCK / UNLOCK: Virtual lock for client concurrency
  if (method === "LOCK") {
    const lockToken = `urn:uuid:${crypto.randomUUID()}`;
    const lockXml = `<?xml version="1.0" encoding="utf-8"?><D:prop xmlns:D="DAV:"><D:lockdiscovery><D:activelock><D:locktype><write/></D:locktype><D:lockscope><exclusive/></D:lockscope><D:locktoken><D:href>${lockToken}</D:href></D:locktoken><D:timeout>Second-3600</D:timeout></D:activelock></D:lockdiscovery></D:prop>`;
    return new Response(lockXml, {
      status: 200,
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Lock-Token": `<${lockToken}>`,
        ...corsHeaders(),
      },
    });
  }

  if (method === "UNLOCK") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  return new Response("Method Not Allowed", { status: 405, headers: corsHeaders() });
}

// ==========================================
// 12. Remote WebDAV Sync Handlers & Engine
// ==========================================

async function handleGetRemoteWebdav(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const row = await env.DB.prepare(
    `SELECT server_url, webdav_user, webdav_password, enabled, sync_on_change, sync_interval_mins, last_sync_at, last_sync_status, last_sync_error FROM user_remote_webdav WHERE username = ?1`
  )
    .bind(userNs)
    .first<{
      server_url: string;
      webdav_user: string;
      webdav_password: string;
      enabled: number;
      sync_on_change: number;
      sync_interval_mins: number;
      last_sync_at: number;
      last_sync_status: string;
      last_sync_error: string | null;
    }>();

  if (!row) {
    return jsonResponse({
      isSuccess: true,
      data: {
        enabled: false,
        serverUrl: "",
        webdavUser: "",
        hasPassword: false,
        syncOnChange: true,
        syncIntervalMins: 5,
        lastSyncAt: 0,
        lastSyncStatus: "",
        lastSyncError: null,
      },
    });
  }

  return jsonResponse({
    isSuccess: true,
    data: {
      enabled: row.enabled === 1,
      serverUrl: row.server_url,
      webdavUser: row.webdav_user,
      hasPassword: !!row.webdav_password,
      syncOnChange: row.sync_on_change === 1,
      syncIntervalMins: row.sync_interval_mins || 5,
      lastSyncAt: row.last_sync_at || 0,
      lastSyncStatus: row.last_sync_status || "",
      lastSyncError: row.last_sync_error,
    },
  });
}

async function handleSaveRemoteWebdav(request: Request, env: Env): Promise<Response> {
  try {
    const userNs = await resolveUserNs(request, env);
    if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

    const body = await request.json<any>();
    const { enabled, serverUrl, webdavUser, webdavPassword, syncOnChange, syncIntervalMins } = body;

    const now = Math.floor(Date.now() / 1000);
    const enabledInt = enabled ? 1 : 0;
    const syncOnChangeInt = syncOnChange ? 1 : 0;
    const interval = parseInt(syncIntervalMins || "5", 10) || 5;

    await env.DB.prepare(
      `INSERT OR IGNORE INTO users (username, password, salt, is_admin, enable_webdav, created_at)
       VALUES (?1, '', '', 1, 1, ?2)`
    ).bind(userNs, now).run();

    const existing = await env.DB.prepare(
      `SELECT webdav_password FROM user_remote_webdav WHERE username = ?1`
    )
      .bind(userNs)
      .first<{ webdav_password: string }>();

    let passwordToSave = existing?.webdav_password || "";
    if (webdavPassword && webdavPassword !== "******") {
      passwordToSave = webdavPassword;
    }
    // HIGH-7: Encrypt WebDAV password before storage
    const encKey = getWebdavEncryptionKey(env);
    if (encKey && passwordToSave) {
      try {
        passwordToSave = await cryptoUtils.encryptAes128Cbc(passwordToSave, encKey);
      } catch {
        // Best-effort encryption; store as-is if it fails
      }
    }

    await env.DB.prepare(
      `INSERT INTO user_remote_webdav (username, enabled, server_url, webdav_user, webdav_password, sync_on_change, sync_interval_mins, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
       ON CONFLICT(username) DO UPDATE SET
         enabled = excluded.enabled,
         server_url = excluded.server_url,
         webdav_user = excluded.webdav_user,
         webdav_password = excluded.webdav_password,
         sync_on_change = excluded.sync_on_change,
         sync_interval_mins = excluded.sync_interval_mins,
         updated_at = excluded.updated_at`
    )
      .bind(userNs, enabledInt, serverUrl || "", webdavUser || "", passwordToSave, syncOnChangeInt, interval, now)
      .run();

    return jsonResponse({ isSuccess: true, data: "配置保存成功" });
  } catch (err: any) {
    console.error("handleSaveRemoteWebdav error:", err);
    return jsonResponse({ isSuccess: false, errorMsg: err.message || "保存配置失败" });
  }
}

async function handleTestRemoteWebdav(request: Request, env: Env): Promise<Response> {
  try {
    const userNs = await resolveUserNs(request, env);
    if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

    const body = await request.json<any>();
    let { serverUrl, webdavUser, webdavPassword } = body;

    if (webdavPassword === "******") {
      const existing = await env.DB.prepare(
        `SELECT webdav_password FROM user_remote_webdav WHERE username = ?1`
      ).bind(userNs).first<{ webdav_password: string }>();
      webdavPassword = existing?.webdav_password || "";
    }
    // HIGH-7: Decrypt stored WebDAV password before use
    const encKey = getWebdavEncryptionKey(env);
    if (encKey && webdavPassword) {
      webdavPassword = await cryptoUtils.decryptWebdavPassword(webdavPassword, encKey);
    }

    if (!serverUrl || !webdavUser || !webdavPassword) {
      return jsonResponse({ isSuccess: false, errorMsg: "请填写完整 WebDAV 地址、用户名和密码" });
    }

    if (!isSafeRemoteUrl(serverUrl)) {
      return jsonResponse({ isSuccess: false, errorMsg: "WebDAV 地址不合法或指向受限网络" });
    }

    const authHeader = `Basic ${btoa(webdavUser + ":" + webdavPassword)}`;
    const cleanUrl = serverUrl.replace(/\/$/, "");

    const resp = await fetch(cleanUrl, {
      method: "PROPFIND",
      headers: {
        Authorization: authHeader,
        Depth: "0",
      },
      signal: AbortSignal.timeout(8000),
    });

    if (resp.ok || resp.status === 207) {
      return jsonResponse({ isSuccess: true, data: "连接成功！WebDAV 服务正常响应。" });
    } else {
      return jsonResponse({ isSuccess: false, errorMsg: `连接响应异常 (HTTP ${resp.status}): 请检查路径与账号权限` });
    }
  } catch (err: any) {
    return jsonResponse({ isSuccess: false, errorMsg: err.message || "测试连接失败" });
  }
}

async function handleSyncRemoteWebdavNow(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const res = await syncUserToRemoteWebdav(env, userNs);
  if (res.success) {
    return jsonResponse({ isSuccess: true, data: "同步成功" });
  } else {
    return jsonResponse({ isSuccess: false, errorMsg: res.error || "同步失败" });
  }
}

function triggerOnChangeSync(env: Env, userNs: string, ctx: ExecutionContext): void {
  ctx.waitUntil(
    (async () => {
      try {
        const row = await env.DB.prepare(
          `SELECT enabled, sync_on_change, last_sync_at FROM user_remote_webdav WHERE username = ?1`
        )
          .bind(userNs)
          .first<{ enabled: number; sync_on_change: number; last_sync_at: number }>();

        if (row && row.enabled === 1 && row.sync_on_change === 1) {
          const now = Math.floor(Date.now() / 1000);
          if (now - (row.last_sync_at || 0) >= 30) {
            await syncUserToRemoteWebdav(env, userNs);
          }
        }
      } catch (e) {
        console.error("OnChange sync error:", e);
      }
    })()
  );
}

async function handleScheduledSync(env: Env): Promise<void> {
  try {
    const rows = await env.DB.prepare(
      `SELECT username, last_sync_at, sync_interval_mins FROM user_remote_webdav WHERE enabled = 1`
    ).all<{ username: string; last_sync_at: number; sync_interval_mins: number }>();

    const now = Math.floor(Date.now() / 1000);
    for (const r of rows.results || []) {
      const intervalSecs = (r.sync_interval_mins || 5) * 60;
      if (now - (r.last_sync_at || 0) >= intervalSecs) {
        await syncUserToRemoteWebdav(env, r.username);
      }
    }
  } catch (e) {
    console.error("Scheduled sync error:", e);
  }
}

async function remoteWebdavEnsureDir(baseUrl: string, authHeader: string, relPath: string): Promise<void> {
  const parts = relPath.replace(/^\/+/, "").split("/").filter(Boolean);
  parts.pop(); // remove file name, keep directory path
  let current = baseUrl.replace(/\/$/, "");
  for (const seg of parts) {
    current += `/${seg}`;
    try {
      await fetch(current, {
        method: "MKCOL",
        headers: { Authorization: authHeader },
      });
    } catch {
      // ignore (MKCOL on existing collection returns 405)
    }
  }
}

async function remoteWebdavPutFile(
  baseUrl: string,
  authHeader: string,
  relPath: string,
  body: Uint8Array | string,
  contentType: string = "application/octet-stream"
): Promise<boolean> {
  const cleanBase = baseUrl.replace(/\/$/, "");
  const cleanRel = relPath.replace(/^\/+/, "");
  await remoteWebdavEnsureDir(cleanBase, authHeader, cleanRel);

  const url = `${cleanBase}/${cleanRel}`;
  const resp = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: authHeader,
      "Content-Type": contentType,
    },
    body,
  });

  return resp.ok || resp.status === 201 || resp.status === 204;
}

async function remoteWebdavGetFile(
  baseUrl: string,
  authHeader: string,
  relPath: string,
  range?: { offset: number; length?: number }
): Promise<Uint8Array | null> {
  const cleanBase = baseUrl.replace(/\/$/, "");
  const cleanRel = relPath.replace(/^\/+/, "");
  const url = `${cleanBase}/${cleanRel}`;

  const headers: Record<string, string> = {
    Authorization: authHeader,
  };

  if (range) {
    const end = range.length !== undefined ? range.offset + range.length - 1 : "";
    headers["Range"] = `bytes=${range.offset}-${end}`;
  }

  try {
    const resp = await fetch(url, { headers });
    if (resp.status === 404) return null;
    if (!resp.ok && resp.status !== 206) return null;
    return new Uint8Array(await resp.arrayBuffer());
  } catch {
    return null;
  }
}

async function fallbackFetchFromRemoteWebdav(
  env: Env,
  relKey: string,
  range?: { offset: number; length?: number }
): Promise<Uint8Array | null> {
  try {
    const parts = relKey.replace(/^\/+/, "").split("/");
    const username = parts.length > 1 ? parts[1] : "";
    if (!username) return null;

    const config = await env.DB.prepare(
      `SELECT server_url, webdav_user, webdav_password, enabled FROM user_remote_webdav WHERE username = ?1`
    )
      .bind(username)
      .first<{ server_url: string; webdav_user: string; webdav_password: string; enabled: number }>();

    if (!config || config.enabled !== 1 || !config.server_url) return null;
    // HIGH-7: Decrypt stored WebDAV password before use
    const encKey = getWebdavEncryptionKey(env);
    let decryptedPassword = config.webdav_password;
    if (encKey && decryptedPassword) {
      decryptedPassword = await cryptoUtils.decryptWebdavPassword(decryptedPassword, encKey);
    }
    const authHeader = `Basic ${btoa(config.webdav_user + ":" + decryptedPassword)}`;
    return await remoteWebdavGetFile(config.server_url, authHeader, relKey, range);
  } catch {
    return null;
  }
}

async function syncUserToRemoteWebdav(env: Env, username: string): Promise<{ success: boolean; error?: string }> {
  try {
    const config = await env.DB.prepare(
      `SELECT server_url, webdav_user, webdav_password, enabled, last_sync_at FROM user_remote_webdav WHERE username = ?1`
    )
      .bind(username)
      .first<{ server_url: string; webdav_user: string; webdav_password: string; enabled: number; last_sync_at: number }>();

    if (!config || config.enabled !== 1 || !config.server_url) {
      return { success: false, error: "未启用远端同步或未配置地址" };
    }

    if (!isSafeRemoteUrl(config.server_url)) {
      throw new Error("远端 WebDAV 地址不合法或指向受限网络");
    }

    const cleanBase = config.server_url.replace(/\/$/, "");
    // HIGH-7: Decrypt stored WebDAV password before use
    const encKey = getWebdavEncryptionKey(env);
    let decryptedPassword = config.webdav_password;
    if (encKey && decryptedPassword) {
      decryptedPassword = await cryptoUtils.decryptWebdavPassword(decryptedPassword, encKey);
    }
    const authHeader = `Basic ${btoa(config.webdav_user + ":" + decryptedPassword)}`;

    // 1. Gather all data for this user
    const [shelf, groups, sources, rss, bookmarks, rules] = await Promise.all([
      documentHandlers.getDocument(env, username, "bookshelf.json"),
      documentHandlers.getDocument(env, username, "bookGroup.json"),
      env.DB.prepare(`SELECT json FROM book_sources WHERE user_ns = ?1`).bind(username).all<{ json: string }>(),
      documentHandlers.getDocument(env, username, "rssSource.json"),
      documentHandlers.getDocument(env, username, "bookmark.json"),
      documentHandlers.getDocument(env, username, "replaceRule.json"),
    ]);

    const parsedSources = (sources.results || []).map((r) => {
      try { return JSON.parse(r.json); } catch { return null; }
    }).filter(Boolean);

    // ==============================================================
    // PART A: 1:1 Mirror User Personal Folder (data/, assets/, books/, webdav/)
    // Allows remote WebDAV to seamlessly replace local R2 when needed!
    // ==============================================================
    const jsonFiles: Record<string, string> = {
      [`data/${username}/bookshelf.json`]: JSON.stringify(shelf || [], null, 2),
      [`data/${username}/bookGroup.json`]: JSON.stringify(groups || [], null, 2),
      [`data/${username}/bookSource.json`]: JSON.stringify(parsedSources, null, 2),
      [`data/${username}/rssSource.json`]: JSON.stringify(rss || [], null, 2),
      [`data/${username}/bookmark.json`]: JSON.stringify(bookmarks || [], null, 2),
      [`data/${username}/replaceRule.json`]: JSON.stringify(rules || [], null, 2),
    };

    for (const [relPath, content] of Object.entries(jsonFiles)) {
      await remoteWebdavPutFile(cleanBase, authHeader, relPath, content, "application/json;charset=utf-8");
    }

    // Mirror user R2 storage objects (assets, epubs, pdfs, mobis, webdav)
    const prefixes = [
      `assets/${username}/`,
      `txts/${username}/`,
      `epubs/${username}/`,
      `pdfs/${username}/`,
      `mobis/${username}/`,
      `webdav/${username}/`,
    ];

    for (const prefix of prefixes) {
      const listed = await env.BUCKET.list({ prefix, limit: 100 });
      for (const obj of listed.objects || []) {
        if (obj.key.endsWith("/")) continue;
        const r2File = await env.BUCKET.get(obj.key);
        if (r2File) {
          const bodyBytes = new Uint8Array(await r2File.arrayBuffer());
          const ct = r2File.httpMetadata?.contentType || "application/octet-stream";
          await remoteWebdavPutFile(cleanBase, authHeader, obj.key, bodyBytes, ct);
        }
      }
    }

    // ==============================================================
    // PART B: Extra Full-Asset Standalone Backup ZIP Archive
    // (Contains: bookshelf + progress, bookSources, groups, rules, bookmarks, rss, readConfig)
    // ==============================================================
    const zipArchiveFiles: Record<string, string> = {
      "bookshelf.json": JSON.stringify(shelf || [], null, 2),
      "bookGroup.json": JSON.stringify(groups || [], null, 2),
      "bookSource.json": JSON.stringify(parsedSources, null, 2),
      "rssSource.json": JSON.stringify(rss || [], null, 2),
      "bookmark.json": JSON.stringify(bookmarks || [], null, 2),
      "replaceRule.json": JSON.stringify(rules || [], null, 2),
    };

    const zipBytes = await createZipArchive(zipArchiveFiles);

    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const timestampZip = `backups/backup-${username}-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}-${pad(now.getMinutes())}.zip`;
    const latestZip = `backups/backup-${username}-latest.zip`;

    await remoteWebdavPutFile(cleanBase, authHeader, timestampZip, zipBytes, "application/zip");
    await remoteWebdavPutFile(cleanBase, authHeader, latestZip, zipBytes, "application/zip");

    const nowTs = Math.floor(Date.now() / 1000);
    await env.DB.prepare(
      `UPDATE user_remote_webdav SET last_sync_at = ?1, last_sync_status = 'success', last_sync_error = NULL WHERE username = ?2`
    )
      .bind(nowTs, username)
      .run();

    return { success: true };
  } catch (err: any) {
    const nowTs = Math.floor(Date.now() / 1000);
    await env.DB.prepare(
      `UPDATE user_remote_webdav SET last_sync_at = ?1, last_sync_status = 'failed', last_sync_error = ?2 WHERE username = ?3`
    )
      .bind(nowTs, err.message, username)
      .run();
    return { success: false, error: err.message };
  }
}

// === ZIP Creation Helpers for Worker ===

const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[i] = c >>> 0;
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function compressDeflate(data: Uint8Array): Promise<{ bytes: Uint8Array; method: number }> {
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

async function createZipArchive(files: Record<string, string>): Promise<Uint8Array> {
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

// ==========================================
// 13. TXT Novel Streaming & Heading Indexer
// ==========================================

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

  // Convert charIndex to UTF-8 byte offset
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

  // If first chapter starts after character 0, add "序章"
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

async function handleTxtUpload(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
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

    // 1. Decode with automatic GBK / UTF-8 detection
    const text = decodeTxtBytes(rawBytes);
    // 2. Re-encode to clean UTF-8
    const utf8Bytes = new TextEncoder().encode(text);
    const fileSize = utf8Bytes.length;

    const safeName = fileName.replace(/[/\\?%*:|"<>]/g, "_");
    const bookId = `txt_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const r2Key = `webdav/${userNs}/book/${safeName}`;

    // 3. Store UTF-8 text into R2
    await env.BUCKET.put(r2Key, utf8Bytes, {
      httpMetadata: { contentType: "text/plain; charset=utf-8" },
    });

    // 4. Scan chapter heading offsets
    const chapters = scanTxtChapterOffsets(text, utf8Bytes);
    const totalChapters = chapters.length;
    const title = fileName.replace(/\.txt$/i, "");
    const now = Math.floor(Date.now() / 1000);

    // 5. Save metadata into D1 txt_books
    await env.DB.prepare(
      `INSERT INTO txt_books (book_id, user_ns, file_name, r2_key, file_size, total_chapters, title, author, status, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, '本地导入', 'ready', ?8, ?9)
       ON CONFLICT(book_id) DO UPDATE SET file_size=excluded.file_size, total_chapters=excluded.total_chapters, title=excluded.title, updated_at=excluded.updated_at`
    )
      .bind(bookId, userNs, fileName, r2Key, fileSize, totalChapters, title, now, now)
      .run();

    // 6. Batch save chapter slice indices into D1 txt_chapters
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

    // 7. Add book to user's bookshelf.json
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

async function handleTxtRead(bookId: string, chapterIndex: number, env: Env): Promise<Response> {
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

async function readTxtChapterText(bookId: string, chapterIndex: number, env: Env): Promise<string> {
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
    // Fallback to remote WebDAV if R2 is unavailable or missing object
    payload = await fallbackFetchFromRemoteWebdav(env, chapter.r2_key, {
      offset: chapter.byte_offset,
      length: chapter.byte_length,
    });
  }

  if (!payload) throw new Error("本地书籍不存在，请重新导入");
  return new TextDecoder().decode(payload);
}

async function handleTxtInfo(bookId: string, env: Env): Promise<Response> {
  const book = await env.DB.prepare(
    `SELECT book_id, file_name, title, author, total_chapters, file_size, status FROM txt_books WHERE book_id = ?1`
  )
    .bind(bookId)
    .first();

  if (!book) return jsonResponse({ isSuccess: false, errorMsg: "未找到该 TXT 书籍" });
  return jsonResponse({ isSuccess: true, data: book });
}

async function handleImportWebdavBook(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  try {
    const userNs = await resolveUserNs(request, env);
    if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

    const { path: relPath, name } = await request.json<any>();
    if (!name) return jsonResponse({ isSuccess: false, errorMsg: "缺少文件名" });

    // Check if book already exists on bookshelf
    const titleWithoutExt = name.replace(/\.[^/.]+$/, "").trim();
    let shelf: any[] = (await documentHandlers.getDocument(env, userNs, "bookshelf.json")) || [];
    const existing = shelf.find(
      (b) => b.name === name || b.name === titleWithoutExt || (b.bookUrl && b.bookUrl.toLowerCase().endsWith("/" + name.toLowerCase()))
    );
    if (existing) {
      return jsonResponse({ isSuccess: false, errorMsg: `书籍已存在：《${name}》` });
    }

    const cleanRel = (relPath || "").replace(/^\/+/, "");
    const sourceKey = `webdav/${userNs}/${cleanRel}`;
    const targetClean = cleanRel.startsWith("book/") ? cleanRel : `book/${name}`;
    const targetKey = `webdav/${userNs}/${targetClean}`;

    // 1. Move file to /book/ if not already inside it
    const moved = sourceKey !== targetKey;
    if (moved) {
      const sourceObj = await env.BUCKET.get(sourceKey);
      if (!sourceObj) {
        const remoteBytes = await fallbackFetchFromRemoteWebdav(env, sourceKey);
        if (remoteBytes) {
          await env.BUCKET.put(targetKey, remoteBytes);
        } else {
          return jsonResponse({ isSuccess: false, errorMsg: "WebDAV 文件未找到" });
        }
      } else {
        await env.BUCKET.put(targetKey, sourceObj.body, {
          httpMetadata: sourceObj.httpMetadata,
        });
        await env.BUCKET.delete(sourceKey);
      }
    }

    // 2. Fetch target object from R2 to index
    const targetObj = await env.BUCKET.get(targetKey);
    if (!targetObj) return jsonResponse({ isSuccess: false, errorMsg: "无法读取目标书籍文件" });

    const fileSize = targetObj.size;
    const lower = name.toLowerCase();

    let newBook: any = null;

    if (lower.endsWith(".epub")) {
      const bookId = `epub_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
      const { title, author, totalChapters } = await indexEpubIntoDatabase(
        env,
        userNs,
        bookId,
        name,
        targetKey,
        fileSize
      );

      const bookUrl = `local-epub:${bookId}`;
      newBook = {
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
        durChapterTime: Date.now(),
        totalChapterNum: totalChapters,
        kind: "本地EPUB",
      };
    } else if (lower.endsWith(".txt")) {
      newBook = await indexTxtBookFromR2(env, userNs, name, targetKey, fileSize);
    } else if (lower.endsWith(".pdf")) {
      const bookId = `pdf_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
      const tailSize = Math.min(65536, fileSize);
      const tailObj = await env.BUCKET.get(targetKey, { range: { offset: Math.max(0, fileSize - tailSize), length: tailSize } });
      const tailBytes = tailObj ? new Uint8Array(await tailObj.arrayBuffer()) : new Uint8Array(0);
      const tailText = new TextDecoder().decode(tailBytes);
      const countMatch = tailText.match(/\/Count\s+(\d+)/);
      const totalPages = countMatch ? parseInt(countMatch[1], 10) : 1;
      const titleMatch = tailText.match(/\/Title\s*\(([^)]+)\)/);
      const authorMatch = tailText.match(/\/Author\s*\(([^)]+)\)/);
      const title = titleMatch ? titleMatch[1].trim() : name.replace(/\.pdf$/i, "");
      const author = authorMatch ? authorMatch[1].trim() : "未知作者";
      const now = Math.floor(Date.now() / 1000);

      await env.DB.prepare(
        `INSERT INTO pdf_books (book_id, user_ns, file_name, r2_key, file_size, total_pages, title, author, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?)`
      ).bind(bookId, userNs, name, targetKey, fileSize, totalPages, title, author, now, now).run();

      const bookUrl = `local-pdf:${bookId}`;
      newBook = {
        name: title,
        author: author,
        bookUrl,
        origin: "local-pdf",
        originName: "本地 PDF",
        tocUrl: bookUrl,
        canUpdate: false,
        durChapterIndex: 0,
        durChapterPos: 0,
        durChapterTitle: "第 1 页",
        durChapterTime: Date.now(),
        totalChapterNum: totalPages,
        kind: "本地PDF",
      };
    }

    if (newBook) {
      let shelf: any[] = (await documentHandlers.getDocument(env, userNs, "bookshelf.json")) || [];
      const existingIdx = shelf.findIndex(
        (b) => b.bookUrl === newBook.bookUrl || (b.name === newBook.name && b.origin === newBook.origin)
      );
      if (existingIdx >= 0) {
        shelf[existingIdx] = {
          ...shelf[existingIdx],
          ...newBook,
          bookUrl: shelf[existingIdx].bookUrl,
          durChapterTime: Date.now(),
        };
      } else {
        shelf.unshift(newBook);
      }
      await documentHandlers.saveDocument(env, userNs, "bookshelf.json", shelf);
      triggerOnChangeSync(env, userNs, ctx);
    }

    return jsonResponse({
      isSuccess: true,
      data: { moved, book: newBook },
    });
  } catch (err: any) {
    console.error("handleImportWebdavBook error:", err);
    return jsonResponse({ isSuccess: false, errorMsg: err.message || "导入 WebDAV 书籍失败" });
  }
}

async function indexTxtBookFromR2(env: Env, userNs: string, fileName: string, r2Key: string, fileSize: number) {
  const obj = await env.BUCKET.get(r2Key);
  if (!obj) throw new Error("无法从 R2 读取 TXT 文件");
  const rawBytes = new Uint8Array(await obj.arrayBuffer());
  const text = decodeTxtBytes(rawBytes);
  const utf8Bytes = new TextEncoder().encode(text);
  const actualSize = utf8Bytes.length;

  const bookId = `txt_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  if (rawBytes.length !== actualSize) {
    await env.BUCKET.put(r2Key, utf8Bytes, {
      httpMetadata: { contentType: "text/plain; charset=utf-8" },
    });
  }

  const chapters = scanTxtChapterOffsets(text, utf8Bytes);
  const totalChapters = chapters.length;
  const title = fileName.replace(/\.txt$/i, "");
  const now = Math.floor(Date.now() / 1000);

  await env.DB.prepare(
    `INSERT INTO txt_books (book_id, user_ns, file_name, r2_key, file_size, total_chapters, title, author, status, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, '本地导入', 'ready', ?8, ?9)
     ON CONFLICT(book_id) DO UPDATE SET file_size=excluded.file_size, total_chapters=excluded.total_chapters, title=excluded.title, updated_at=excluded.updated_at`
  ).bind(bookId, userNs, fileName, r2Key, actualSize, totalChapters, title, now, now).run();

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
  return {
    name: title,
    author: "本地导入",
    bookUrl,
    origin: "local-txt",
    originName: "本地 TXT",
    tocUrl: bookUrl,
    canUpdate: false,
    durChapterIndex: 0,
    durChapterPos: 0,
    durChapterTitle: chapters[0]?.title || "开始阅读",
    durChapterTime: Date.now(),
    totalChapterNum: totalChapters,
    kind: "本地TXT",
  };
}

async function handleChunkedUploadInit(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const body = await request.json<any>();
  const fileName = body.fileName || "file";
  const target = body.target || "bookshelf";
  const cleanPath = (body.path || "/").replace(/^\/+/, "").replace(/\/$/, "");
  const safeName = fileName.replace(/[/\\?%*:|"<>]/g, "_");

  let r2Key = "";
  if (target === "webdav") {
    r2Key = cleanPath ? `webdav/${userNs}/${cleanPath}/${safeName}` : `webdav/${userNs}/${safeName}`;
  } else {
    r2Key = `webdav/${userNs}/book/${safeName}`;
  }

  let contentType = "application/octet-stream";
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

async function handleChunkedUploadPart(request: Request, env: Env): Promise<Response> {
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
    const file = formData.get("chunk") as unknown as File | null;
    if (!file) return jsonResponse({ isSuccess: false, errorMsg: "缺少分片数据" });
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

async function handleChunkedUploadComplete(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
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

    if (target === "webdav") {
      triggerOnChangeSync(env, userNs, ctx);
      return jsonResponse({
        isSuccess: true,
        data: { name: fileName, size: fileSize, key },
      });
    }

    const lower = (fileName || "").toLowerCase();
    let newBook: any = null;

    if (lower.endsWith(".epub")) {
      const bookId = `epub_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
      const { title, author, totalChapters } = await indexEpubIntoDatabase(
        env,
        userNs,
        bookId,
        fileName,
        key,
        fileSize
      );
      const bookUrl = `local-epub:${bookId}`;
      newBook = {
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
        durChapterTime: Date.now(),
        totalChapterNum: totalChapters,
        kind: "本地EPUB",
      };
    } else if (lower.endsWith(".txt")) {
      newBook = await indexTxtBookFromR2(env, userNs, fileName, key, fileSize);
    } else if (lower.endsWith(".pdf")) {
      const bookId = `pdf_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
      const title = fileName.replace(/\.pdf$/i, "");
      const totalPages = 1;
      const now = Math.floor(Date.now() / 1000);
      await env.DB.prepare(
        `INSERT INTO pdf_books (book_id, user_ns, file_name, r2_key, file_size, total_pages, title, author, status, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, '未知作者', 'ready', ?8, ?9)
         ON CONFLICT(book_id) DO UPDATE SET file_size=excluded.file_size, title=excluded.title, updated_at=excluded.updated_at`
      ).bind(bookId, userNs, fileName, key, fileSize, totalPages, title, now, now).run();

      const bookUrl = `local-pdf:${bookId}`;
      newBook = {
        name: title,
        author: "未知作者",
        bookUrl,
        origin: "local-pdf",
        originName: "本地 PDF",
        tocUrl: bookUrl,
        canUpdate: false,
        durChapterIndex: 0,
        durChapterPos: 0,
        durChapterTitle: "第 1 页",
        durChapterTime: Date.now(),
        totalChapterNum: totalPages,
        kind: "本地PDF",
      };
    }

    if (newBook) {
      let shelf: any[] = (await documentHandlers.getDocument(env, userNs, "bookshelf.json")) || [];
      const idx = shelf.findIndex(
        (b) => b.bookUrl === newBook.bookUrl || (b.name === newBook.name && b.origin === newBook.origin)
      );
      if (idx >= 0) {
        shelf[idx] = {
          ...shelf[idx],
          ...newBook,
          bookUrl: shelf[idx].bookUrl,
          durChapterTime: Date.now(),
        };
      } else {
        shelf.unshift(newBook);
      }
      await documentHandlers.saveDocument(env, userNs, "bookshelf.json", shelf);
      triggerOnChangeSync(env, userNs, ctx);
    }

    return jsonResponse({
      isSuccess: true,
      data: newBook,
    });
  } catch (err: any) {
    return jsonResponse({ isSuccess: false, errorMsg: err.message || "合并分片失败" });
  }
}

// ==========================================
// 14. AI Companion & Reading Assistant Handlers
// ==========================================

async function handleGetAiBookMemory(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const url = new URL(request.url);
  let bookUrl = url.searchParams.get("bookUrl") || url.searchParams.get("url") || "";
  if (!bookUrl && request.method === "POST") {
    try {
      const body = await request.json<any>();
      bookUrl = body.bookUrl || body.url || "";
    } catch {
      // ignore
    }
  }

  if (!bookUrl) return jsonResponse({ isSuccess: false, errorMsg: "缺少 bookUrl" });

  const bookKey = md5(bookUrl);
  const row = await env.DB.prepare(
    `SELECT json FROM ai_book_memories WHERE user_ns = ?1 AND book_key = ?2`
  )
    .bind(userNs, bookKey)
    .first<{ json: string }>();

  if (!row) return jsonResponse({ isSuccess: true, data: null });
  return jsonResponse({ isSuccess: true, data: JSON.parse(row.json) });
}

async function handleSaveAiBookMemory(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const memory = await request.json<any>();
  const bookUrl = memory.bookUrl || memory.book_url || "";
  if (!bookUrl) return jsonResponse({ isSuccess: false, errorMsg: "缺少 bookUrl" });

  const bookKey = md5(bookUrl);
  const now = Math.floor(Date.now() / 1000);
  if (!memory.updatedAt) memory.updatedAt = Date.now();

  await env.DB.prepare(
    `INSERT INTO ai_book_memories (user_ns, book_key, book_url, json, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5)
     ON CONFLICT(user_ns, book_key) DO UPDATE SET
       book_url = excluded.book_url,
       json = excluded.json,
       updated_at = excluded.updated_at`
  )
    .bind(userNs, bookKey, bookUrl, JSON.stringify(memory), now)
    .run();

  return jsonResponse({ isSuccess: true, data: memory });
}

async function handleDeleteAiBookMemory(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  let bookUrl = new URL(request.url).searchParams.get("bookUrl") || "";
  if (!bookUrl) {
    try {
      const body = await request.json<any>();
      bookUrl = body.bookUrl || body.url || "";
    } catch {
      // ignore
    }
  }

  if (!bookUrl) return jsonResponse({ isSuccess: false, errorMsg: "缺少 bookUrl" });
  const bookKey = md5(bookUrl);

  await env.DB.prepare(
    `DELETE FROM ai_book_memories WHERE user_ns = ?1 AND book_key = ?2`
  )
    .bind(userNs, bookKey)
    .run();

  return jsonResponse({ isSuccess: true, data: { deleted: true } });
}

async function handleAiProxy(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const req = await request.json<any>();
  let baseUrl = req.baseUrl || "";
  let apiKey = req.apiKey || "";
  let path = req.path || "/v1/chat/completions";
  let provider = req.provider || "";

  // 1. Check if server config is requested
  if (req.useServerConfig) {
    const config = await documentHandlers.getDocument(env, "__app__", "ai-model-config.json");
    if (config?.text?.enabled) {
      baseUrl = config.text.base_url || config.text.baseUrl || "";
      apiKey = config.text.api_key || config.text.apiKey || "";
      provider = config.text.provider || "";
    }
  }

  // 2. Check if Cloudflare Workers AI is requested or selected as default
  const isWorkersAi =
    provider === "cloudflare" ||
    req.useWorkersAi === true ||
    req.model?.startsWith("@cf/") ||
    req.body?.model?.startsWith("@cf/") ||
    (!baseUrl && !!env.AI);

  if (isWorkersAi && env.AI) {
    return handleWorkersAiInference(req, env, userNs);
  }

  // 3. Fallback to external AI API
  if (!baseUrl) {
    return jsonResponse({ isSuccess: false, errorMsg: "缺少 AI 模型接口地址 (baseUrl)，或未配置 Cloudflare Workers AI" });
  }

  const targetUrl = req.fullUrl ? baseUrl : `${baseUrl.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
  if (!isSafeRemoteUrl(targetUrl)) {
    return jsonResponse({ isSuccess: false, errorMsg: "禁止访问内网或受限 AI 目标地址 (SSRF 防御)" });
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey.trim()}`;
  }

  try {
    const upstream = await fetch(targetUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(req.body || {}),
    });

    const respHeaders = new Headers(corsHeaders());
    respHeaders.set("Content-Type", upstream.headers.get("Content-Type") || "application/json");

    return new Response(upstream.body, {
      status: upstream.status,
      headers: respHeaders,
    });
  } catch (err: any) {
    return jsonResponse({ isSuccess: false, errorMsg: `AI 模型上游连接失败: ${err.message}` }, 502);
  }
}

async function handleWorkersAiInference(req: any, env: Env, userNs: string): Promise<Response> {
  const path = req.path || "/v1/chat/completions";

  // Image generation
  if (path === "/v1/images/generations" || req.kind === "image") {
    const model = req.body?.model?.startsWith("@cf/")
      ? req.body.model
      : "@cf/black-forest-labs/flux-1-schnell";

    try {
      const prompt = req.body?.prompt || "";
      const imageBytes = await env.AI.run(model, { prompt });
      const imgKey = `assets/${userNs}/ai-images/img_${Date.now()}.png`;
      await env.BUCKET.put(imgKey, imageBytes, {
        httpMetadata: { contentType: "image/png" },
      });

      return jsonResponse({
        created: Math.floor(Date.now() / 1000),
        data: [{ url: `/${imgKey}` }],
      });
    } catch (err: any) {
      return jsonResponse({ isSuccess: false, errorMsg: `Workers AI 绘图失败: ${err.message}` }, 500);
    }
  }

  // Text chat completions
  const model = req.body?.model?.startsWith("@cf/")
    ? req.body.model
    : "@cf/qwen/qwen1.5-7b-chat";

  const messages = req.body?.messages || [];
  const isStream = req.body?.stream === true;

  try {
    if (isStream) {
      const stream = await env.AI.run(model, {
        messages,
        stream: true,
      });
      const headers = new Headers(corsHeaders());
      headers.set("Content-Type", "text/event-stream");
      headers.set("Cache-Control", "no-cache");
      return new Response(stream, { headers });
    } else {
      const result = await env.AI.run(model, {
        messages,
      });
      const textContent = result.response || result.description || "";
      const openAiFormat = {
        id: `chatcmpl-${Date.now()}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: textContent,
            },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      };
      return jsonResponse(openAiFormat);
    }
  } catch (err: any) {
    return jsonResponse({ isSuccess: false, errorMsg: `Workers AI 推理失败: ${err.message}` }, 500);
  }
}

async function handleAiProxyImage(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const { url } = await request.json<{ url: string }>();
  if (!url || !isSafeRemoteUrl(url)) {
    return jsonResponse({ isSuccess: false, errorMsg: "无效或受限的图片地址 (SSRF 防御)" });
  }

  try {
    const upstream = await fetch(url, {
      headers: { Accept: "image/*,*/*;q=0.8" },
    });

    if (!upstream.ok) {
      return jsonResponse({ isSuccess: false, errorMsg: `拉取图片失败 (HTTP ${upstream.status})` });
    }

    const headers = new Headers(corsHeaders());
    headers.set("Content-Type", upstream.headers.get("Content-Type") || "image/png");
    headers.set("Cache-Control", "public, max-age=86400");

    return new Response(upstream.body, { headers });
  } catch (err: any) {
    return jsonResponse({ isSuccess: false, errorMsg: `图片代理失败: ${err.message}` });
  }
}

// ==========================================
// 15. Bounded Multi-Source Search (Scheme 1)
// ==========================================

async function handleSearchBookMulti(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const body = await request.json<any>();
  const key = (body.key || "").trim();
  const page = parseInt(body.page || "1", 10) || 1;
  const bookSourceUrls: string[] | undefined = Array.isArray(body.bookSourceUrls) ? body.bookSourceUrls : undefined;
  const bookSourceGroup: string | undefined = body.bookSourceGroup;

  if (!key) return jsonResponse({ isSuccess: true, data: [] });

  // 1. Fetch enabled book sources from D1
  const rows = await env.DB.prepare(
    `SELECT json FROM book_sources WHERE user_ns = ?1`
  )
    .bind(userNs)
    .all<{ json: string }>();

  let sources: any[] = (rows.results || []).map((r) => {
    try { return JSON.parse(r.json); } catch { return null; }
  }).filter((s) => s && s.enabled !== false && s.searchUrl && s.searchUrl.trim().length > 0);

  if (bookSourceUrls && bookSourceUrls.length > 0) {
    const urlSet = new Set(bookSourceUrls);
    sources = sources.filter((s) => urlSet.has(s.bookSourceUrl));
  } else if (bookSourceGroup) {
    sources = sources.filter((s) => s.bookSourceGroup?.includes(bookSourceGroup));
  }

  // Scheme 1 Safety: Bound to max 20 sources per Worker invocation to never exceed Cloudflare's 50 subrequests limit!
  const targetChunk = sources.slice(0, 20);
  if (targetChunk.length === 0) {
    return jsonResponse({ isSuccess: true, data: [] });
  }

  // 2. Concurrently search the chunk using Promise.allSettled
  const searchTasks = targetChunk.map((source) => searchSingleSource(source, key, page, env));
  const settled = await Promise.allSettled(searchTasks);

  const allBooks: any[] = [];
  for (const res of settled) {
    if (res.status === "fulfilled" && Array.isArray(res.value)) {
      allBooks.push(...res.value);
    }
  }

  return jsonResponse({ isSuccess: true, data: allBooks });
}

async function handleExploreBook(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const body = await request.json<any>().catch(() => ({}));
  const sourceUrl = body.bookSourceUrl || "";
  let targetUrl = (body.rule || body.url || "").trim();
  const page = parseInt(body.page || "1", 10) || 1;

  if (!targetUrl) return jsonResponse({ isSuccess: true, data: [] });

  targetUrl = targetUrl
    .replace(/\{\{page\}\}/g, String(page))
    .replace(/\$\{page\}/g, String(page))
    .replace(/\{\{page-1\}\}/g, String(page - 1))
    .replace(/\$\{page-1\}/g, String(page - 1));

  let sRow: any = null;
  if (sourceUrl) {
    sRow = await env.DB.prepare(
      `SELECT json FROM book_sources WHERE user_ns = ?1 AND book_source_url = ?2`
    ).bind(userNs, sourceUrl).first<{ json: string }>();
  }

  let source: any = null;
  if (sRow) {
    try { source = JSON.parse(sRow.json); } catch {}
  }

  if (targetUrl.startsWith("/")) {
    targetUrl = `${source?.bookSourceUrl || ""}${targetUrl}`;
  }

  let fetchHeaders: Record<string, string> = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  };
  if (source?.header) {
    try {
      const parsedHdr = JSON.parse(source.header);
      Object.assign(fetchHeaders, parsedHdr);
    } catch {}
  }

  try {
    const resp = await fetch(targetUrl, {
      headers: fetchHeaders,
      signal: AbortSignal.timeout(10000),
    });
    const text = await resp.text();

    const books = extractExploreResults(text, source, targetUrl);
    return jsonResponse({ isSuccess: true, data: books });
  } catch (err: any) {
    return jsonResponse({ isSuccess: false, errorMsg: err.message || "探索失败" });
  }
}

function extractExploreResults(text: string, source: any, baseUrl: string): any[] {
  const books: any[] = [];
  try {
    if (text.trim().startsWith("{") || text.trim().startsWith("[")) {
      const data = JSON.parse(text);
      const list = Array.isArray(data) ? data : data.data?.list || data.list || data.data || [];
      if (Array.isArray(list)) {
        for (const item of list.slice(0, 30)) {
          const name = item.title || item.name || item.bookName;
          if (name) {
            let bookUrl = item.bookUrl || item.url || "";
            if (!bookUrl && item.bookId) {
              bookUrl = `${source?.bookSourceUrl || ""}/findChapterList?book_id=${item.bookId}`;
            }
            books.push({
              name,
              author: item.author || "未知作者",
              bookUrl: bookUrl || `${baseUrl}#${item.bookId || name}`,
              origin: source?.bookSourceUrl || baseUrl,
              originName: source?.bookSourceName || "书海来源",
              coverUrl: item.coverImg || item.cover || item.image || "",
              intro: item.desc || item.intro || "",
              kind: item.categoryName || item.category || "网络小说",
              wordCount: item.word || item.words_number || "",
            });
          }
        }
      }
    }
  } catch {}
  return books;
}

async function decodeXiaoXiao(contentB64: string): Promise<any> {
  const binaryString = atob(contentB64);
  const len = binaryString.length;
  const raw = new Uint8Array(len);
  for (let i = 0; i < len; i++) raw[i] = binaryString.charCodeAt(i);

  const datas = raw.subarray(16, len - 16);
  let kStr = "";
  for (let i = 0; i < 16; i++) kStr += String.fromCharCode(raw[i]);
  const kHashBuf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(kStr));
  const ks = new Uint8Array(kHashBuf);

  let iStr = "";
  for (let i = len - 16; i < len; i++) iStr += String.fromCharCode(raw[i]);
  const vHex = md5(iStr);
  const b1 = new TextEncoder().encode(iStr);
  const b2 = new TextEncoder().encode(vHex);

  const ivs = new Uint8Array(16);
  for (let idx = 0; idx < 16; idx++) {
    ivs[idx] = (b2[idx] ^ b1[idx]) ^ 0xff;
  }

  const aesKey = await crypto.subtle.importKey("raw", ks, { name: "AES-CBC" }, false, ["decrypt"]);
  const decryptedBuf = await crypto.subtle.decrypt({ name: "AES-CBC", iv: ivs }, aesKey, datas);
  const decText = new TextDecoder().decode(decryptedBuf);
  return JSON.parse(decText);
}

async function searchSingleSource(source: any, key: string, page: number, env: Env): Promise<any[]> {
  try {
    let rawUrl = (source.searchUrl || "").trim();
    if (!rawUrl) return [];

    let urlConfig: any = null;
    if (rawUrl.includes(",{") || rawUrl.includes(", {")) {
      const idx = rawUrl.indexOf(",{") !== -1 ? rawUrl.indexOf(",{") : rawUrl.indexOf(", {");
      try {
        urlConfig = JSON.parse(rawUrl.substring(idx + 1));
      } catch {}
      rawUrl = rawUrl.substring(0, idx).trim();
    }

    const encodedKey = encodeURIComponent(key);
    let targetUrl = rawUrl
      .replace(/\{\{[^}]*key[^}]*\}\}/gi, encodedKey)
      .replace(/\$\{key\}/g, encodedKey)
      .replace(/\{\{page\}\}/g, String(page))
      .replace(/\$\{page\}/g, String(page));

    if (targetUrl.startsWith("/")) {
      const baseOrigin = new URL(source.bookSourceUrl).origin;
      targetUrl = `${baseOrigin}${targetUrl}`;
    }

    if (!isSafeRemoteUrl(targetUrl)) return [];

    const headers = getDynamicHeaders(source);

    const fetchOptions: RequestInit = {
      headers,
      signal: AbortSignal.timeout(8000),
    };

    if (urlConfig) {
      if (urlConfig.method) fetchOptions.method = urlConfig.method.toUpperCase();
      if (urlConfig.headers) Object.assign(headers, urlConfig.headers);
      if (urlConfig.body) {
        let bStr = typeof urlConfig.body === "string" ? urlConfig.body : JSON.stringify(urlConfig.body);
        bStr = bStr
          .replace(/\{\{[^}]*key[^}]*\}\}/gi, encodedKey)
          .replace(/\$\{key\}/g, encodedKey)
          .replace(/\{\{page\}\}/g, String(page));
        fetchOptions.body = bStr;
        if (typeof urlConfig.body !== "string" && !headers["Content-Type"]) {
          headers["Content-Type"] = "application/json";
        }
      }
    }

    const resp = await fetch(targetUrl, fetchOptions);
    if (!resp.ok) return [];
    const text = await resp.text();

    const ruleBooks = await parseSearchResultsWithRules(text, source, targetUrl, key);
    if (ruleBooks.length > 0) return ruleBooks;

    return await extractSearchResults(text, source, targetUrl, key);
  } catch {
    return [];
  }
}

async function extractSearchResults(text: string, source: any, baseUrl: string, keyword: string): Promise<any[]> {
  const books: any[] = [];
  let baseDomain = "";
  try {
    baseDomain = new URL(baseUrl).origin;
  } catch {
    return [];
  }

  // 1. JSON response handling (including XiaoXiao encrypted content)
  if (text.trim().startsWith("{") || text.trim().startsWith("[")) {
    try {
      let data = JSON.parse(text);
      if (data.data?.content && typeof data.data.content === "string") {
        try {
          data = await decodeXiaoXiao(data.data.content);
        } catch {}
      }

      const list = data.book || data.data?.list || data.list || data.books || (Array.isArray(data) ? data : []);
      if (Array.isArray(list)) {
        for (const item of list.slice(0, 20)) {
          const name = item.name || item.title || item.bookName;
          if (name) {
            let bookUrl = item.bookUrl || item.url || "";
            if (!bookUrl && item.book_id) {
              bookUrl = `https://d.chuangke.tv/book/details/v4/${Math.floor(item.book_id / 1000)}/${item.book_id}.html`;
            } else if (!bookUrl && item.bookId) {
              bookUrl = `${source?.bookSourceUrl || baseDomain}/findChapterList?book_id=${item.bookId}`;
            }

            books.push({
              name,
              author: item.author || "未知作者",
              bookUrl: bookUrl || `${baseUrl}#${item.bookId || item.book_id || name}`,
              origin: source?.bookSourceUrl || baseUrl,
              originName: source?.bookSourceName || "网络书源",
              coverUrl: item.coverImg || item.cover || item.image || "",
              intro: item.desc || item.intro || item.remark || "",
              kind: item.categoryName || item.category || item.ltype || "网络小说",
              wordCount: item.word || item.words_number || "",
            });
          }
        }
        if (books.length > 0) return books;
      }
    } catch {}
  }

  // 2. HTML response handling: Extract matching books by headings or links
  const cardRegex = /<(?:div|li|tr|article)[^>]*class=["'][^"']*(?:book|item|novel|card)[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|li|tr|article)>/gi;
  let cardMatch;
  while ((cardMatch = cardRegex.exec(text)) !== null) {
    const cardHtml = cardMatch[1];
    const titleMatch = cardHtml.match(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    if (titleMatch) {
      let bookUrl = titleMatch[1].trim();
      const rawText = titleMatch[2].replace(/<[^>]+>/g, "").trim();
      if (rawText && rawText.length <= 40) {
        if (bookUrl.startsWith("/")) bookUrl = `${baseDomain}${bookUrl}`;
        else if (!bookUrl.startsWith("http")) bookUrl = `${baseDomain}/${bookUrl}`;

        const authorMatch = cardHtml.match(/(?:作者|auth)[^>]*>([^<]+)/i) || cardHtml.match(/<span[^>]*class=["'][^"']*author[^"']*["'][^>]*>([\s\S]*?)<\/span>/i);
        const author = authorMatch ? authorMatch[1].replace(/<[^>]+>/g, "").trim() : "未知作者";

        books.push({
          name: rawText,
          author,
          bookUrl,
          origin: source.bookSourceUrl,
          originName: source.bookSourceName,
          kind: "网络连载",
        });
      }
    }
  }
  if (books.length > 0) return books.slice(0, 20);

  // 3. Fallback: standard link regex
  const linkRegex = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  const seenUrls = new Set<string>();

  while ((match = linkRegex.exec(text)) !== null) {
    let href = match[1].trim();
    const rawText = match[2].replace(/<[^>]+>/g, "").trim();

    if (rawText.toLowerCase().includes(keyword.toLowerCase()) && rawText.length <= 40) {
      let bookUrl = href;
      if (bookUrl.startsWith("/")) bookUrl = `${baseDomain}${bookUrl}`;
      else if (!bookUrl.startsWith("http")) bookUrl = `${baseDomain}/${bookUrl}`;

      if (!seenUrls.has(bookUrl)) {
        seenUrls.add(bookUrl);
        books.push({
          name: rawText,
          author: source.bookSourceName || "网络来源",
          bookUrl,
          origin: source.bookSourceUrl,
          originName: source.bookSourceName,
          kind: "网络连载",
        });
      }
    }
  }

  return books.slice(0, 20);
}

// ==========================================
// 16. Bookshelf, Chapter List & Book Info
// ==========================================

async function handleGetShelfBook(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  let url = new URL(request.url).searchParams.get("url") || "";
  if (!url && request.method === "POST") {
    try {
      const body = await request.json<any>();
      url = body.url || "";
    } catch {}
  }

  const shelf: any[] = (await documentHandlers.getDocument(env, userNs, "bookshelf.json")) || [];
  const book = shelf.find((b) => b.bookUrl === url);
  if (!book) return jsonResponse({ isSuccess: false, errorMsg: "书籍未在书架中" });
  return jsonResponse({ isSuccess: true, data: book });
}

async function handleGetBookInfo(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  let url = new URL(request.url).searchParams.get("url") || "";
  if (!url && request.method === "POST") {
    try {
      const body = await request.json<any>();
      url = body.url || "";
    } catch {}
  }

  if (url.startsWith("local-txt:")) {
    const bookId = url.split(":")[1].split("#")[0];
    const info = await env.DB.prepare(`SELECT * FROM txt_books WHERE book_id = ?1`).bind(bookId).first<any>();
    if (info) {
      return jsonResponse({
        isSuccess: true,
        data: {
          name: info.title,
          author: info.author,
          bookUrl: url,
          totalChapterNum: info.total_chapters,
          origin: "local-txt",
          originName: "本地 TXT",
        },
      });
    }
  }

  if (url.startsWith("local-epub:")) {
    const bookId = url.split(":")[1].split("#")[0];
    const info = await env.DB.prepare(`SELECT * FROM epub_books WHERE book_id = ?1`).bind(bookId).first<any>();
    if (info) {
      return jsonResponse({
        isSuccess: true,
        data: {
          name: info.title || info.file_name,
          author: info.author || "未知作者",
          bookUrl: url,
          totalChapterNum: info.total_chapters,
          origin: "local-epub",
          originName: "本地 EPUB",
        },
      });
    }
  }

  // Fallback to bookshelf
  const shelf: any[] = (await documentHandlers.getDocument(env, userNs, "bookshelf.json")) || [];
  const book = shelf.find((b) => b.bookUrl === url);
  return jsonResponse({ isSuccess: true, data: book || { bookUrl: url, name: "书籍详情" } });
}

async function handleGetChapterList(request: Request, env: Env): Promise<Response> {
  try {
    const userNs = await resolveUserNs(request, env);
    if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

    let bookUrl = new URL(request.url).searchParams.get("bookUrl") || "";
    let tocUrl = new URL(request.url).searchParams.get("tocUrl") || "";
    let bookName = "";
    let body: any = {};
    if (request.method === "POST") {
      try {
        body = await request.json<any>();
        bookUrl = body.bookUrl || bookUrl;
        tocUrl = body.tocUrl || tocUrl;
        bookName = (body.name || "").trim();
      } catch {}
    }

    const targetUrl = bookUrl || tocUrl;
    const cleanTarget = decodeURIComponent(targetUrl);
    const fileNameCandidate = cleanTarget.split("/").pop()?.split("#")[0]?.trim() || "";

    // 1. Local TXT Chapters
    if (targetUrl.startsWith("local-txt:") || cleanTarget.toLowerCase().includes(".txt")) {
      let bookId = targetUrl.startsWith("local-txt:") ? targetUrl.split(":")[1].split("#")[0] : "";
      if (!bookId) {
        const row = await env.DB.prepare(
          `SELECT book_id FROM txt_books WHERE user_ns = ?1 AND (file_name = ?2 OR title = ?3) LIMIT 1`
        ).bind(userNs, fileNameCandidate, bookName).first<{ book_id: string }>();
        bookId = row?.book_id || "";
      }

      if (bookId) {
        const rows = await env.DB.prepare(
          `SELECT chapter_index, title FROM txt_chapters WHERE book_id = ?1 ORDER BY chapter_index ASC`
        ).bind(bookId).all<{ chapter_index: number; title: string }>();

        if (rows.results && rows.results.length > 0) {
          const chapters = rows.results.map((r) => ({
            index: r.chapter_index,
            title: r.title,
            url: `local-txt:${bookId}#${r.chapter_index}`,
          }));
          return jsonResponse({ isSuccess: true, data: chapters });
        }
      }
      return jsonResponse({ isSuccess: false, errorMsg: "书籍不存在，请重新上传" });
    }

    // 2. Local EPUB Chapters
    if (targetUrl.startsWith("local-epub:") || cleanTarget.toLowerCase().includes(".epub")) {
      let bookId = targetUrl.startsWith("local-epub:") ? targetUrl.split(":")[1].split("#")[0] : "";
      if (!bookId) {
        const row = await env.DB.prepare(
          `SELECT book_id FROM epub_books WHERE user_ns = ?1 AND (file_name = ?2 OR title = ?3) LIMIT 1`
        ).bind(userNs, fileNameCandidate, bookName).first<{ book_id: string }>();
        bookId = row?.book_id || "";
      }

      if (bookId) {
        const rows = await env.DB.prepare(
          `SELECT chapter_index, title FROM epub_chapters WHERE book_id = ?1 ORDER BY chapter_index ASC`
        ).bind(bookId).all<{ chapter_index: number; title: string }>();

        if (rows.results && rows.results.length > 0) {
          const chapters = rows.results.map((r) => ({
            index: r.chapter_index,
            title: r.title,
            url: `local-epub:${bookId}#${r.chapter_index}`,
          }));
          return jsonResponse({ isSuccess: true, data: chapters });
        }
      }
      return jsonResponse({ isSuccess: false, errorMsg: "书籍不存在，请重新上传" });
    }

    // 3. Local PDF Pages
    if (targetUrl.startsWith("local-pdf:") || cleanTarget.toLowerCase().includes(".pdf")) {
      let bookId = targetUrl.startsWith("local-pdf:") ? targetUrl.split(":")[1]?.split("#")[0] : "";
      if (!bookId) {
        const row = await env.DB.prepare(
          `SELECT book_id FROM pdf_books WHERE user_ns = ?1 AND (file_name = ?2 OR title = ?3) LIMIT 1`
        ).bind(userNs, fileNameCandidate, bookName).first<{ book_id: string }>();
        bookId = row?.book_id || "";
      }

      if (bookId) {
        const book = await env.DB.prepare(`SELECT total_pages FROM pdf_books WHERE book_id = ?1`).bind(bookId).first<{ total_pages: number }>();
        const count = Math.max(1, book?.total_pages || 1);
        const chapters = Array.from({ length: count }, (_, i) => ({
          index: i,
          title: `第 ${i + 1} 页`,
          url: `local-pdf:${bookId}#${i}`,
        }));
        return jsonResponse({ isSuccess: true, data: chapters });
      }
      return jsonResponse({ isSuccess: false, errorMsg: "书籍不存在，请重新上传" });
    }

    // 4. Online Book Source Chapters
    let bookSourceUrl = (body.bookSourceUrl || "").trim();
    let source: any = null;
    if (bookSourceUrl) {
      const sRow = await env.DB.prepare(
        `SELECT json FROM book_sources WHERE user_ns = ?1 AND book_source_url = ?2`
      ).bind(userNs, bookSourceUrl).first<{ json: string }>();
      if (sRow) {
        try { source = JSON.parse(sRow.json); } catch {}
      }
    }

    let reqUrl = targetUrl;
    if (reqUrl.startsWith("/")) {
      reqUrl = `${source?.bookSourceUrl || ""}${reqUrl}`;
    }
    if (!reqUrl.startsWith("http")) {
      return jsonResponse({ isSuccess: true, data: [] });
    }

    let fetchHeaders = getDynamicHeaders(source);

    const resp = await fetch(reqUrl, { headers: fetchHeaders, signal: AbortSignal.timeout(10000) });
    if (!resp.ok) return jsonResponse({ isSuccess: true, data: [] });
    const text = await fetchTextWithEncoding(resp);
    const chapters = await parseSourceChapterList(text, source, reqUrl);
    return jsonResponse({ isSuccess: true, data: chapters });
  } catch (err: any) {
    console.error("handleGetChapterList error:", err);
    return jsonResponse({ isSuccess: false, errorMsg: err.message || "获取目录失败" });
  }
}

async function parseSourceChapterList(text: string, source: any, targetUrl: string): Promise<any[]> {
  try {
    const ruleChapters = await parseChapterListWithRules(text, source, targetUrl);
    if (ruleChapters && ruleChapters.length > 0) return ruleChapters;
  } catch {}

  const chapters: any[] = [];
  const baseDomain = new URL(targetUrl).origin;

  // 1. JSON response handling
  if (text.trim().startsWith("{") || text.trim().startsWith("[")) {
    try {
      let j = JSON.parse(text);

      // Check XiaoXiao multiple source details
      if (targetUrl.includes("/book/details/") || targetUrl.includes("/book/source/")) {
        let contentB64 = j.data?.content || j.content;
        if (contentB64) {
          try {
            const decoded = await decodeXiaoXiao(contentB64);
            let sitePath = "";
            if (Array.isArray(decoded) && decoded[0]?.site_path) {
              sitePath = decoded[0].site_path;
            } else if (decoded.site_path) {
              sitePath = decoded.site_path;
            } else {
              const sourceUrl = targetUrl.replace("/details/", "/source/");
              const sResp = await fetch(sourceUrl, { headers: getDynamicHeaders(source, sourceUrl) });
              if (sResp.ok) {
                const sJson = await sResp.json<any>();
                if (sJson.data?.content) {
                  const sDecoded = await decodeXiaoXiao(sJson.data.content);
                  if (Array.isArray(sDecoded) && sDecoded[0]?.site_path) {
                    sitePath = sDecoded[0].site_path;
                  }
                }
              }
            }

            if (sitePath) {
              const catalogUrl = `https://catalog.chuangke.tv/${sitePath}`;
              const cResp = await fetch(catalogUrl, { headers: getDynamicHeaders(source, catalogUrl) });
              if (cResp.ok) {
                j = await cResp.json();
              }
            }
          } catch {}
        }
      }

      const rawList = j.data?.chapters || j.chapters || j.data?.list || j.list || (Array.isArray(j.data) ? j.data : Array.isArray(j) ? j : []);
      if (Array.isArray(rawList)) {
        for (let idx = 0; idx < rawList.length; idx++) {
          const ch = rawList[idx];
          let title = ch.name || ch.title || ch.chapterName || `第 ${idx + 1} 章`;
          if (title.length > 20 && /^[A-Za-z0-9+/=_-]+$/.test(title)) {
            try {
              let padTitle = title.replace(/-/g, "+").replace(/_/g, "/");
              while (padTitle.length % 4 !== 0) padTitle += "=";
              title = await cryptoUtils.decryptAes128Cbc(padTitle, "Pxga!h*e4@T8xfOm", "E&z!EHGLd$fli*8R");
            } catch {}
          }

          let url = "";
          if (ch.path && ((source?.bookSourceUrl || "").includes("chuangke") || targetUrl.includes("chuangke"))) {
            url = `https://chapter.chuangke.tv/${ch.path.replace(/^\/+/, "")}`;
          } else if (ch.id && (targetUrl.includes("5006") || (source?.bookSourceUrl || "").includes("5006"))) {
            const bid = j.data?.book_id || j.book_id || j.data?.bookId || "";
            url = `${source?.bookSourceUrl || "http://119.45.176.116:5006"}/chapterContent,{"body":{"book_id":${bid},"chapterIdList":"${ch.id},"},"method":"POST"}`;
          } else {
            url = ch.url || ch.link || ch.path || "";
            if (url.startsWith("//")) {
              url = `${new URL(baseDomain).protocol}${url}`;
            } else if (url && !url.startsWith("http")) {
              url = `${baseDomain}/${url.replace(/^\/+/, "")}`;
            }
          }

          chapters.push({
            index: idx,
            title,
            url,
          });
        }
        if (chapters.length > 0) return chapters;
      }
    } catch {}
  }

  // 2. HTML response handling: extract chapter links
  const linkRegex = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  let idx = 0;
  const seenUrls = new Set<string>();

  const ignorePatterns = [
    /\/author\//i,
    /\/rank/i,
    /\/month/i,
    /\/down/i,
    /\/tag/i,
    /\/css/i,
    /\/login/i,
    /\/register/i,
    /\/look_/i,
    /\/re_/i,
    /\/sr_/i,
    /\.(css|js|png|jpg|jpeg|gif|ico)(\?|$)/i,
  ];

  while ((match = linkRegex.exec(text)) !== null) {
    let href = match[1].trim();
    const rawText = match[2].replace(/<[^>]+>/g, "").trim();

    if (!rawText || rawText.length > 60 || rawText.length < 2) continue;
    if (ignorePatterns.some((p) => p.test(href))) continue;

    if (href.startsWith("//")) {
      href = `${new URL(baseDomain).protocol}${href}`;
    } else if (href.startsWith("/")) {
      href = `${baseDomain}${href}`;
    } else if (!href.startsWith("http")) {
      href = `${baseDomain}/${href}`;
    }

    if (seenUrls.has(href)) continue;

    const isChapter =
      /第\s*[0-9一二三四五六七八九十百千万0-9]+\s*[章回节卷集幕篇部]/.test(rawText) ||
      /_\d+\.html/i.test(href) ||
      /\/\d+\.html/i.test(href) ||
      /chapter|read/i.test(href);

    if (isChapter) {
      seenUrls.add(href);
      chapters.push({
        index: idx++,
        title: rawText,
        url: href,
      });
    }
  }

  return chapters;
}

async function handleSaveBookGroupId(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const { bookUrl, groupId } = await request.json<any>();
  let shelf: any[] = (await documentHandlers.getDocument(env, userNs, "bookshelf.json")) || [];
  const idx = shelf.findIndex((b) => b.bookUrl === bookUrl);
  if (idx >= 0) {
    shelf[idx].group = groupId;
    await documentHandlers.saveDocument(env, userNs, "bookshelf.json", shelf);
    triggerOnChangeSync(env, userNs, ctx);
  }
  return jsonResponse({ isSuccess: true, data: "分组修改成功" });
}

// ==========================================
// 17. WebDAV REST Endpoints (for Web Manager)
// ==========================================

async function handleGetWebdavFileList(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const url = new URL(request.url);
  const relPath = (url.searchParams.get("path") || "/").replace(/^\/+/, "").replace(/\/$/, "");
  const prefix = relPath ? `webdav/${userNs}/${relPath}/` : `webdav/${userNs}/`;

  const listed = await env.BUCKET.list({ prefix, delimiter: "/" });
  const entries: any[] = [];

  // Subdirectories
  for (const dp of listed.delimitedPrefixes || []) {
    const subName = dp.replace(prefix, "").replace(/\/$/, "");
    if (!subName) continue;
    entries.push({
      name: subName,
      size: 0,
      path: `/${relPath ? relPath + "/" : ""}${subName}`,
      lastModified: Date.now(),
      isDirectory: true,
    });
  }

  // Files
  for (const obj of listed.objects || []) {
    const fileName = obj.key.replace(prefix, "");
    if (!fileName || fileName.includes("/")) continue;
    entries.push({
      name: fileName,
      size: obj.size,
      path: `/${relPath ? relPath + "/" : ""}${fileName}`,
      lastModified: obj.uploaded.getTime(),
      isDirectory: false,
    });
  }

  return jsonResponse({ isSuccess: true, data: entries });
}

async function handleGetWebdavFile(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const url = new URL(request.url);
  const relPath = (url.searchParams.get("path") || "").replace(/^\/+/, "");
  const r2Key = `webdav/${userNs}/${relPath}`;
  const fileName = relPath.split("/").pop() || "file";

  const obj = await env.BUCKET.get(r2Key);
  let bodyStream: any = null;
  let byteLen = 0;
  let contentType = "application/octet-stream";

  if (obj) {
    bodyStream = obj.body;
    byteLen = obj.size;
    contentType = obj.httpMetadata?.contentType || contentType;
  } else {
    const remoteBytes = await fallbackFetchFromRemoteWebdav(env, r2Key);
    if (remoteBytes) {
      bodyStream = remoteBytes;
      byteLen = remoteBytes.length;
    }
  }

  if (!bodyStream) {
    return new Response("File Not Found", { status: 404, headers: corsHeaders() });
  }

  const headers = new Headers(corsHeaders());
  headers.set("Content-Type", contentType);
  headers.set("Content-Length", byteLen.toString());
  headers.set("Content-Disposition", `attachment; filename="${encodeURIComponent(fileName)}"; filename*=UTF-8''${encodeURIComponent(fileName)}`);
  return new Response(bodyStream, { headers });
}

async function handleUploadFileToWebdav(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const formData = await request.formData();
  const dirPath = (formData.get("path") as string || "/").replace(/^\/+/, "").replace(/\/$/, "");
  const prefix = dirPath ? `webdav/${userNs}/${dirPath}/` : `webdav/${userNs}/`;

  for (const [key, rawValue] of formData.entries()) {
    // @cloudflare/workers-types models FormData values as `string`, but the
    // runtime returns a File for file inputs, so widen before the check.
    const value = rawValue as unknown as File | string;
    if (key.startsWith("file") && value instanceof File) {
      const safeName = value.name.replace(/[/\\?%*:|"<>]/g, "_");
      await env.BUCKET.put(`${prefix}${safeName}`, await value.arrayBuffer(), {
        httpMetadata: { contentType: value.type || "application/octet-stream" },
      });
    }
  }

  return jsonResponse({ isSuccess: true, data: [] });
}

async function handleDeleteWebdavFile(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const { path } = await request.json<any>();
  const clean = (path || "").replace(/^\/+/, "");
  const r2Key = `webdav/${userNs}/${clean}`;

  await env.BUCKET.delete(r2Key);
  // Also delete subkeys if directory
  const listed = await env.BUCKET.list({ prefix: `${r2Key}/` });
  for (const o of listed.objects || []) {
    await env.BUCKET.delete(o.key);
  }

  return jsonResponse({ isSuccess: true, data: "删除成功" });
}

async function handleDeleteWebdavFileList(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const { path: paths } = await request.json<any>();
  const list: string[] = Array.isArray(paths) ? paths : [paths];

  for (const p of list) {
    const clean = (p || "").replace(/^\/+/, "");
    const r2Key = `webdav/${userNs}/${clean}`;
    await env.BUCKET.delete(r2Key);
  }

  return jsonResponse({ isSuccess: true, data: "批量删除成功" });
}

// ==========================================
// 18. User Management Handlers (Admin & User)
// ==========================================


// === TEMP STUBS FOR SPLIT WIP (remove after handlers migrated) ===

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // 0. Handle CORS Preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(),
      });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // 1. User Authentication & Profile
      if (path === "/reader3/login" && request.method === "POST") {
        return authHandlers.handleLogin(request, env);
      }
      if (path === "/reader3/logout" && request.method === "POST") {
        return authHandlers.handleLogout(request, env);
      }
      if (path === "/reader3/getUserInfo" && request.method === "GET") {
        return authHandlers.handleGetUserInfo(request, env);
      }

      // 2. Book Sources (书源管理 - D1)
      if (path === "/reader3/getBookSources") {
        return handleGetBookSources(request, env);
      }
      if (path === "/reader3/getBookSource") {
        return handleGetBookSource(request, env);
      }
      if (path === "/reader3/saveBookSource" && request.method === "POST") {
        return handleSaveBookSource(request, env, ctx);
      }
      if (path === "/reader3/saveBookSources" && request.method === "POST") {
        return handleSaveBookSources(request, env, ctx);
      }
      if (path === "/reader3/deleteBookSource" && request.method === "POST") {
        return handleDeleteBookSource(request, env, ctx);
      }
      if (path === "/reader3/deleteBookSources" && request.method === "POST") {
        return handleDeleteBookSources(request, env, ctx);
      }
      if (path === "/reader3/deleteAllBookSources" && request.method === "POST") {
        return handleDeleteAllBookSources(request, env, ctx);
      }
      if (path === "/reader3/readRemoteSourceFile" && request.method === "POST") {
        return handleReadRemoteSourceFile(request, env);
      }

      // Multi-Source Search (Client-Driven Chunking / Scheme 1)
      if (path === "/reader3/searchBookMulti" && request.method === "POST") {
        return handleSearchBookMulti(request, env);
      }
      if (path === "/reader3/testBookSources" && request.method === "POST") {
        return handleTestBookSources(request, env);
      }
      if (path === "/reader3/exploreBook" && request.method === "POST") {
        return handleExploreBook(request, env);
      }

      // 3. Bookshelf & Reading Progress (书架与进度 - D1)
      if ((path === "/reader3/getBookshelf" || path === "/reader3/getShelfBookWithCacheInfo") && request.method === "GET") {
        return handleGetBookshelf(request, env);
      }
      if (path === "/reader3/saveBook" && request.method === "POST") {
        return handleSaveBook(request, env, ctx);
      }
      if (path === "/reader3/saveBooks" && request.method === "POST") {
        return handleSaveBooks(request, env, ctx);
      }
      if (path === "/reader3/deleteBook" && request.method === "POST") {
        return handleDeleteBook(request, env, ctx);
      }
      if (path === "/reader3/deleteBooks" && request.method === "POST") {
        return handleDeleteBooks(request, env, ctx);
      }
      if (path === "/reader3/saveBookProgress" && request.method === "POST") {
        return handleSaveBookProgress(request, env, ctx);
      }
      if (path === "/reader3/getShelfBook") {
        return handleGetShelfBook(request, env);
      }
      if (path === "/reader3/getBookInfo") {
        return handleGetBookInfo(request, env);
      }
      if (path === "/reader3/getChapterList") {
        return handleGetChapterList(request, env);
      }
      if (path === "/reader3/saveBookGroupId" && request.method === "POST") {
        return handleSaveBookGroupId(request, env, ctx);
      }

      // 4. Chapter Content Router (EPUB, PDF, MOBI, Web)
      if (path === "/reader3/getBookContent") {
        return handleGetBookContent(request, env);
      }

      // 5. Document Management: Bookmarks, ReplaceRules, BookGroups
      if (path === "/reader3/getBookmarks") return documentHandlers.handleGetDocument(request, env, "bookmark.json");
      if (path === "/reader3/saveBookmark" && request.method === "POST") return documentHandlers.handleSaveDocumentItem(request, env, "bookmark.json", ctx);
      if (path === "/reader3/deleteBookmark" && request.method === "POST") return documentHandlers.handleDeleteDocumentItem(request, env, "bookmark.json", ctx);

      if (path === "/reader3/getReplaceRules") return documentHandlers.handleGetDocument(request, env, "replaceRule.json");
      if (path === "/reader3/saveReplaceRule" && request.method === "POST") return documentHandlers.handleSaveDocumentItem(request, env, "replaceRule.json", ctx);
      if (path === "/reader3/deleteReplaceRule" && request.method === "POST") return documentHandlers.handleDeleteDocumentItem(request, env, "replaceRule.json", ctx);

      if (path === "/reader3/getBookGroups") return documentHandlers.handleGetDocument(request, env, "bookGroup.json");
      if (path === "/reader3/saveBookGroup" && request.method === "POST") return documentHandlers.handleSaveDocumentItem(request, env, "bookGroup.json", ctx);
      if (path === "/reader3/deleteBookGroup" && request.method === "POST") return documentHandlers.handleDeleteDocumentItem(request, env, "bookGroup.json", ctx);

      // RSS Sources & Articles
      if (path === "/reader3/getRssSources") return documentHandlers.handleGetDocument(request, env, "rssSource.json");
      if (path === "/reader3/saveRssSource" && request.method === "POST") return documentHandlers.handleSaveDocumentItem(request, env, "rssSource.json", ctx);
      if (path === "/reader3/saveRssSources" && request.method === "POST") return documentHandlers.handleSaveDocumentItems(request, env, "rssSource.json", ctx);
      if (path === "/reader3/deleteRssSource" && request.method === "POST") return documentHandlers.handleDeleteDocumentItem(request, env, "rssSource.json", ctx);
      if (path === "/reader3/deleteRssSources" && request.method === "POST") return documentHandlers.handleDeleteDocumentItems(request, env, "rssSource.json", ctx);
      if (path === "/reader3/getRssArticles") return handleGetRssArticles(request, env);
      if (path === "/reader3/getRssContent") return handleGetRssContent(request, env);

      // 6. EPUB Streaming & Indexing
      if ((path === "/reader3/epub/upload" || path === "/reader3/uploadEpubBook") && request.method === "POST") return handleEpubUpload(request, env);
      if (path === "/reader3/epub/read" && request.method === "GET") {
        const bookId = url.searchParams.get("bookId") || "";
        const pageIndex = parseInt(url.searchParams.get("page") || "0", 10);
        return handleEpubRead(bookId, pageIndex, env);
      }
      if (path === "/reader3/epub/status" && request.method === "GET") {
        return handleEpubStatus(url.searchParams.get("bookId") || "", env);
      }
      if (path === "/reader3/epub/asset" && request.method === "GET") {
        return handleEpubAsset(request, env);
      }

      // 7. PDF Streaming & TOC
      if ((path === "/reader3/pdf/upload" || path === "/reader3/uploadPdfBook") && request.method === "POST") return handlePdfUpload(request, env);
      if (path === "/reader3/pdf/stream" && request.method === "GET") return handlePdfStream(request, env);
      if (path === "/reader3/pdf/info" && request.method === "GET") return handlePdfInfo(url.searchParams.get("bookId") || "", env);
      if (path === "/reader3/pdf/toc" && request.method === "GET") return handlePdfToc(url.searchParams.get("bookId") || "", env);

      // 8. TXT Streaming & Heading Indexing
      if ((path === "/reader3/txt/upload" || path === "/reader3/uploadLocalBook" || path === "/reader3/uploadTxtBook") && request.method === "POST") {
        return handleTxtUpload(request, env, ctx);
      }
      if (path === "/reader3/txt/read" && request.method === "GET") {
        const bookId = url.searchParams.get("bookId") || "";
        const chapterIndex = parseInt(url.searchParams.get("index") || "0", 10);
        return handleTxtRead(bookId, chapterIndex, env);
      }
      if (path === "/reader3/txt/info" && request.method === "GET") {
        return handleTxtInfo(url.searchParams.get("bookId") || "", env);
      }

      // 10. WebDAV Book Import & Move
      if (path === "/reader3/importWebdavBook" && request.method === "POST") {
        return handleImportWebdavBook(request, env, ctx);
      }

      // Chunked Upload for Big Files (100MB ~ 1GB+)
      if (path === "/reader3/upload/init" && request.method === "POST") return handleChunkedUploadInit(request, env);
      if (path === "/reader3/upload/part" && request.method === "POST") return handleChunkedUploadPart(request, env);
      if (path === "/reader3/upload/complete" && request.method === "POST") return handleChunkedUploadComplete(request, env, ctx);

      // 10. Assets & Covers (R2)
      if (path === "/reader3/uploadFile" && request.method === "POST") return handleUploadFile(request, env);
      if (path === "/reader3/deleteFile" && request.method === "POST") return handleDeleteFile(request, env);
      if (path.startsWith("/assets/") || path === "/reader3/cover") return handleGetAsset(request, env);

      // 10. WebDAV Protocol & REST APIs (for Web & App)
      if (path.startsWith("/reader3/webdav")) return handleWebdav(request, env);
      if (path === "/reader3/getWebdavFileList" && request.method === "GET") return handleGetWebdavFileList(request, env);
      if (path === "/reader3/getWebdavFile" && request.method === "GET") return handleGetWebdavFile(request, env);
      if (path === "/reader3/uploadFileToWebdav" && request.method === "POST") return handleUploadFileToWebdav(request, env);
      if (path === "/reader3/deleteWebdavFile" && request.method === "POST") return handleDeleteWebdavFile(request, env);
      if (path === "/reader3/deleteWebdavFileList" && request.method === "POST") return handleDeleteWebdavFileList(request, env);

      // User Management
      if (path === "/reader3/changePassword" && request.method === "POST") return userAdminHandlers.handleChangePassword(request, env);
      if (path === "/reader3/getUserList") return userAdminHandlers.handleGetUserList(request, env);
      if (path === "/reader3/addUser" && request.method === "POST") return userAdminHandlers.handleAddUser(request, env);
      if (path === "/reader3/updateUser" && request.method === "POST") return userAdminHandlers.handleUpdateUser(request, env);
      if (path === "/reader3/deleteUsers" && request.method === "POST") return userAdminHandlers.handleDeleteUsers(request, env);
      if (path === "/reader3/resetPassword" && request.method === "POST") return userAdminHandlers.handleResetPassword(request, env);

      // 11. Remote WebDAV Sync Configuration & Actions
      if (path === "/reader3/user/remoteWebdav" && request.method === "GET") {
        return handleGetRemoteWebdav(request, env);
      }
      if (path === "/reader3/user/remoteWebdav" && request.method === "POST") {
        return handleSaveRemoteWebdav(request, env);
      }
      if (path === "/reader3/user/remoteWebdav/test" && request.method === "POST") {
        return handleTestRemoteWebdav(request, env);
      }
      if (path === "/reader3/user/remoteWebdav/syncNow" && request.method === "POST") {
        return handleSyncRemoteWebdavNow(request, env);
      }

      // 12. AI Companion & Reading Assistant (D1 + LLM Proxy)
      if (path === "/reader3/getAiBookMemory") return handleGetAiBookMemory(request, env);
      if (path === "/reader3/saveAiBookMemory" && request.method === "POST") return handleSaveAiBookMemory(request, env);
      if (path === "/reader3/deleteAiBookMemory" && request.method === "POST") return handleDeleteAiBookMemory(request, env);
      if (path === "/reader3/getAiModelConfig") return documentHandlers.handleGetDocument(request, env, "ai-model-config.json");
      if (path === "/reader3/saveAiModelConfig" && request.method === "POST") return documentHandlers.handleSaveDocumentItem(request, env, "ai-model-config.json", ctx);
      if (path === "/reader3/aiProxy" && request.method === "POST") return handleAiProxy(request, env);
      if (path === "/reader3/aiProxyImage" && request.method === "POST") return handleAiProxyImage(request, env);

      // Health check
      if (path === "/health") {
        return jsonResponse({ status: "ok", service: "reader-rust-cloudflare-worker" });
      }

      // Fallback to static assets if binding exists
      if (env.ASSETS) {
        return env.ASSETS.fetch(request);
      }

      return jsonResponse({ isSuccess: false, errorMsg: "接口未找到" }, 404);
    } catch (err: any) {
      return jsonResponse({ isSuccess: false, errorMsg: err.message || "服务器内部错误" }, 500);
    }
  },
};

// ==========================================
// 1. User Authentication & Sessions (D1)
// ==========================================

async function handleGetBookSources(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const rows = await env.DB.prepare(
    `SELECT json FROM book_sources WHERE user_ns = ?1 ORDER BY updated_at DESC`
  )
    .bind(userNs)
    .all<{ json: string }>();

  const list = (rows.results || []).map((r) => {
    try {
      return JSON.parse(r.json);
    } catch {
      return null;
    }
  }).filter(Boolean);

  return jsonResponse({ isSuccess: true, data: list });
}

async function handleGetBookSource(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const url = new URL(request.url);
  const sourceUrl = url.searchParams.get("url") || "";

  const row = await env.DB.prepare(
    `SELECT json FROM book_sources WHERE user_ns = ?1 AND book_source_url = ?2`
  )
    .bind(userNs, sourceUrl)
    .first<{ json: string }>();

  if (!row) return jsonResponse({ isSuccess: false, errorMsg: "未找到该书源" });
  return jsonResponse({ isSuccess: true, data: JSON.parse(row.json) });
}

async function handleSaveBookSource(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const source = await request.json<any>();
  const sourceUrl = source.bookSourceUrl || "";
  const sourceName = source.bookSourceName || "";
  if (!sourceUrl) return jsonResponse({ isSuccess: false, errorMsg: "书源地址不能为空" });

  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `INSERT INTO book_sources (user_ns, book_source_url, book_source_name, json, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5)
     ON CONFLICT(user_ns, book_source_url) DO UPDATE SET
     book_source_name=excluded.book_source_name, json=excluded.json, updated_at=excluded.updated_at`
  )
    .bind(userNs, sourceUrl, sourceName, JSON.stringify(source), now)
    .run();

  triggerOnChangeSync(env, userNs, ctx);
  return jsonResponse({ isSuccess: true, data: "保存成功" });
}

async function handleSaveBookSources(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const sources = await request.json<any[]>();
  if (!Array.isArray(sources)) return jsonResponse({ isSuccess: false, errorMsg: "格式错误" });

  const existingRows = await env.DB.prepare(
    `SELECT book_source_url, json FROM book_sources WHERE user_ns = ?1`
  ).bind(userNs).all<{ book_source_url: string; json: string }>();
  const existingMap = new Map((existingRows.results || []).map((r) => [r.book_source_url, r.json]));

  const now = Math.floor(Date.now() / 1000);
  const toWrite = sources.filter((s) => {
    if (!s || !s.bookSourceUrl) return false;
    const oldJson = existingMap.get(s.bookSourceUrl);
    if (!oldJson) return true;
    return oldJson !== JSON.stringify(s);
  });

  if (toWrite.length > 0) {
    const stmts = toWrite.map((s) =>
      env.DB.prepare(
        `INSERT INTO book_sources (user_ns, book_source_url, book_source_name, json, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(user_ns, book_source_url) DO UPDATE SET
         book_source_name=excluded.book_source_name, json=excluded.json, updated_at=excluded.updated_at`
      ).bind(userNs, s.bookSourceUrl, s.bookSourceName || "", JSON.stringify(s), now)
    );

    for (let i = 0; i < stmts.length; i += 50) {
      await env.DB.batch(stmts.slice(i, i + 50));
    }
  }

  triggerOnChangeSync(env, userNs, ctx);
  return jsonResponse({ isSuccess: true, data: `成功同步 ${sources.length} 个书源 (更新 ${toWrite.length} 项)` });
}

async function handleDeleteBookSource(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const body = await request.json<any>();
  const url = body.bookSourceUrl || "";
  await env.DB.prepare(`DELETE FROM book_sources WHERE user_ns = ?1 AND book_source_url = ?2`)
    .bind(userNs, url)
    .run();

  triggerOnChangeSync(env, userNs, ctx);
  return jsonResponse({ isSuccess: true, data: "删除成功" });
}

async function handleDeleteBookSources(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const list = await request.json<string[]>();
  if (!Array.isArray(list)) return jsonResponse({ isSuccess: false, errorMsg: "格式错误" });

  const stmts = list.map((url) =>
    env.DB.prepare(`DELETE FROM book_sources WHERE user_ns = ?1 AND book_source_url = ?2`).bind(userNs, url)
  );

  for (let i = 0; i < stmts.length; i += 50) {
    await env.DB.batch(stmts.slice(i, i + 50));
  }

  triggerOnChangeSync(env, userNs, ctx);
  return jsonResponse({ isSuccess: true, data: "批量删除成功" });
}

async function handleDeleteAllBookSources(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  await env.DB.prepare(`DELETE FROM book_sources WHERE user_ns = ?1`).bind(userNs).run();
  triggerOnChangeSync(env, userNs, ctx);
  return jsonResponse({ isSuccess: true, data: "全部书源已清空" });
}

async function handleReadRemoteSourceFile(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const { url } = await request.json<{ url: string }>();
  if (!url || !isSafeRemoteUrl(url)) {
    return jsonResponse({ isSuccess: false, errorMsg: "无效或受限制的 URL (SSRF 防御)" });
  }

  const resp = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
  });

  const text = await resp.text();
  const parsed = JSON.parse(text);
  const sources = Array.isArray(parsed) ? parsed : [parsed];

  return jsonResponse({ isSuccess: true, data: [JSON.stringify(sources)] });
}

// ==========================================
// 3. Bookshelf & Reading Progress (D1)
// ==========================================

async function handleGetBookshelf(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const shelfDoc = await documentHandlers.getDocument(env, userNs, "bookshelf.json");
  return jsonResponse({ isSuccess: true, data: shelfDoc || [] });
}

async function handleSaveBook(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
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

async function handleSaveBooks(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
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

async function handleDeleteBook(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
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

async function handleDeleteBooks(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
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

async function handleSaveBookProgress(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
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


function getDynamicHeaders(source: any, targetUrl = ""): Record<string, string> {
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
// 4. Unified Chapter Content Router
// ==========================================

async function handleGetBookContent(request: Request, env: Env): Promise<Response> {
  try {
    const userNs = await resolveUserNs(request, env);
    if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

    let chapterUrl = "";
    let bookUrl = "";
    let bookSourceUrl = "";
    let index = 0;

    const url = new URL(request.url);
    chapterUrl = url.searchParams.get("url") || url.searchParams.get("chapterUrl") || "";
    bookUrl = url.searchParams.get("bookUrl") || "";
    bookSourceUrl = url.searchParams.get("bookSourceUrl") || "";
    index = parseInt(url.searchParams.get("index") || "0", 10);

    if (request.method === "POST") {
      try {
        const body = await request.clone().json<any>();
        chapterUrl = body.chapterUrl || body.url || chapterUrl;
        bookUrl = body.bookUrl || body.url || bookUrl;
        bookSourceUrl = body.bookSourceUrl || body.origin || bookSourceUrl;
        if (body.index !== undefined) {
          index = parseInt(body.index, 10);
        }
      } catch {}
    }

  // Extract index from #anchor if present
  if (chapterUrl.includes("#")) {
    const parts = chapterUrl.split("#");
    const parsedIdx = parseInt(parts[1], 10);
    if (!isNaN(parsedIdx)) {
      index = parsedIdx;
    }
  }

  // 0. TXT Book
  if (bookUrl.startsWith("local-txt:") || chapterUrl.startsWith("local-txt:")) {
    const rawId = (bookUrl || chapterUrl).split(":")[1].split("#")[0];
    const text = await readTxtChapterText(rawId, index, env);
    return jsonResponse({ isSuccess: true, data: text });
  }

  // 1. EPUB Book
  if (bookUrl.startsWith("local-epub:") || chapterUrl.startsWith("local-epub:")) {
    const bookId = (bookUrl || chapterUrl).split(":")[1].split("#")[0];
    const html = await readEpubChapterHtml(bookId, index, env);
    return jsonResponse({ isSuccess: true, data: html });
  }

  // 2. PDF Book
  if (bookUrl.startsWith("local-pdf:") || chapterUrl.startsWith("local-pdf:")) {
    const bookId = (bookUrl || chapterUrl).split(":")[1].split("#")[0];
    const page = index >= 0 ? index + 1 : 1;
    const streamUrl = `/reader3/pdf/stream?bookId=${encodeURIComponent(bookId)}#page=${page}`;
    const html = `<div class="pdf-reader-frame-container" style="width: 100%; height: 85vh; min-height: 600px; display: flex; flex-direction: column;">
      <iframe src="${streamUrl}" style="width: 100%; height: 100%; flex: 1; border: none; border-radius: 8px; background: #fff;" allowfullscreen></iframe>
    </div>`;
    return jsonResponse({ isSuccess: true, data: html });
  }

  // 3. Web Novel (Direct fetch or Kitesurf)
  if (chapterUrl.startsWith("http://") || chapterUrl.startsWith("https://")) {
    if (!isSafeRemoteUrl(chapterUrl)) {
      return jsonResponse({ isSuccess: false, errorMsg: "禁止访问内网或本地地址 (SSRF 防御)" });
    }

    const isWebView = url.searchParams.get("webView") === "true";
    const cfAccountId = getEnv(env, "CF_ACCOUNT_ID");
    const cfApiToken = getEnv(env, "CF_API_TOKEN");
    const kitesurfEnabled = getEnv(env, "CF_KITESURF_ENABLED", "true") !== "false";
    const remoteWebview = getEnv(env, "REMOTE_WEBVIEW_API");
    const remoteWebviewKey = getEnv(env, "REMOTE_WEBVIEW_API_KEY");

    if (isWebView && cfAccountId && cfApiToken && kitesurfEnabled) {
      // 1. Try Kitesurf
      try {
        const kitesurfUrl = `https://api.cloudflare.com/client/v4/accounts/${cfAccountId}/browser-run/content?browser=kitesurf`;
        const kResp = await fetch(kitesurfUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${cfApiToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            url: chapterUrl,
            rejectResourceTypes: ["image", "media", "font"],
          }),
        });
        if (kResp.ok) {
          const html = await kResp.text();
          return jsonResponse({ isSuccess: true, data: html });
        }
      } catch (e) {
        // Fall through to backup
      }
    }

    // 2. Try Remote WebView API if webView was requested
    if (isWebView && remoteWebview) {
      try {
        const rResp = await fetch(`${remoteWebview.replace(/\/$/, "")}/render.html`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(remoteWebviewKey ? { Authorization: `Bearer ${remoteWebviewKey}` } : {}),
          },
          body: JSON.stringify({
            url: chapterUrl,
            http_method: "GET",
          }),
        });
        if (rResp.ok) {
          const html = await rResp.text();
          return jsonResponse({ isSuccess: true, data: html });
        }
      } catch (e) {
        // Fall through to direct fetch
      }
    }

    // 3. Direct HTTP fetch fallback
    let source: any = null;
    if (bookSourceUrl) {
      const sRow = await env.DB.prepare(
        `SELECT json FROM book_sources WHERE user_ns = ?1 AND book_source_url = ?2`
      ).bind(userNs, bookSourceUrl).first<{ json: string }>();
      if (sRow) {
        try { source = JSON.parse(sRow.json); } catch {}
      }
    }

    let reqUrl = chapterUrl;
    let fetchOpts: RequestInit = {
      headers: {},
    };
    if (chapterUrl.includes(",{") || chapterUrl.includes(", {")) {
      const idx = chapterUrl.indexOf(",{") !== -1 ? chapterUrl.indexOf(",{") : chapterUrl.indexOf(", {");
      try {
        const cfg = JSON.parse(chapterUrl.substring(idx + 1));
        reqUrl = chapterUrl.substring(0, idx).trim();
        if (cfg.method) fetchOpts.method = cfg.method.toUpperCase();
        if (cfg.headers) Object.assign(fetchOpts.headers as any, cfg.headers);
        if (cfg.body) {
          fetchOpts.body = typeof cfg.body === "string" ? cfg.body : JSON.stringify(cfg.body);
          if (typeof cfg.body !== "string") {
            (fetchOpts.headers as any)["Content-Type"] = "application/json";
          }
        }
      } catch {}
    }

    const dynamicHeaders = getDynamicHeaders(source, reqUrl);
    fetchOpts.headers = {
      ...dynamicHeaders,
      ...(fetchOpts.headers as Record<string, string>),
    };
    if (fetchOpts.body && !(fetchOpts.headers as any)["Content-Type"]) {
      (fetchOpts.headers as any)["Content-Type"] = "application/json";
    }

    try {
      const resp = await fetch(reqUrl, fetchOpts);
      if (!resp.ok) {
        return jsonResponse({
          isSuccess: false,
          errorMsg: `源站返回 HTTP ${resp.status} (${resp.statusText || "访问受限"})`,
        });
      }
      const raw = await fetchTextWithEncoding(resp);

      // Try rule-based content extraction using Legado Engine first
      if (source?.ruleContent?.content) {
        try {
          const ruleBody = await parseContentWithRules(raw, source, reqUrl);
          if (ruleBody && ruleBody.trim().length > 0) {
            return jsonResponse({ isSuccess: true, data: ruleBody });
          }
        } catch {}
      }

      if (raw.trim().startsWith("{") || raw.trim().startsWith("[")) {
        try {
          const j = JSON.parse(raw);
          let contentVal = "";
          const findContent = (obj: any) => {
            if (!obj || contentVal) return;
            if (typeof obj === "object") {
              for (const [k, v] of Object.entries(obj)) {
                if (k.toLowerCase() === "content" && typeof v === "string" && v.length > contentVal.length) {
                  contentVal = v;
                } else {
                  findContent(v);
                }
              }
            }
          };
          findContent(j);
          if (contentVal) {
            if (contentVal.length > 50 && /^[A-Za-z0-9+/=]+$/.test(contentVal)) {
              try {
                contentVal = await cryptoUtils.decryptAes128Cbc(contentVal, "Pxga!h*e4@T8xfOm", "E&z!EHGLd$fli*8R");
              } catch {}
            }
            return jsonResponse({ isSuccess: true, data: contentVal });
          }
        } catch {}
      }

      // HTML response: extract body content from standard content containers
      const contentMatch =
        raw.match(/<div[^>]+(?:id|class)=["'][^"']*(?:novelcontent|read-content|chapter-content|content)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i) ||
        raw.match(/<article[^>]*>([\s\S]*?)<\/article>/i);

      if (contentMatch) {
        return jsonResponse({ isSuccess: true, data: contentMatch[1] });
      }

      return jsonResponse({ isSuccess: true, data: raw });
    } catch (err: any) {
      return jsonResponse({ isSuccess: false, errorMsg: err.message || "获取章节正文失败" });
    }
  }

    return jsonResponse({ isSuccess: false, errorMsg: "未识别的书籍格式" });
  } catch (err: any) {
    console.error("handleGetBookContent error:", err);
    return jsonResponse({ isSuccess: false, errorMsg: err.message || "读取章节正文失败" });
  }
}

async function handleEpubUpload(request: Request, env: Env): Promise<Response> {
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

    const { title, author, totalChapters } = await indexEpubIntoDatabase(
      env,
      userNs,
      bookId,
      fileName,
      r2Key,
      fileSize
    );

    const bookUrl = `local-epub:${bookId}`;
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
      durChapterTime: Date.now(),
      totalChapterNum: totalChapters,
      kind: "本地EPUB",
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

async function handleEpubRead(bookId: string, chapterIndex: number, env: Env): Promise<Response> {
  try {
    const html = await readEpubChapterHtml(bookId, chapterIndex, env);
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

async function readEpubChapterHtml(bookId: string, chapterIndex: number, env: Env): Promise<string> {
  const chapter = await env.DB.prepare(
    `SELECT c.byte_offset, c.byte_length, c.compression_method, c.file_name, b.r2_key
     FROM epub_chapters c
     JOIN epub_books b ON c.book_id = b.book_id
     WHERE c.book_id = ?1 AND c.chapter_index = ?2`
  )
    .bind(bookId, chapterIndex)
    .first<{ byte_offset: number; byte_length: number; compression_method: number; file_name: string; r2_key: string }>();

  if (!chapter) throw new Error("章节尚未完成分片索引");

  // Read 30-byte local header to compute exact data offset with extra fields
  const localHdrObj = await env.BUCKET.get(chapter.r2_key, {
    range: { offset: chapter.byte_offset, length: 30 },
  });
  if (!localHdrObj) throw new Error("无法读取章节本地头数据");
  const localHdrBytes = new Uint8Array(await localHdrObj.arrayBuffer());
  const dataOffset = parseLocalHeaderDataOffset(localHdrBytes, chapter.byte_offset);

  const obj = await env.BUCKET.get(chapter.r2_key, {
    range: { offset: dataOffset, length: chapter.byte_length },
  });
  let payload: Uint8Array | null = obj ? new Uint8Array(await obj.arrayBuffer()) : null;

  if (!payload) {
    // Fallback to remote WebDAV if R2 is unavailable or missing object
    payload = await fallbackFetchFromRemoteWebdav(env, chapter.r2_key, {
      offset: dataOffset,
      length: chapter.byte_length,
    });
  }

  if (!payload) throw new Error("本地书籍不存在，请重新导入");

  let rawHtml = "";
  if (chapter.compression_method === 0) {
    rawHtml = new TextDecoder().decode(payload);
  } else if (chapter.compression_method === 8) {
    const stream = new Response(payload as unknown as BodyInit).body!.pipeThrough(new DecompressionStream("deflate-raw"));
    const buf = await new Response(stream).arrayBuffer();
    rawHtml = new TextDecoder().decode(buf);
  } else {
    throw new Error(`不支持的压缩格式: ${chapter.compression_method}`);
  }

  // Read next chapter info to determine boundary if in same file
  const nextChapter = await env.DB.prepare(
    `SELECT file_name FROM epub_chapters WHERE book_id = ?1 AND chapter_index = ?2`
  ).bind(bookId, chapterIndex + 1).first<{ file_name: string }>();

  // 1. Slice by anchors: start anchor and next anchor in same file
  const currentFile = chapter.file_name?.split("#")[0] || "";
  const nextFile = nextChapter?.file_name?.split("#")[0] || "";
  const startAnchor = chapter.file_name?.includes("#") ? chapter.file_name.split("#")[1] : "";
  const nextAnchor = (nextFile === currentFile && nextChapter?.file_name?.includes("#"))
    ? nextChapter.file_name.split("#")[1]
    : "";

  let html = sliceHtmlByAnchors(rawHtml, startAnchor, nextAnchor);

  // 2. Rewrite all image URLs to /reader3/epub/asset?bookId=...&path=...
  html = rewriteEpubHtmlAssets(html, bookId, chapter.file_name?.split("#")[0] || "");

  return html;
}

async function handleEpubStatus(bookId: string, env: Env): Promise<Response> {
  const book = await env.DB.prepare(
    `SELECT book_id, file_name, status, total_chapters, parsed_chapters, title, author FROM epub_books WHERE book_id = ?1`
  )
    .bind(bookId)
    .first();
  return jsonResponse({ isSuccess: true, data: book });
}

async function processEpubChunkWithBudget(
  bookId: string,
  startTime: number,
  timeBudgetMs: number,
  env: Env
): Promise<{ needsMore: boolean }> {
  const book = await env.DB.prepare(
    `SELECT r2_key, file_size FROM epub_books WHERE book_id = ?1`
  )
    .bind(bookId)
    .first<{ r2_key: string; file_size: number }>();
  if (!book) return { needsMore: false };

  const cp = await env.DB.prepare(
    `SELECT last_processed_index, spine_json FROM epub_parse_checkpoints WHERE book_id = ?1`
  )
    .bind(bookId)
    .first<{ last_processed_index: number; spine_json: string }>();
  if (!cp) return { needsMore: false };

  const spine: string[] = JSON.parse(cp.spine_json || "[]");
  const total = spine.length;
  let curIdx = cp.last_processed_index;

  if (curIdx >= total) {
    await markBookReady(bookId, total, env);
    return { needsMore: false };
  }

  const tailSize = Math.min(65536, book.file_size);
  const tailObj = await env.BUCKET.get(book.r2_key, {
    range: { offset: book.file_size - tailSize, length: tailSize },
  });
  if (!tailObj) return { needsMore: false };
  const tailBytes = new Uint8Array(await tailObj.arrayBuffer());
  const eocd = findEOCD(tailBytes, book.file_size);
  if (!eocd) return { needsMore: false };

  const cdObj = await env.BUCKET.get(book.r2_key, {
    range: { offset: eocd.cdOffset, length: eocd.cdSize },
  });
  if (!cdObj) return { needsMore: false };
  const cdBytes = new Uint8Array(await cdObj.arrayBuffer());
  const entries = parseCentralDirectory(cdBytes);
  const entryMap = new Map(entries.map((e) => [e.fileName, e]));

  while (curIdx < total) {
    if (Date.now() - startTime >= timeBudgetMs) {
      const now = Math.floor(Date.now() / 1000);
      await env.DB.prepare(
        `UPDATE epub_parse_checkpoints SET last_processed_index = ?1, updated_at = ?2 WHERE book_id = ?3`
      ).bind(curIdx, now, bookId).run();
      await env.DB.prepare(
        `UPDATE epub_books SET parsed_chapters = ?1, updated_at = ?2 WHERE book_id = ?3`
      ).bind(curIdx, now, bookId).run();
      return { needsMore: true };
    }

    const path = spine[curIdx];
    const entry = entryMap.get(path);
    if (entry) {
      const localHdrObj = await env.BUCKET.get(book.r2_key, {
        range: { offset: entry.localHeaderOffset, length: 30 },
      });
      if (localHdrObj) {
        const localHdrBytes = new Uint8Array(await localHdrObj.arrayBuffer());
        const dataOffset = parseLocalHeaderDataOffset(localHdrBytes, entry.localHeaderOffset);
        const now = Math.floor(Date.now() / 1000);

        await env.DB.prepare(
          `INSERT INTO epub_chapters (book_id, chapter_index, title, file_name, byte_offset, byte_length, uncompressed_length, compression_method, created_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
           ON CONFLICT(book_id, chapter_index) DO UPDATE SET byte_offset = excluded.byte_offset, byte_length = excluded.byte_length`
        ).bind(
          bookId,
          curIdx,
          `第 ${curIdx + 1} 节`,
          path,
          dataOffset,
          entry.compressedSize,
          entry.uncompressedSize,
          entry.compressionMethod,
          now
        ).run();
      }
    }
    curIdx++;
  }

  await markBookReady(bookId, total, env);
  return { needsMore: false };
}

async function markBookReady(bookId: string, total: number, env: Env): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `UPDATE epub_books SET status = 'ready', parsed_chapters = ?1, updated_at = ?2 WHERE book_id = ?3`
  ).bind(total, now, bookId).run();
  await env.DB.prepare(`DELETE FROM epub_parse_checkpoints WHERE book_id = ?1`).bind(bookId).run();
}

// ==========================================
// 8. PDF Streaming Implementation
// ==========================================

async function handlePdfUpload(request: Request, env: Env): Promise<Response> {
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

async function handlePdfStream(request: Request, env: Env): Promise<Response> {
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
    // Fallback to remote WebDAV
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

async function handlePdfInfo(bookId: string, env: Env): Promise<Response> {
  const book = await env.DB.prepare(
    `SELECT book_id, file_name, title, author, total_pages, file_size, status FROM pdf_books WHERE book_id = ?1`
  ).bind(bookId).first();
  return jsonResponse({ isSuccess: true, data: book });
}

async function handlePdfToc(bookId: string, env: Env): Promise<Response> {
  const outlines = await env.DB.prepare(
    `SELECT title, dest_page, level FROM pdf_outlines WHERE book_id = ?1 ORDER BY dest_page ASC`
  ).bind(bookId).all();
  return jsonResponse({ isSuccess: true, data: outlines.results });
}

// ==========================================
// 9. Utilities: Security, CORS, Parsing
// ==========================================

function generateSessionToken(username: string): string {
  return `${Date.now()}_${randomString(16)}`;
}



function genEncryptedPassword(password: string, salt: string): string {
  const first = md5(password + salt);
  return md5(first + salt);
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

  // Match <item ...> regardless of attribute order
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

  // Fallback: if spine is empty, take all xhtml/html items from manifest
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

async function handleEpubAsset(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const bookId = url.searchParams.get("bookId") || "";
  const rawPath = url.searchParams.get("path") || "";
  if (!bookId || !rawPath) return new Response("Not Found", { status: 404, headers: corsHeaders() });

  const targetPath = decodeURIComponent(rawPath).replace(/^\.?\//, "");

  const book = await env.DB.prepare(
    `SELECT r2_key, file_size FROM epub_books WHERE book_id = ?1`
  ).bind(bookId).first<{ r2_key: string; file_size: number }>();
  if (!book) return new Response("Book Not Found", { status: 404, headers: corsHeaders() });

  const tailSize = Math.min(65536, book.file_size);
  const tailObj = await env.BUCKET.get(book.r2_key, {
    range: { offset: book.file_size - tailSize, length: tailSize },
  });
  if (!tailObj) return new Response("Failed to read R2", { status: 500, headers: corsHeaders() });
  const tailBytes = new Uint8Array(await tailObj.arrayBuffer());
  const eocd = findEOCD(tailBytes, book.file_size);
  if (!eocd) return new Response("EOCD Not Found", { status: 500, headers: corsHeaders() });

  const cdObj = await env.BUCKET.get(book.r2_key, {
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

  const imageBytes = await readZipEntryBytes(book.r2_key, entry, env);

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

async function indexEpubIntoDatabase(
  env: Env,
  userNs: string,
  bookId: string,
  fileName: string,
  r2Key: string,
  fileSize: number
): Promise<{ title: string; author: string; totalChapters: number }> {
  const tailSize = Math.min(65536, fileSize);
  const tailObj = await env.BUCKET.get(r2Key, {
    range: { offset: fileSize - tailSize, length: tailSize },
  });
  if (!tailObj) throw new Error("无法读取 R2 数据");

  const tailBytes = new Uint8Array(await tailObj.arrayBuffer());
  const eocd = findEOCD(tailBytes, fileSize);
  if (!eocd) throw new Error("未找到 EPUB EOCD 记录");

  const cdObj = await env.BUCKET.get(r2Key, {
    range: { offset: eocd.cdOffset, length: eocd.cdSize },
  });
  if (!cdObj) throw new Error("无法读取中央目录");

  const cdBytes = new Uint8Array(await cdObj.arrayBuffer());
  const entries = parseCentralDirectory(cdBytes);
  const entryMap = new Map(entries.map((e) => [e.fileName, e]));

  const containerEntry = entries.find((e) => e.fileName === "META-INF/container.xml");
  if (!containerEntry) throw new Error("缺少 container.xml");

  const containerXml = await readZipEntryText(r2Key, containerEntry, env);
  const opfPath = parseContainerOpfPath(containerXml);
  if (!opfPath) throw new Error("缺少 OPF 路径");

  const opfEntry = entries.find(
    (e) => e.fileName === opfPath || e.fileName.endsWith("/" + (opfPath?.split("/").pop() || ""))
  );
  if (!opfEntry) throw new Error(`缺少 OPF 文件: ${opfPath}`);

  const opfXml = await readZipEntryText(r2Key, opfEntry, env);
  const opfDir = opfPath.includes("/") ? opfPath.substring(0, opfPath.lastIndexOf("/")) : "";
  const { title, author, spinePaths, ncxPath, navPath } = parseOpfPackage(opfXml, opfDir);

  // Read TOC (NCX or Nav)
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

  const now = Math.floor(Date.now() / 1000);
  const stmts = [];
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
        stmts.push(
          env.DB.prepare(
            `INSERT INTO epub_chapters (book_id, chapter_index, title, file_name, byte_offset, byte_length, uncompressed_length, compression_method, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT(book_id, chapter_index) DO UPDATE SET title = excluded.title, byte_offset = excluded.byte_offset, byte_length = excluded.byte_length`
          ).bind(
            bookId,
            chapterIndex++,
            item.title,
            item.href,
            entry.localHeaderOffset,
            entry.compressedSize,
            entry.uncompressedSize,
            entry.compressionMethod,
            now
          )
        );
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
        stmts.push(
          env.DB.prepare(
            `INSERT INTO epub_chapters (book_id, chapter_index, title, file_name, byte_offset, byte_length, uncompressed_length, compression_method, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT(book_id, chapter_index) DO UPDATE SET title = excluded.title, byte_offset = excluded.byte_offset, byte_length = excluded.byte_length`
          ).bind(
            bookId,
            chapterIndex++,
            `第 ${i + 1} 章`,
            entry.fileName,
            entry.localHeaderOffset,
            entry.compressedSize,
            entry.uncompressedSize,
            entry.compressionMethod,
            now
          )
        );
      }
    }
  }

  for (let i = 0; i < stmts.length; i += 50) {
    await env.DB.batch(stmts.slice(i, i + 50));
  }

  const totalChapters = chapterIndex || spinePaths.length;

  await env.DB.prepare(
    `INSERT INTO epub_books (book_id, user_ns, file_name, r2_key, file_size, status, total_chapters, parsed_chapters, title, author, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, 'ready', ?6, ?6, ?7, ?8, ?9, ?10)
     ON CONFLICT(book_id) DO UPDATE SET status='ready', total_chapters=excluded.total_chapters, parsed_chapters=excluded.parsed_chapters, updated_at=excluded.updated_at`
  )
    .bind(bookId, userNs, fileName, r2Key, fileSize, totalChapters, title, author, now, now)
    .run();

  return { title, author, totalChapters };
}

// ==========================================
// 10. Standard WebDAV Protocol (Legado App Sync)
// ==========================================

async function resolveWebdavUser(request: Request, env: Env): Promise<string | null> {
  const auth = request.headers.get("Authorization") || "";
  if (!auth.toLowerCase().startsWith("basic ")) return null;
  const b64 = auth.substring(6).trim();
  let decoded = "";
  try {
    decoded = atob(b64);
  } catch {
    return null;
  }
  const [username, password] = decoded.split(":");
  if (!username || !password) return null;

  const user = await env.DB.prepare(
    `SELECT username, password, salt, enable_webdav FROM users WHERE username = ?1`
  )
    .bind(username)
    .first<{ username: string; password: string; salt: string; enable_webdav: number }>();

  if (!user || user.enable_webdav !== 1) return null;
  if (!(await cryptoUtils.verifyPassword(password, user.salt, user.password))) return null;
  return user.username;
}

async function handleWebdav(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveWebdavUser(request, env);
  if (!userNs) {
    return new Response("Unauthorized", {
      status: 401,
      headers: {
        "WWW-Authenticate": 'Basic realm="reader-webdav"',
        ...corsHeaders(),
      },
    });
  }

  const url = new URL(request.url);
  const rawRelPath = url.pathname.replace(/^\/reader3\/webdav\/?/, "");
  if (rawRelPath.includes("..") || rawRelPath.includes("\\")) {
    return new Response("Forbidden", { status: 403, headers: corsHeaders() });
  }

  const cleanPath = rawRelPath.replace(/^\/+/, "");
  const r2Key = cleanPath ? `webdav/${userNs}/${cleanPath}` : `webdav/${userNs}/`;
  const method = request.method.toUpperCase();

  // 1. OPTIONS: Capability discovery
  if (method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: {
        DAV: "1, 2",
        Allow: "OPTIONS, GET, HEAD, POST, PUT, DELETE, PROPFIND, MKCOL, MOVE, COPY, LOCK, UNLOCK",
        ...corsHeaders(),
      },
    });
  }

  // 2. PROPFIND: Directory / File Property Discovery (XML Multi-Status)
  if (method === "PROPFIND") {
    const isRoot = !cleanPath || cleanPath === "";
    const prefix = isRoot ? `webdav/${userNs}/` : r2Key;
    const listed = await env.BUCKET.list({ prefix, delimiter: "/" });

    let xml = `<?xml version="1.0" encoding="utf-8"?><D:multistatus xmlns:D="DAV:">`;
    const hrefBase = `/reader3/webdav/${cleanPath ? cleanPath.replace(/\/$/, "") + "/" : ""}`;

    // Add current collection entry
    xml += `<D:response><D:href>/reader3/webdav/${cleanPath ? cleanPath : ""}</D:href><D:propstat><D:status>HTTP/1.1 200 OK</D:status><D:prop><D:resourcetype><D:collection/></D:resourcetype></D:prop></D:propstat></D:response>`;

    // Add subdirectories
    for (const delimitedPrefix of listed.delimitedPrefixes || []) {
      const subName = delimitedPrefix.replace(prefix, "").replace(/\/$/, "");
      if (!subName) continue;
      const subHref = `${hrefBase}${subName}/`;
      xml += `<D:response><D:href>${subHref}</D:href><D:propstat><D:status>HTTP/1.1 200 OK</D:status><D:prop><D:resourcetype><D:collection/></D:resourcetype></D:prop></D:propstat></D:response>`;
    }

    // Add files
    for (const obj of listed.objects || []) {
      const fileName = obj.key.replace(prefix, "");
      if (!fileName || fileName.includes("/")) continue;
      const fileHref = `${hrefBase}${fileName}`;
      const mod = Math.floor(obj.uploaded.getTime() / 1000);
      xml += `<D:response><D:href>${fileHref}</D:href><D:propstat><D:status>HTTP/1.1 200 OK</D:status><D:prop><D:getlastmodified>${mod}</D:getlastmodified><D:getcontentlength>${obj.size}</D:getcontentlength><D:resourcetype/></D:prop></D:propstat></D:response>`;
    }

    xml += `</D:multistatus>`;
    return new Response(xml, {
      status: 207,
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        ...corsHeaders(),
      },
    });
  }

  // 3. MKCOL: Create Directory
  if (method === "MKCOL") {
    await env.BUCKET.put(`${r2Key.replace(/\/$/, "")}/`, new Uint8Array(0));
    return new Response(null, { status: 201, headers: corsHeaders() });
  }

  // 4. PUT: Upload File
  if (method === "PUT") {
    const body = await request.arrayBuffer();
    await env.BUCKET.put(r2Key, body, {
      httpMetadata: { contentType: request.headers.get("Content-Type") || "application/octet-stream" },
    });

    // Bridge Legado WebDAV sync to D1 database for real-time progress & source synchronization
    const baseDocName = cleanPath.split("/").pop() || "";
    if (
      baseDocName === "bookshelf.json" ||
      baseDocName === "bookSource.json" ||
      baseDocName === "bookmark.json" ||
      baseDocName === "replaceRule.json"
    ) {
      try {
        const text = new TextDecoder().decode(body);
        const data = JSON.parse(text);
        if (baseDocName === "bookshelf.json" && Array.isArray(data)) {
          await documentHandlers.saveDocument(env, userNs, "bookshelf.json", data);
        } else if (baseDocName === "bookSource.json" && Array.isArray(data)) {
          const now = Math.floor(Date.now() / 1000);
          const stmts = data.filter((s: any) => s && s.bookSourceUrl).map((s: any) =>
            env.DB.prepare(
              `INSERT INTO book_sources (user_ns, book_source_url, book_source_name, json, updated_at)
               VALUES (?1, ?2, ?3, ?4, ?5)
               ON CONFLICT(user_ns, book_source_url) DO UPDATE SET
               book_source_name=excluded.book_source_name, json=excluded.json, updated_at=excluded.updated_at`
            ).bind(userNs, s.bookSourceUrl, s.bookSourceName || "", JSON.stringify(s), now)
          );
          for (let i = 0; i < stmts.length; i += 50) {
            await env.DB.batch(stmts.slice(i, i + 50));
          }
        } else {
          await documentHandlers.saveDocument(env, userNs, baseDocName, data);
        }
      } catch (e) {
        console.error("WebDAV to D1 bridge error:", e);
      }
    }

    return new Response(null, { status: 201, headers: corsHeaders() });
  }

  // 5. GET / HEAD: Download File
  if (method === "GET" || method === "HEAD") {
    const baseDocName = cleanPath.split("/").pop() || "";
    if (
      baseDocName === "bookshelf.json" ||
      baseDocName === "bookmark.json" ||
      baseDocName === "replaceRule.json"
    ) {
      const doc = await documentHandlers.getDocument(env, userNs, baseDocName);
      if (doc) {
        const jsonText = JSON.stringify(doc, null, 2);
        const bytes = new TextEncoder().encode(jsonText);
        return new Response(method === "HEAD" ? null : bytes, {
          status: 200,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Content-Length": bytes.length.toString(),
            ...corsHeaders(),
          },
        });
      }
    }

    const obj = await env.BUCKET.get(r2Key);
    if (!obj) return new Response("Not Found", { status: 404, headers: corsHeaders() });
    const headers = new Headers(corsHeaders());
    headers.set("Content-Type", obj.httpMetadata?.contentType || "application/octet-stream");
    headers.set("Content-Length", obj.size.toString());
    return new Response(method === "HEAD" ? null : obj.body, { status: 200, headers });
  }

  // MOVE: Move/Rename file in R2
  if (method === "MOVE") {
    const destination = request.headers.get("Destination") || "";
    const destMatch = destination.match(/\/reader3\/webdav\/?(.*)/);
    if (!destMatch) return new Response("Bad Destination", { status: 400, headers: corsHeaders() });
    const targetClean = destMatch[1].replace(/^\/+/, "");
    const targetKey = `webdav/${userNs}/${targetClean}`;

    const sourceObj = await env.BUCKET.get(r2Key);
    if (!sourceObj) return new Response("Not Found", { status: 404, headers: corsHeaders() });

    await env.BUCKET.put(targetKey, sourceObj.body, {
      httpMetadata: sourceObj.httpMetadata,
    });
    await env.BUCKET.delete(r2Key);
    return new Response(null, { status: 201, headers: corsHeaders() });
  }

  // 6. DELETE: Remove File or Directory
  if (method === "DELETE") {
    await env.BUCKET.delete(r2Key);
    const listed = await env.BUCKET.list({ prefix: `${r2Key}/` });
    for (const obj of listed.objects || []) {
      await env.BUCKET.delete(obj.key);
    }
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  // 7. LOCK / UNLOCK: Virtual lock for client concurrency
  if (method === "LOCK") {
    const lockToken = `urn:uuid:${crypto.randomUUID()}`;
    const lockXml = `<?xml version="1.0" encoding="utf-8"?><D:prop xmlns:D="DAV:"><D:lockdiscovery><D:activelock><D:locktype><write/></D:locktype><D:lockscope><exclusive/></D:lockscope><D:locktoken><D:href>${lockToken}</D:href></D:locktoken><D:timeout>Second-3600</D:timeout></D:activelock></D:lockdiscovery></D:prop>`;
    return new Response(lockXml, {
      status: 200,
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Lock-Token": `<${lockToken}>`,
        ...corsHeaders(),
      },
    });
  }

  if (method === "UNLOCK") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  return new Response("Method Not Allowed", { status: 405, headers: corsHeaders() });
}

// ==========================================
// 12. Remote WebDAV Sync Handlers & Engine
// ==========================================

async function handleGetRemoteWebdav(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const row = await env.DB.prepare(
    `SELECT server_url, webdav_user, webdav_password, enabled, sync_on_change, sync_interval_mins, last_sync_at, last_sync_status, last_sync_error FROM user_remote_webdav WHERE username = ?1`
  )
    .bind(userNs)
    .first<{
      server_url: string;
      webdav_user: string;
      webdav_password: string;
      enabled: number;
      sync_on_change: number;
      sync_interval_mins: number;
      last_sync_at: number;
      last_sync_status: string;
      last_sync_error: string | null;
    }>();

  if (!row) {
    return jsonResponse({
      isSuccess: true,
      data: {
        enabled: false,
        serverUrl: "",
        webdavUser: "",
        hasPassword: false,
        syncOnChange: true,
        syncIntervalMins: 5,
        lastSyncAt: 0,
        lastSyncStatus: "",
        lastSyncError: null,
      },
    });
  }

  return jsonResponse({
    isSuccess: true,
    data: {
      enabled: row.enabled === 1,
      serverUrl: row.server_url,
      webdavUser: row.webdav_user,
      hasPassword: !!row.webdav_password,
      syncOnChange: row.sync_on_change === 1,
      syncIntervalMins: row.sync_interval_mins || 5,
      lastSyncAt: row.last_sync_at || 0,
      lastSyncStatus: row.last_sync_status || "",
      lastSyncError: row.last_sync_error,
    },
  });
}

async function handleSaveRemoteWebdav(request: Request, env: Env): Promise<Response> {
  try {
    const userNs = await resolveUserNs(request, env);
    if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

    const body = await request.json<any>();
    const { enabled, serverUrl, webdavUser, webdavPassword, syncOnChange, syncIntervalMins } = body;

    const now = Math.floor(Date.now() / 1000);
    const enabledInt = enabled ? 1 : 0;
    const syncOnChangeInt = syncOnChange ? 1 : 0;
    const interval = parseInt(syncIntervalMins || "5", 10) || 5;

    await env.DB.prepare(
      `INSERT OR IGNORE INTO users (username, password, salt, is_admin, enable_webdav, created_at)
       VALUES (?1, '', '', 1, 1, ?2)`
    ).bind(userNs, now).run();

    const existing = await env.DB.prepare(
      `SELECT webdav_password FROM user_remote_webdav WHERE username = ?1`
    )
      .bind(userNs)
      .first<{ webdav_password: string }>();

    let passwordToSave = existing?.webdav_password || "";
    if (webdavPassword && webdavPassword !== "******") {
      passwordToSave = webdavPassword;
    }
    // HIGH-7: Encrypt WebDAV password before storage
    const encKey = getWebdavEncryptionKey(env);
    if (encKey && passwordToSave) {
      try {
        passwordToSave = await cryptoUtils.encryptAes128Cbc(passwordToSave, encKey);
      } catch {
        // Best-effort encryption; store as-is if it fails
      }
    }

    await env.DB.prepare(
      `INSERT INTO user_remote_webdav (username, enabled, server_url, webdav_user, webdav_password, sync_on_change, sync_interval_mins, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
       ON CONFLICT(username) DO UPDATE SET
         enabled = excluded.enabled,
         server_url = excluded.server_url,
         webdav_user = excluded.webdav_user,
         webdav_password = excluded.webdav_password,
         sync_on_change = excluded.sync_on_change,
         sync_interval_mins = excluded.sync_interval_mins,
         updated_at = excluded.updated_at`
    )
      .bind(userNs, enabledInt, serverUrl || "", webdavUser || "", passwordToSave, syncOnChangeInt, interval, now)
      .run();

    return jsonResponse({ isSuccess: true, data: "配置保存成功" });
  } catch (err: any) {
    console.error("handleSaveRemoteWebdav error:", err);
    return jsonResponse({ isSuccess: false, errorMsg: err.message || "保存配置失败" });
  }
}

async function handleTestRemoteWebdav(request: Request, env: Env): Promise<Response> {
  try {
    const userNs = await resolveUserNs(request, env);
    if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

    const body = await request.json<any>();
    let { serverUrl, webdavUser, webdavPassword } = body;

    if (webdavPassword === "******") {
      const existing = await env.DB.prepare(
        `SELECT webdav_password FROM user_remote_webdav WHERE username = ?1`
      ).bind(userNs).first<{ webdav_password: string }>();
      webdavPassword = existing?.webdav_password || "";
    }
    // HIGH-7: Decrypt stored WebDAV password before use
    const encKey = getWebdavEncryptionKey(env);
    if (encKey && webdavPassword) {
      webdavPassword = await cryptoUtils.decryptWebdavPassword(webdavPassword, encKey);
    }

    if (!serverUrl || !webdavUser || !webdavPassword) {
      return jsonResponse({ isSuccess: false, errorMsg: "请填写完整 WebDAV 地址、用户名和密码" });
    }

    if (!isSafeRemoteUrl(serverUrl)) {
      return jsonResponse({ isSuccess: false, errorMsg: "WebDAV 地址不合法或指向受限网络" });
    }

    const authHeader = `Basic ${btoa(webdavUser + ":" + webdavPassword)}`;
    const cleanUrl = serverUrl.replace(/\/$/, "");

    const resp = await fetch(cleanUrl, {
      method: "PROPFIND",
      headers: {
        Authorization: authHeader,
        Depth: "0",
      },
      signal: AbortSignal.timeout(8000),
    });

    if (resp.ok || resp.status === 207) {
      return jsonResponse({ isSuccess: true, data: "连接成功！WebDAV 服务正常响应。" });
    } else {
      return jsonResponse({ isSuccess: false, errorMsg: `连接响应异常 (HTTP ${resp.status}): 请检查路径与账号权限` });
    }
  } catch (err: any) {
    return jsonResponse({ isSuccess: false, errorMsg: err.message || "测试连接失败" });
  }
}

async function handleSyncRemoteWebdavNow(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const res = await syncUserToRemoteWebdav(env, userNs);
  if (res.success) {
    return jsonResponse({ isSuccess: true, data: "同步成功" });
  } else {
    return jsonResponse({ isSuccess: false, errorMsg: res.error || "同步失败" });
  }
}

function triggerOnChangeSync(env: Env, userNs: string, ctx: ExecutionContext): void {
  ctx.waitUntil(
    (async () => {
      try {
        const row = await env.DB.prepare(
          `SELECT enabled, sync_on_change, last_sync_at FROM user_remote_webdav WHERE username = ?1`
        )
          .bind(userNs)
          .first<{ enabled: number; sync_on_change: number; last_sync_at: number }>();

        if (row && row.enabled === 1 && row.sync_on_change === 1) {
          const now = Math.floor(Date.now() / 1000);
          if (now - (row.last_sync_at || 0) >= 30) {
            await syncUserToRemoteWebdav(env, userNs);
          }
        }
      } catch (e) {
        console.error("OnChange sync error:", e);
      }
    })()
  );
}

async function handleScheduledSync(env: Env): Promise<void> {
  try {
    const rows = await env.DB.prepare(
      `SELECT username, last_sync_at, sync_interval_mins FROM user_remote_webdav WHERE enabled = 1`
    ).all<{ username: string; last_sync_at: number; sync_interval_mins: number }>();

    const now = Math.floor(Date.now() / 1000);
    for (const r of rows.results || []) {
      const intervalSecs = (r.sync_interval_mins || 5) * 60;
      if (now - (r.last_sync_at || 0) >= intervalSecs) {
        await syncUserToRemoteWebdav(env, r.username);
      }
    }
  } catch (e) {
    console.error("Scheduled sync error:", e);
  }
}

async function remoteWebdavEnsureDir(baseUrl: string, authHeader: string, relPath: string): Promise<void> {
  const parts = relPath.replace(/^\/+/, "").split("/").filter(Boolean);
  parts.pop(); // remove file name, keep directory path
  let current = baseUrl.replace(/\/$/, "");
  for (const seg of parts) {
    current += `/${seg}`;
    try {
      await fetch(current, {
        method: "MKCOL",
        headers: { Authorization: authHeader },
      });
    } catch {
      // ignore (MKCOL on existing collection returns 405)
    }
  }
}

async function remoteWebdavPutFile(
  baseUrl: string,
  authHeader: string,
  relPath: string,
  body: Uint8Array | string,
  contentType: string = "application/octet-stream"
): Promise<boolean> {
  const cleanBase = baseUrl.replace(/\/$/, "");
  const cleanRel = relPath.replace(/^\/+/, "");
  await remoteWebdavEnsureDir(cleanBase, authHeader, cleanRel);

  const url = `${cleanBase}/${cleanRel}`;
  const resp = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: authHeader,
      "Content-Type": contentType,
    },
    body,
  });

  return resp.ok || resp.status === 201 || resp.status === 204;
}

async function remoteWebdavGetFile(
  baseUrl: string,
  authHeader: string,
  relPath: string,
  range?: { offset: number; length?: number }
): Promise<Uint8Array | null> {
  const cleanBase = baseUrl.replace(/\/$/, "");
  const cleanRel = relPath.replace(/^\/+/, "");
  const url = `${cleanBase}/${cleanRel}`;

  const headers: Record<string, string> = {
    Authorization: authHeader,
  };

  if (range) {
    const end = range.length !== undefined ? range.offset + range.length - 1 : "";
    headers["Range"] = `bytes=${range.offset}-${end}`;
  }

  try {
    const resp = await fetch(url, { headers });
    if (resp.status === 404) return null;
    if (!resp.ok && resp.status !== 206) return null;
    return new Uint8Array(await resp.arrayBuffer());
  } catch {
    return null;
  }
}

async function fallbackFetchFromRemoteWebdav(
  env: Env,
  relKey: string,
  range?: { offset: number; length?: number }
): Promise<Uint8Array | null> {
  try {
    const parts = relKey.replace(/^\/+/, "").split("/");
    const username = parts.length > 1 ? parts[1] : "";
    if (!username) return null;

    const config = await env.DB.prepare(
      `SELECT server_url, webdav_user, webdav_password, enabled FROM user_remote_webdav WHERE username = ?1`
    )
      .bind(username)
      .first<{ server_url: string; webdav_user: string; webdav_password: string; enabled: number }>();

    if (!config || config.enabled !== 1 || !config.server_url) return null;
    // HIGH-7: Decrypt stored WebDAV password before use
    const encKey = getWebdavEncryptionKey(env);
    let decryptedPassword = config.webdav_password;
    if (encKey && decryptedPassword) {
      decryptedPassword = await cryptoUtils.decryptWebdavPassword(decryptedPassword, encKey);
    }
    const authHeader = `Basic ${btoa(config.webdav_user + ":" + decryptedPassword)}`;
    return await remoteWebdavGetFile(config.server_url, authHeader, relKey, range);
  } catch {
    return null;
  }
}

async function syncUserToRemoteWebdav(env: Env, username: string): Promise<{ success: boolean; error?: string }> {
  try {
    const config = await env.DB.prepare(
      `SELECT server_url, webdav_user, webdav_password, enabled, last_sync_at FROM user_remote_webdav WHERE username = ?1`
    )
      .bind(username)
      .first<{ server_url: string; webdav_user: string; webdav_password: string; enabled: number; last_sync_at: number }>();

    if (!config || config.enabled !== 1 || !config.server_url) {
      return { success: false, error: "未启用远端同步或未配置地址" };
    }

    if (!isSafeRemoteUrl(config.server_url)) {
      throw new Error("远端 WebDAV 地址不合法或指向受限网络");
    }

    const cleanBase = config.server_url.replace(/\/$/, "");
    // HIGH-7: Decrypt stored WebDAV password before use
    const encKey = getWebdavEncryptionKey(env);
    let decryptedPassword = config.webdav_password;
    if (encKey && decryptedPassword) {
      decryptedPassword = await cryptoUtils.decryptWebdavPassword(decryptedPassword, encKey);
    }
    const authHeader = `Basic ${btoa(config.webdav_user + ":" + decryptedPassword)}`;

    // 1. Gather all data for this user
    const [shelf, groups, sources, rss, bookmarks, rules] = await Promise.all([
      documentHandlers.getDocument(env, username, "bookshelf.json"),
      documentHandlers.getDocument(env, username, "bookGroup.json"),
      env.DB.prepare(`SELECT json FROM book_sources WHERE user_ns = ?1`).bind(username).all<{ json: string }>(),
      documentHandlers.getDocument(env, username, "rssSource.json"),
      documentHandlers.getDocument(env, username, "bookmark.json"),
      documentHandlers.getDocument(env, username, "replaceRule.json"),
    ]);

    const parsedSources = (sources.results || []).map((r) => {
      try { return JSON.parse(r.json); } catch { return null; }
    }).filter(Boolean);

    // ==============================================================
    // PART A: 1:1 Mirror User Personal Folder (data/, assets/, books/, webdav/)
    // Allows remote WebDAV to seamlessly replace local R2 when needed!
    // ==============================================================
    const jsonFiles: Record<string, string> = {
      [`data/${username}/bookshelf.json`]: JSON.stringify(shelf || [], null, 2),
      [`data/${username}/bookGroup.json`]: JSON.stringify(groups || [], null, 2),
      [`data/${username}/bookSource.json`]: JSON.stringify(parsedSources, null, 2),
      [`data/${username}/rssSource.json`]: JSON.stringify(rss || [], null, 2),
      [`data/${username}/bookmark.json`]: JSON.stringify(bookmarks || [], null, 2),
      [`data/${username}/replaceRule.json`]: JSON.stringify(rules || [], null, 2),
    };

    for (const [relPath, content] of Object.entries(jsonFiles)) {
      await remoteWebdavPutFile(cleanBase, authHeader, relPath, content, "application/json;charset=utf-8");
    }

    // Mirror user R2 storage objects (assets, epubs, pdfs, mobis, webdav)
    const prefixes = [
      `assets/${username}/`,
      `txts/${username}/`,
      `epubs/${username}/`,
      `pdfs/${username}/`,
      `mobis/${username}/`,
      `webdav/${username}/`,
    ];

    for (const prefix of prefixes) {
      const listed = await env.BUCKET.list({ prefix, limit: 100 });
      for (const obj of listed.objects || []) {
        if (obj.key.endsWith("/")) continue;
        const r2File = await env.BUCKET.get(obj.key);
        if (r2File) {
          const bodyBytes = new Uint8Array(await r2File.arrayBuffer());
          const ct = r2File.httpMetadata?.contentType || "application/octet-stream";
          await remoteWebdavPutFile(cleanBase, authHeader, obj.key, bodyBytes, ct);
        }
      }
    }

    // ==============================================================
    // PART B: Extra Full-Asset Standalone Backup ZIP Archive
    // (Contains: bookshelf + progress, bookSources, groups, rules, bookmarks, rss, readConfig)
    // ==============================================================
    const zipArchiveFiles: Record<string, string> = {
      "bookshelf.json": JSON.stringify(shelf || [], null, 2),
      "bookGroup.json": JSON.stringify(groups || [], null, 2),
      "bookSource.json": JSON.stringify(parsedSources, null, 2),
      "rssSource.json": JSON.stringify(rss || [], null, 2),
      "bookmark.json": JSON.stringify(bookmarks || [], null, 2),
      "replaceRule.json": JSON.stringify(rules || [], null, 2),
    };

    const zipBytes = await createZipArchive(zipArchiveFiles);

    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const timestampZip = `backups/backup-${username}-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}-${pad(now.getMinutes())}.zip`;
    const latestZip = `backups/backup-${username}-latest.zip`;

    await remoteWebdavPutFile(cleanBase, authHeader, timestampZip, zipBytes, "application/zip");
    await remoteWebdavPutFile(cleanBase, authHeader, latestZip, zipBytes, "application/zip");

    const nowTs = Math.floor(Date.now() / 1000);
    await env.DB.prepare(
      `UPDATE user_remote_webdav SET last_sync_at = ?1, last_sync_status = 'success', last_sync_error = NULL WHERE username = ?2`
    )
      .bind(nowTs, username)
      .run();

    return { success: true };
  } catch (err: any) {
    const nowTs = Math.floor(Date.now() / 1000);
    await env.DB.prepare(
      `UPDATE user_remote_webdav SET last_sync_at = ?1, last_sync_status = 'failed', last_sync_error = ?2 WHERE username = ?3`
    )
      .bind(nowTs, err.message, username)
      .run();
    return { success: false, error: err.message };
  }
}

// === ZIP Creation Helpers for Worker ===

const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[i] = c >>> 0;
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function compressDeflate(data: Uint8Array): Promise<{ bytes: Uint8Array; method: number }> {
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

async function createZipArchive(files: Record<string, string>): Promise<Uint8Array> {
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

// ==========================================
// 13. TXT Novel Streaming & Heading Indexer
// ==========================================

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

  // Convert charIndex to UTF-8 byte offset
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

  // If first chapter starts after character 0, add "序章"
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

async function handleTxtUpload(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
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

    // 1. Decode with automatic GBK / UTF-8 detection
    const text = decodeTxtBytes(rawBytes);
    // 2. Re-encode to clean UTF-8
    const utf8Bytes = new TextEncoder().encode(text);
    const fileSize = utf8Bytes.length;

    const safeName = fileName.replace(/[/\\?%*:|"<>]/g, "_");
    const bookId = `txt_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const r2Key = `webdav/${userNs}/book/${safeName}`;

    // 3. Store UTF-8 text into R2
    await env.BUCKET.put(r2Key, utf8Bytes, {
      httpMetadata: { contentType: "text/plain; charset=utf-8" },
    });

    // 4. Scan chapter heading offsets
    const chapters = scanTxtChapterOffsets(text, utf8Bytes);
    const totalChapters = chapters.length;
    const title = fileName.replace(/\.txt$/i, "");
    const now = Math.floor(Date.now() / 1000);

    // 5. Save metadata into D1 txt_books
    await env.DB.prepare(
      `INSERT INTO txt_books (book_id, user_ns, file_name, r2_key, file_size, total_chapters, title, author, status, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, '本地导入', 'ready', ?8, ?9)
       ON CONFLICT(book_id) DO UPDATE SET file_size=excluded.file_size, total_chapters=excluded.total_chapters, title=excluded.title, updated_at=excluded.updated_at`
    )
      .bind(bookId, userNs, fileName, r2Key, fileSize, totalChapters, title, now, now)
      .run();

    // 6. Batch save chapter slice indices into D1 txt_chapters
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

    // 7. Add book to user's bookshelf.json
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

async function handleTxtRead(bookId: string, chapterIndex: number, env: Env): Promise<Response> {
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

async function readTxtChapterText(bookId: string, chapterIndex: number, env: Env): Promise<string> {
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
    // Fallback to remote WebDAV if R2 is unavailable or missing object
    payload = await fallbackFetchFromRemoteWebdav(env, chapter.r2_key, {
      offset: chapter.byte_offset,
      length: chapter.byte_length,
    });
  }

  if (!payload) throw new Error("本地书籍不存在，请重新导入");
  return new TextDecoder().decode(payload);
}

async function handleTxtInfo(bookId: string, env: Env): Promise<Response> {
  const book = await env.DB.prepare(
    `SELECT book_id, file_name, title, author, total_chapters, file_size, status FROM txt_books WHERE book_id = ?1`
  )
    .bind(bookId)
    .first();

  if (!book) return jsonResponse({ isSuccess: false, errorMsg: "未找到该 TXT 书籍" });
  return jsonResponse({ isSuccess: true, data: book });
}

async function handleImportWebdavBook(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  try {
    const userNs = await resolveUserNs(request, env);
    if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

    const { path: relPath, name } = await request.json<any>();
    if (!name) return jsonResponse({ isSuccess: false, errorMsg: "缺少文件名" });

    // Check if book already exists on bookshelf
    const titleWithoutExt = name.replace(/\.[^/.]+$/, "").trim();
    let shelf: any[] = (await documentHandlers.getDocument(env, userNs, "bookshelf.json")) || [];
    const existing = shelf.find(
      (b) => b.name === name || b.name === titleWithoutExt || (b.bookUrl && b.bookUrl.toLowerCase().endsWith("/" + name.toLowerCase()))
    );
    if (existing) {
      return jsonResponse({ isSuccess: false, errorMsg: `书籍已存在：《${name}》` });
    }

    const cleanRel = (relPath || "").replace(/^\/+/, "");
    const sourceKey = `webdav/${userNs}/${cleanRel}`;
    const targetClean = cleanRel.startsWith("book/") ? cleanRel : `book/${name}`;
    const targetKey = `webdav/${userNs}/${targetClean}`;

    // 1. Move file to /book/ if not already inside it
    const moved = sourceKey !== targetKey;
    if (moved) {
      const sourceObj = await env.BUCKET.get(sourceKey);
      if (!sourceObj) {
        const remoteBytes = await fallbackFetchFromRemoteWebdav(env, sourceKey);
        if (remoteBytes) {
          await env.BUCKET.put(targetKey, remoteBytes);
        } else {
          return jsonResponse({ isSuccess: false, errorMsg: "WebDAV 文件未找到" });
        }
      } else {
        await env.BUCKET.put(targetKey, sourceObj.body, {
          httpMetadata: sourceObj.httpMetadata,
        });
        await env.BUCKET.delete(sourceKey);
      }
    }

    // 2. Fetch target object from R2 to index
    const targetObj = await env.BUCKET.get(targetKey);
    if (!targetObj) return jsonResponse({ isSuccess: false, errorMsg: "无法读取目标书籍文件" });

    const fileSize = targetObj.size;
    const lower = name.toLowerCase();

    let newBook: any = null;

    if (lower.endsWith(".epub")) {
      const bookId = `epub_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
      const { title, author, totalChapters } = await indexEpubIntoDatabase(
        env,
        userNs,
        bookId,
        name,
        targetKey,
        fileSize
      );

      const bookUrl = `local-epub:${bookId}`;
      newBook = {
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
        durChapterTime: Date.now(),
        totalChapterNum: totalChapters,
        kind: "本地EPUB",
      };
    } else if (lower.endsWith(".txt")) {
      newBook = await indexTxtBookFromR2(env, userNs, name, targetKey, fileSize);
    } else if (lower.endsWith(".pdf")) {
      const bookId = `pdf_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
      const tailSize = Math.min(65536, fileSize);
      const tailObj = await env.BUCKET.get(targetKey, { range: { offset: Math.max(0, fileSize - tailSize), length: tailSize } });
      const tailBytes = tailObj ? new Uint8Array(await tailObj.arrayBuffer()) : new Uint8Array(0);
      const tailText = new TextDecoder().decode(tailBytes);
      const countMatch = tailText.match(/\/Count\s+(\d+)/);
      const totalPages = countMatch ? parseInt(countMatch[1], 10) : 1;
      const titleMatch = tailText.match(/\/Title\s*\(([^)]+)\)/);
      const authorMatch = tailText.match(/\/Author\s*\(([^)]+)\)/);
      const title = titleMatch ? titleMatch[1].trim() : name.replace(/\.pdf$/i, "");
      const author = authorMatch ? authorMatch[1].trim() : "未知作者";
      const now = Math.floor(Date.now() / 1000);

      await env.DB.prepare(
        `INSERT INTO pdf_books (book_id, user_ns, file_name, r2_key, file_size, total_pages, title, author, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?)`
      ).bind(bookId, userNs, name, targetKey, fileSize, totalPages, title, author, now, now).run();

      const bookUrl = `local-pdf:${bookId}`;
      newBook = {
        name: title,
        author: author,
        bookUrl,
        origin: "local-pdf",
        originName: "本地 PDF",
        tocUrl: bookUrl,
        canUpdate: false,
        durChapterIndex: 0,
        durChapterPos: 0,
        durChapterTitle: "第 1 页",
        durChapterTime: Date.now(),
        totalChapterNum: totalPages,
        kind: "本地PDF",
      };
    }

    if (newBook) {
      let shelf: any[] = (await documentHandlers.getDocument(env, userNs, "bookshelf.json")) || [];
      const existingIdx = shelf.findIndex(
        (b) => b.bookUrl === newBook.bookUrl || (b.name === newBook.name && b.origin === newBook.origin)
      );
      if (existingIdx >= 0) {
        shelf[existingIdx] = {
          ...shelf[existingIdx],
          ...newBook,
          bookUrl: shelf[existingIdx].bookUrl,
          durChapterTime: Date.now(),
        };
      } else {
        shelf.unshift(newBook);
      }
      await documentHandlers.saveDocument(env, userNs, "bookshelf.json", shelf);
      triggerOnChangeSync(env, userNs, ctx);
    }

    return jsonResponse({
      isSuccess: true,
      data: { moved, book: newBook },
    });
  } catch (err: any) {
    console.error("handleImportWebdavBook error:", err);
    return jsonResponse({ isSuccess: false, errorMsg: err.message || "导入 WebDAV 书籍失败" });
  }
}

async function indexTxtBookFromR2(env: Env, userNs: string, fileName: string, r2Key: string, fileSize: number) {
  const obj = await env.BUCKET.get(r2Key);
  if (!obj) throw new Error("无法从 R2 读取 TXT 文件");
  const rawBytes = new Uint8Array(await obj.arrayBuffer());
  const text = decodeTxtBytes(rawBytes);
  const utf8Bytes = new TextEncoder().encode(text);
  const actualSize = utf8Bytes.length;

  const bookId = `txt_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  if (rawBytes.length !== actualSize) {
    await env.BUCKET.put(r2Key, utf8Bytes, {
      httpMetadata: { contentType: "text/plain; charset=utf-8" },
    });
  }

  const chapters = scanTxtChapterOffsets(text, utf8Bytes);
  const totalChapters = chapters.length;
  const title = fileName.replace(/\.txt$/i, "");
  const now = Math.floor(Date.now() / 1000);

  await env.DB.prepare(
    `INSERT INTO txt_books (book_id, user_ns, file_name, r2_key, file_size, total_chapters, title, author, status, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, '本地导入', 'ready', ?8, ?9)
     ON CONFLICT(book_id) DO UPDATE SET file_size=excluded.file_size, total_chapters=excluded.total_chapters, title=excluded.title, updated_at=excluded.updated_at`
  ).bind(bookId, userNs, fileName, r2Key, actualSize, totalChapters, title, now, now).run();

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
  return {
    name: title,
    author: "本地导入",
    bookUrl,
    origin: "local-txt",
    originName: "本地 TXT",
    tocUrl: bookUrl,
    canUpdate: false,
    durChapterIndex: 0,
    durChapterPos: 0,
    durChapterTitle: chapters[0]?.title || "开始阅读",
    durChapterTime: Date.now(),
    totalChapterNum: totalChapters,
    kind: "本地TXT",
  };
}

async function handleChunkedUploadInit(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const body = await request.json<any>();
  const fileName = body.fileName || "file";
  const target = body.target || "bookshelf";
  const cleanPath = (body.path || "/").replace(/^\/+/, "").replace(/\/$/, "");
  const safeName = fileName.replace(/[/\\?%*:|"<>]/g, "_");

  let r2Key = "";
  if (target === "webdav") {
    r2Key = cleanPath ? `webdav/${userNs}/${cleanPath}/${safeName}` : `webdav/${userNs}/${safeName}`;
  } else {
    r2Key = `webdav/${userNs}/book/${safeName}`;
  }

  let contentType = "application/octet-stream";
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

async function handleChunkedUploadPart(request: Request, env: Env): Promise<Response> {
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
    const file = formData.get("chunk") as unknown as File | null;
    if (!file) return jsonResponse({ isSuccess: false, errorMsg: "缺少分片数据" });
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

async function handleChunkedUploadComplete(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
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

    if (target === "webdav") {
      triggerOnChangeSync(env, userNs, ctx);
      return jsonResponse({
        isSuccess: true,
        data: { name: fileName, size: fileSize, key },
      });
    }

    const lower = (fileName || "").toLowerCase();
    let newBook: any = null;

    if (lower.endsWith(".epub")) {
      const bookId = `epub_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
      const { title, author, totalChapters } = await indexEpubIntoDatabase(
        env,
        userNs,
        bookId,
        fileName,
        key,
        fileSize
      );
      const bookUrl = `local-epub:${bookId}`;
      newBook = {
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
        durChapterTime: Date.now(),
        totalChapterNum: totalChapters,
        kind: "本地EPUB",
      };
    } else if (lower.endsWith(".txt")) {
      newBook = await indexTxtBookFromR2(env, userNs, fileName, key, fileSize);
    } else if (lower.endsWith(".pdf")) {
      const bookId = `pdf_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
      const title = fileName.replace(/\.pdf$/i, "");
      const totalPages = 1;
      const now = Math.floor(Date.now() / 1000);
      await env.DB.prepare(
        `INSERT INTO pdf_books (book_id, user_ns, file_name, r2_key, file_size, total_pages, title, author, status, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, '未知作者', 'ready', ?8, ?9)
         ON CONFLICT(book_id) DO UPDATE SET file_size=excluded.file_size, title=excluded.title, updated_at=excluded.updated_at`
      ).bind(bookId, userNs, fileName, key, fileSize, totalPages, title, now, now).run();

      const bookUrl = `local-pdf:${bookId}`;
      newBook = {
        name: title,
        author: "未知作者",
        bookUrl,
        origin: "local-pdf",
        originName: "本地 PDF",
        tocUrl: bookUrl,
        canUpdate: false,
        durChapterIndex: 0,
        durChapterPos: 0,
        durChapterTitle: "第 1 页",
        durChapterTime: Date.now(),
        totalChapterNum: totalPages,
        kind: "本地PDF",
      };
    }

    if (newBook) {
      let shelf: any[] = (await documentHandlers.getDocument(env, userNs, "bookshelf.json")) || [];
      const idx = shelf.findIndex(
        (b) => b.bookUrl === newBook.bookUrl || (b.name === newBook.name && b.origin === newBook.origin)
      );
      if (idx >= 0) {
        shelf[idx] = {
          ...shelf[idx],
          ...newBook,
          bookUrl: shelf[idx].bookUrl,
          durChapterTime: Date.now(),
        };
      } else {
        shelf.unshift(newBook);
      }
      await documentHandlers.saveDocument(env, userNs, "bookshelf.json", shelf);
      triggerOnChangeSync(env, userNs, ctx);
    }

    return jsonResponse({
      isSuccess: true,
      data: newBook,
    });
  } catch (err: any) {
    return jsonResponse({ isSuccess: false, errorMsg: err.message || "合并分片失败" });
  }
}

// ==========================================
// 14. AI Companion & Reading Assistant Handlers
// ==========================================

async function handleGetAiBookMemory(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const url = new URL(request.url);
  let bookUrl = url.searchParams.get("bookUrl") || url.searchParams.get("url") || "";
  if (!bookUrl && request.method === "POST") {
    try {
      const body = await request.json<any>();
      bookUrl = body.bookUrl || body.url || "";
    } catch {
      // ignore
    }
  }

  if (!bookUrl) return jsonResponse({ isSuccess: false, errorMsg: "缺少 bookUrl" });

  const bookKey = md5(bookUrl);
  const row = await env.DB.prepare(
    `SELECT json FROM ai_book_memories WHERE user_ns = ?1 AND book_key = ?2`
  )
    .bind(userNs, bookKey)
    .first<{ json: string }>();

  if (!row) return jsonResponse({ isSuccess: true, data: null });
  return jsonResponse({ isSuccess: true, data: JSON.parse(row.json) });
}

async function handleSaveAiBookMemory(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const memory = await request.json<any>();
  const bookUrl = memory.bookUrl || memory.book_url || "";
  if (!bookUrl) return jsonResponse({ isSuccess: false, errorMsg: "缺少 bookUrl" });

  const bookKey = md5(bookUrl);
  const now = Math.floor(Date.now() / 1000);
  if (!memory.updatedAt) memory.updatedAt = Date.now();

  await env.DB.prepare(
    `INSERT INTO ai_book_memories (user_ns, book_key, book_url, json, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5)
     ON CONFLICT(user_ns, book_key) DO UPDATE SET
       book_url = excluded.book_url,
       json = excluded.json,
       updated_at = excluded.updated_at`
  )
    .bind(userNs, bookKey, bookUrl, JSON.stringify(memory), now)
    .run();

  return jsonResponse({ isSuccess: true, data: memory });
}

async function handleDeleteAiBookMemory(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  let bookUrl = new URL(request.url).searchParams.get("bookUrl") || "";
  if (!bookUrl) {
    try {
      const body = await request.json<any>();
      bookUrl = body.bookUrl || body.url || "";
    } catch {
      // ignore
    }
  }

  if (!bookUrl) return jsonResponse({ isSuccess: false, errorMsg: "缺少 bookUrl" });
  const bookKey = md5(bookUrl);

  await env.DB.prepare(
    `DELETE FROM ai_book_memories WHERE user_ns = ?1 AND book_key = ?2`
  )
    .bind(userNs, bookKey)
    .run();

  return jsonResponse({ isSuccess: true, data: { deleted: true } });
}

async function handleAiProxy(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const req = await request.json<any>();
  let baseUrl = req.baseUrl || "";
  let apiKey = req.apiKey || "";
  let path = req.path || "/v1/chat/completions";
  let provider = req.provider || "";

  // 1. Check if server config is requested
  if (req.useServerConfig) {
    const config = await documentHandlers.getDocument(env, "__app__", "ai-model-config.json");
    if (config?.text?.enabled) {
      baseUrl = config.text.base_url || config.text.baseUrl || "";
      apiKey = config.text.api_key || config.text.apiKey || "";
      provider = config.text.provider || "";
    }
  }

  // 2. Check if Cloudflare Workers AI is requested or selected as default
  const isWorkersAi =
    provider === "cloudflare" ||
    req.useWorkersAi === true ||
    req.model?.startsWith("@cf/") ||
    req.body?.model?.startsWith("@cf/") ||
    (!baseUrl && !!env.AI);

  if (isWorkersAi && env.AI) {
    return handleWorkersAiInference(req, env, userNs);
  }

  // 3. Fallback to external AI API
  if (!baseUrl) {
    return jsonResponse({ isSuccess: false, errorMsg: "缺少 AI 模型接口地址 (baseUrl)，或未配置 Cloudflare Workers AI" });
  }

  const targetUrl = req.fullUrl ? baseUrl : `${baseUrl.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
  if (!isSafeRemoteUrl(targetUrl)) {
    return jsonResponse({ isSuccess: false, errorMsg: "禁止访问内网或受限 AI 目标地址 (SSRF 防御)" });
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey.trim()}`;
  }

  try {
    const upstream = await fetch(targetUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(req.body || {}),
    });

    const respHeaders = new Headers(corsHeaders());
    respHeaders.set("Content-Type", upstream.headers.get("Content-Type") || "application/json");

    return new Response(upstream.body, {
      status: upstream.status,
      headers: respHeaders,
    });
  } catch (err: any) {
    return jsonResponse({ isSuccess: false, errorMsg: `AI 模型上游连接失败: ${err.message}` }, 502);
  }
}

async function handleWorkersAiInference(req: any, env: Env, userNs: string): Promise<Response> {
  const path = req.path || "/v1/chat/completions";

  // Image generation
  if (path === "/v1/images/generations" || req.kind === "image") {
    const model = req.body?.model?.startsWith("@cf/")
      ? req.body.model
      : "@cf/black-forest-labs/flux-1-schnell";

    try {
      const prompt = req.body?.prompt || "";
      const imageBytes = await env.AI.run(model, { prompt });
      const imgKey = `assets/${userNs}/ai-images/img_${Date.now()}.png`;
      await env.BUCKET.put(imgKey, imageBytes, {
        httpMetadata: { contentType: "image/png" },
      });

      return jsonResponse({
        created: Math.floor(Date.now() / 1000),
        data: [{ url: `/${imgKey}` }],
      });
    } catch (err: any) {
      return jsonResponse({ isSuccess: false, errorMsg: `Workers AI 绘图失败: ${err.message}` }, 500);
    }
  }

  // Text chat completions
  const model = req.body?.model?.startsWith("@cf/")
    ? req.body.model
    : "@cf/qwen/qwen1.5-7b-chat";

  const messages = req.body?.messages || [];
  const isStream = req.body?.stream === true;

  try {
    if (isStream) {
      const stream = await env.AI.run(model, {
        messages,
        stream: true,
      });
      const headers = new Headers(corsHeaders());
      headers.set("Content-Type", "text/event-stream");
      headers.set("Cache-Control", "no-cache");
      return new Response(stream, { headers });
    } else {
      const result = await env.AI.run(model, {
        messages,
      });
      const textContent = result.response || result.description || "";
      const openAiFormat = {
        id: `chatcmpl-${Date.now()}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: textContent,
            },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      };
      return jsonResponse(openAiFormat);
    }
  } catch (err: any) {
    return jsonResponse({ isSuccess: false, errorMsg: `Workers AI 推理失败: ${err.message}` }, 500);
  }
}

async function handleAiProxyImage(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const { url } = await request.json<{ url: string }>();
  if (!url || !isSafeRemoteUrl(url)) {
    return jsonResponse({ isSuccess: false, errorMsg: "无效或受限的图片地址 (SSRF 防御)" });
  }

  try {
    const upstream = await fetch(url, {
      headers: { Accept: "image/*,*/*;q=0.8" },
    });

    if (!upstream.ok) {
      return jsonResponse({ isSuccess: false, errorMsg: `拉取图片失败 (HTTP ${upstream.status})` });
    }

    const headers = new Headers(corsHeaders());
    headers.set("Content-Type", upstream.headers.get("Content-Type") || "image/png");
    headers.set("Cache-Control", "public, max-age=86400");

    return new Response(upstream.body, { headers });
  } catch (err: any) {
    return jsonResponse({ isSuccess: false, errorMsg: `图片代理失败: ${err.message}` });
  }
}

// ==========================================
// 15. Bounded Multi-Source Search (Scheme 1)
// ==========================================

async function handleSearchBookMulti(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const body = await request.json<any>();
  const key = (body.key || "").trim();
  const page = parseInt(body.page || "1", 10) || 1;
  const bookSourceUrls: string[] | undefined = Array.isArray(body.bookSourceUrls) ? body.bookSourceUrls : undefined;
  const bookSourceGroup: string | undefined = body.bookSourceGroup;

  if (!key) return jsonResponse({ isSuccess: true, data: [] });

  // 1. Fetch enabled book sources from D1
  const rows = await env.DB.prepare(
    `SELECT json FROM book_sources WHERE user_ns = ?1`
  )
    .bind(userNs)
    .all<{ json: string }>();

  let sources: any[] = (rows.results || []).map((r) => {
    try { return JSON.parse(r.json); } catch { return null; }
  }).filter((s) => s && s.enabled !== false && s.searchUrl && s.searchUrl.trim().length > 0);

  if (bookSourceUrls && bookSourceUrls.length > 0) {
    const urlSet = new Set(bookSourceUrls);
    sources = sources.filter((s) => urlSet.has(s.bookSourceUrl));
  } else if (bookSourceGroup) {
    sources = sources.filter((s) => s.bookSourceGroup?.includes(bookSourceGroup));
  }

  // Scheme 1 Safety: Bound to max 20 sources per Worker invocation to never exceed Cloudflare's 50 subrequests limit!
  const targetChunk = sources.slice(0, 20);
  if (targetChunk.length === 0) {
    return jsonResponse({ isSuccess: true, data: [] });
  }

  // 2. Concurrently search the chunk using Promise.allSettled
  const searchTasks = targetChunk.map((source) => searchSingleSource(source, key, page, env));
  const settled = await Promise.allSettled(searchTasks);

  const allBooks: any[] = [];
  for (const res of settled) {
    if (res.status === "fulfilled" && Array.isArray(res.value)) {
      allBooks.push(...res.value);
    }
  }

  return jsonResponse({ isSuccess: true, data: allBooks });
}

async function handleExploreBook(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const body = await request.json<any>().catch(() => ({}));
  const sourceUrl = body.bookSourceUrl || "";
  let targetUrl = (body.rule || body.url || "").trim();
  const page = parseInt(body.page || "1", 10) || 1;

  if (!targetUrl) return jsonResponse({ isSuccess: true, data: [] });

  targetUrl = targetUrl
    .replace(/\{\{page\}\}/g, String(page))
    .replace(/\$\{page\}/g, String(page))
    .replace(/\{\{page-1\}\}/g, String(page - 1))
    .replace(/\$\{page-1\}/g, String(page - 1));

  let sRow: any = null;
  if (sourceUrl) {
    sRow = await env.DB.prepare(
      `SELECT json FROM book_sources WHERE user_ns = ?1 AND book_source_url = ?2`
    ).bind(userNs, sourceUrl).first<{ json: string }>();
  }

  let source: any = null;
  if (sRow) {
    try { source = JSON.parse(sRow.json); } catch {}
  }

  if (targetUrl.startsWith("/")) {
    targetUrl = `${source?.bookSourceUrl || ""}${targetUrl}`;
  }

  let fetchHeaders: Record<string, string> = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  };
  if (source?.header) {
    try {
      const parsedHdr = JSON.parse(source.header);
      Object.assign(fetchHeaders, parsedHdr);
    } catch {}
  }

  try {
    const resp = await fetch(targetUrl, {
      headers: fetchHeaders,
      signal: AbortSignal.timeout(10000),
    });
    const text = await resp.text();

    const books = extractExploreResults(text, source, targetUrl);
    return jsonResponse({ isSuccess: true, data: books });
  } catch (err: any) {
    return jsonResponse({ isSuccess: false, errorMsg: err.message || "探索失败" });
  }
}

function extractExploreResults(text: string, source: any, baseUrl: string): any[] {
  const books: any[] = [];
  try {
    if (text.trim().startsWith("{") || text.trim().startsWith("[")) {
      const data = JSON.parse(text);
      const list = Array.isArray(data) ? data : data.data?.list || data.list || data.data || [];
      if (Array.isArray(list)) {
        for (const item of list.slice(0, 30)) {
          const name = item.title || item.name || item.bookName;
          if (name) {
            let bookUrl = item.bookUrl || item.url || "";
            if (!bookUrl && item.bookId) {
              bookUrl = `${source?.bookSourceUrl || ""}/findChapterList?book_id=${item.bookId}`;
            }
            books.push({
              name,
              author: item.author || "未知作者",
              bookUrl: bookUrl || `${baseUrl}#${item.bookId || name}`,
              origin: source?.bookSourceUrl || baseUrl,
              originName: source?.bookSourceName || "书海来源",
              coverUrl: item.coverImg || item.cover || item.image || "",
              intro: item.desc || item.intro || "",
              kind: item.categoryName || item.category || "网络小说",
              wordCount: item.word || item.words_number || "",
            });
          }
        }
      }
    }
  } catch {}
  return books;
}

async function decodeXiaoXiao(contentB64: string): Promise<any> {
  const binaryString = atob(contentB64);
  const len = binaryString.length;
  const raw = new Uint8Array(len);
  for (let i = 0; i < len; i++) raw[i] = binaryString.charCodeAt(i);

  const datas = raw.subarray(16, len - 16);
  let kStr = "";
  for (let i = 0; i < 16; i++) kStr += String.fromCharCode(raw[i]);
  const kHashBuf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(kStr));
  const ks = new Uint8Array(kHashBuf);

  let iStr = "";
  for (let i = len - 16; i < len; i++) iStr += String.fromCharCode(raw[i]);
  const vHex = md5(iStr);
  const b1 = new TextEncoder().encode(iStr);
  const b2 = new TextEncoder().encode(vHex);

  const ivs = new Uint8Array(16);
  for (let idx = 0; idx < 16; idx++) {
    ivs[idx] = (b2[idx] ^ b1[idx]) ^ 0xff;
  }

  const aesKey = await crypto.subtle.importKey("raw", ks, { name: "AES-CBC" }, false, ["decrypt"]);
  const decryptedBuf = await crypto.subtle.decrypt({ name: "AES-CBC", iv: ivs }, aesKey, datas);
  const decText = new TextDecoder().decode(decryptedBuf);
  return JSON.parse(decText);
}

async function searchSingleSource(source: any, key: string, page: number, env: Env): Promise<any[]> {
  try {
    let rawUrl = (source.searchUrl || "").trim();
    if (!rawUrl) return [];

    let urlConfig: any = null;
    if (rawUrl.includes(",{") || rawUrl.includes(", {")) {
      const idx = rawUrl.indexOf(",{") !== -1 ? rawUrl.indexOf(",{") : rawUrl.indexOf(", {");
      try {
        urlConfig = JSON.parse(rawUrl.substring(idx + 1));
      } catch {}
      rawUrl = rawUrl.substring(0, idx).trim();
    }

    const encodedKey = encodeURIComponent(key);
    let targetUrl = rawUrl
      .replace(/\{\{[^}]*key[^}]*\}\}/gi, encodedKey)
      .replace(/\$\{key\}/g, encodedKey)
      .replace(/\{\{page\}\}/g, String(page))
      .replace(/\$\{page\}/g, String(page));

    if (targetUrl.startsWith("/")) {
      const baseOrigin = new URL(source.bookSourceUrl).origin;
      targetUrl = `${baseOrigin}${targetUrl}`;
    }

    if (!isSafeRemoteUrl(targetUrl)) return [];

    const headers = getDynamicHeaders(source);

    const fetchOptions: RequestInit = {
      headers,
      signal: AbortSignal.timeout(8000),
    };

    if (urlConfig) {
      if (urlConfig.method) fetchOptions.method = urlConfig.method.toUpperCase();
      if (urlConfig.headers) Object.assign(headers, urlConfig.headers);
      if (urlConfig.body) {
        let bStr = typeof urlConfig.body === "string" ? urlConfig.body : JSON.stringify(urlConfig.body);
        bStr = bStr
          .replace(/\{\{[^}]*key[^}]*\}\}/gi, encodedKey)
          .replace(/\$\{key\}/g, encodedKey)
          .replace(/\{\{page\}\}/g, String(page));
        fetchOptions.body = bStr;
        if (typeof urlConfig.body !== "string" && !headers["Content-Type"]) {
          headers["Content-Type"] = "application/json";
        }
      }
    }

    const resp = await fetch(targetUrl, fetchOptions);
    if (!resp.ok) return [];
    const text = await resp.text();

    const ruleBooks = await parseSearchResultsWithRules(text, source, targetUrl, key);
    if (ruleBooks.length > 0) return ruleBooks;

    return await extractSearchResults(text, source, targetUrl, key);
  } catch {
    return [];
  }
}

async function extractSearchResults(text: string, source: any, baseUrl: string, keyword: string): Promise<any[]> {
  const books: any[] = [];
  let baseDomain = "";
  try {
    baseDomain = new URL(baseUrl).origin;
  } catch {
    return [];
  }

  // 1. JSON response handling (including XiaoXiao encrypted content)
  if (text.trim().startsWith("{") || text.trim().startsWith("[")) {
    try {
      let data = JSON.parse(text);
      if (data.data?.content && typeof data.data.content === "string") {
        try {
          data = await decodeXiaoXiao(data.data.content);
        } catch {}
      }

      const list = data.book || data.data?.list || data.list || data.books || (Array.isArray(data) ? data : []);
      if (Array.isArray(list)) {
        for (const item of list.slice(0, 20)) {
          const name = item.name || item.title || item.bookName;
          if (name) {
            let bookUrl = item.bookUrl || item.url || "";
            if (!bookUrl && item.book_id) {
              bookUrl = `https://d.chuangke.tv/book/details/v4/${Math.floor(item.book_id / 1000)}/${item.book_id}.html`;
            } else if (!bookUrl && item.bookId) {
              bookUrl = `${source?.bookSourceUrl || baseDomain}/findChapterList?book_id=${item.bookId}`;
            }

            books.push({
              name,
              author: item.author || "未知作者",
              bookUrl: bookUrl || `${baseUrl}#${item.bookId || item.book_id || name}`,
              origin: source?.bookSourceUrl || baseUrl,
              originName: source?.bookSourceName || "网络书源",
              coverUrl: item.coverImg || item.cover || item.image || "",
              intro: item.desc || item.intro || item.remark || "",
              kind: item.categoryName || item.category || item.ltype || "网络小说",
              wordCount: item.word || item.words_number || "",
            });
          }
        }
        if (books.length > 0) return books;
      }
    } catch {}
  }

  // 2. HTML response handling: Extract matching books by headings or links
  const cardRegex = /<(?:div|li|tr|article)[^>]*class=["'][^"']*(?:book|item|novel|card)[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|li|tr|article)>/gi;
  let cardMatch;
  while ((cardMatch = cardRegex.exec(text)) !== null) {
    const cardHtml = cardMatch[1];
    const titleMatch = cardHtml.match(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    if (titleMatch) {
      let bookUrl = titleMatch[1].trim();
      const rawText = titleMatch[2].replace(/<[^>]+>/g, "").trim();
      if (rawText && rawText.length <= 40) {
        if (bookUrl.startsWith("/")) bookUrl = `${baseDomain}${bookUrl}`;
        else if (!bookUrl.startsWith("http")) bookUrl = `${baseDomain}/${bookUrl}`;

        const authorMatch = cardHtml.match(/(?:作者|auth)[^>]*>([^<]+)/i) || cardHtml.match(/<span[^>]*class=["'][^"']*author[^"']*["'][^>]*>([\s\S]*?)<\/span>/i);
        const author = authorMatch ? authorMatch[1].replace(/<[^>]+>/g, "").trim() : "未知作者";

        books.push({
          name: rawText,
          author,
          bookUrl,
          origin: source.bookSourceUrl,
          originName: source.bookSourceName,
          kind: "网络连载",
        });
      }
    }
  }
  if (books.length > 0) return books.slice(0, 20);

  // 3. Fallback: standard link regex
  const linkRegex = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  const seenUrls = new Set<string>();

  while ((match = linkRegex.exec(text)) !== null) {
    let href = match[1].trim();
    const rawText = match[2].replace(/<[^>]+>/g, "").trim();

    if (rawText.toLowerCase().includes(keyword.toLowerCase()) && rawText.length <= 40) {
      let bookUrl = href;
      if (bookUrl.startsWith("/")) bookUrl = `${baseDomain}${bookUrl}`;
      else if (!bookUrl.startsWith("http")) bookUrl = `${baseDomain}/${bookUrl}`;

      if (!seenUrls.has(bookUrl)) {
        seenUrls.add(bookUrl);
        books.push({
          name: rawText,
          author: source.bookSourceName || "网络来源",
          bookUrl,
          origin: source.bookSourceUrl,
          originName: source.bookSourceName,
          kind: "网络连载",
        });
      }
    }
  }

  return books.slice(0, 20);
}

// ==========================================
// 16. Bookshelf, Chapter List & Book Info
// ==========================================

async function handleGetShelfBook(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  let url = new URL(request.url).searchParams.get("url") || "";
  if (!url && request.method === "POST") {
    try {
      const body = await request.json<any>();
      url = body.url || "";
    } catch {}
  }

  const shelf: any[] = (await documentHandlers.getDocument(env, userNs, "bookshelf.json")) || [];
  const book = shelf.find((b) => b.bookUrl === url);
  if (!book) return jsonResponse({ isSuccess: false, errorMsg: "书籍未在书架中" });
  return jsonResponse({ isSuccess: true, data: book });
}

async function handleGetBookInfo(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  let url = new URL(request.url).searchParams.get("url") || "";
  if (!url && request.method === "POST") {
    try {
      const body = await request.json<any>();
      url = body.url || "";
    } catch {}
  }

  if (url.startsWith("local-txt:")) {
    const bookId = url.split(":")[1].split("#")[0];
    const info = await env.DB.prepare(`SELECT * FROM txt_books WHERE book_id = ?1`).bind(bookId).first<any>();
    if (info) {
      return jsonResponse({
        isSuccess: true,
        data: {
          name: info.title,
          author: info.author,
          bookUrl: url,
          totalChapterNum: info.total_chapters,
          origin: "local-txt",
          originName: "本地 TXT",
        },
      });
    }
  }

  if (url.startsWith("local-epub:")) {
    const bookId = url.split(":")[1].split("#")[0];
    const info = await env.DB.prepare(`SELECT * FROM epub_books WHERE book_id = ?1`).bind(bookId).first<any>();
    if (info) {
      return jsonResponse({
        isSuccess: true,
        data: {
          name: info.title || info.file_name,
          author: info.author || "未知作者",
          bookUrl: url,
          totalChapterNum: info.total_chapters,
          origin: "local-epub",
          originName: "本地 EPUB",
        },
      });
    }
  }

  // Fallback to bookshelf
  const shelf: any[] = (await documentHandlers.getDocument(env, userNs, "bookshelf.json")) || [];
  const book = shelf.find((b) => b.bookUrl === url);
  return jsonResponse({ isSuccess: true, data: book || { bookUrl: url, name: "书籍详情" } });
}

async function handleGetChapterList(request: Request, env: Env): Promise<Response> {
  try {
    const userNs = await resolveUserNs(request, env);
    if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

    let bookUrl = new URL(request.url).searchParams.get("bookUrl") || "";
    let tocUrl = new URL(request.url).searchParams.get("tocUrl") || "";
    let bookName = "";
    let body: any = {};
    if (request.method === "POST") {
      try {
        body = await request.json<any>();
        bookUrl = body.bookUrl || bookUrl;
        tocUrl = body.tocUrl || tocUrl;
        bookName = (body.name || "").trim();
      } catch {}
    }

    const targetUrl = bookUrl || tocUrl;
    const cleanTarget = decodeURIComponent(targetUrl);
    const fileNameCandidate = cleanTarget.split("/").pop()?.split("#")[0]?.trim() || "";

    // 1. Local TXT Chapters
    if (targetUrl.startsWith("local-txt:") || cleanTarget.toLowerCase().includes(".txt")) {
      let bookId = targetUrl.startsWith("local-txt:") ? targetUrl.split(":")[1].split("#")[0] : "";
      if (!bookId) {
        const row = await env.DB.prepare(
          `SELECT book_id FROM txt_books WHERE user_ns = ?1 AND (file_name = ?2 OR title = ?3) LIMIT 1`
        ).bind(userNs, fileNameCandidate, bookName).first<{ book_id: string }>();
        bookId = row?.book_id || "";
      }

      if (bookId) {
        const rows = await env.DB.prepare(
          `SELECT chapter_index, title FROM txt_chapters WHERE book_id = ?1 ORDER BY chapter_index ASC`
        ).bind(bookId).all<{ chapter_index: number; title: string }>();

        if (rows.results && rows.results.length > 0) {
          const chapters = rows.results.map((r) => ({
            index: r.chapter_index,
            title: r.title,
            url: `local-txt:${bookId}#${r.chapter_index}`,
          }));
          return jsonResponse({ isSuccess: true, data: chapters });
        }
      }
      return jsonResponse({ isSuccess: false, errorMsg: "书籍不存在，请重新上传" });
    }

    // 2. Local EPUB Chapters
    if (targetUrl.startsWith("local-epub:") || cleanTarget.toLowerCase().includes(".epub")) {
      let bookId = targetUrl.startsWith("local-epub:") ? targetUrl.split(":")[1].split("#")[0] : "";
      if (!bookId) {
        const row = await env.DB.prepare(
          `SELECT book_id FROM epub_books WHERE user_ns = ?1 AND (file_name = ?2 OR title = ?3) LIMIT 1`
        ).bind(userNs, fileNameCandidate, bookName).first<{ book_id: string }>();
        bookId = row?.book_id || "";
      }

      if (bookId) {
        const rows = await env.DB.prepare(
          `SELECT chapter_index, title FROM epub_chapters WHERE book_id = ?1 ORDER BY chapter_index ASC`
        ).bind(bookId).all<{ chapter_index: number; title: string }>();

        if (rows.results && rows.results.length > 0) {
          const chapters = rows.results.map((r) => ({
            index: r.chapter_index,
            title: r.title,
            url: `local-epub:${bookId}#${r.chapter_index}`,
          }));
          return jsonResponse({ isSuccess: true, data: chapters });
        }
      }
      return jsonResponse({ isSuccess: false, errorMsg: "书籍不存在，请重新上传" });
    }

    // 3. Local PDF Pages
    if (targetUrl.startsWith("local-pdf:") || cleanTarget.toLowerCase().includes(".pdf")) {
      let bookId = targetUrl.startsWith("local-pdf:") ? targetUrl.split(":")[1]?.split("#")[0] : "";
      if (!bookId) {
        const row = await env.DB.prepare(
          `SELECT book_id FROM pdf_books WHERE user_ns = ?1 AND (file_name = ?2 OR title = ?3) LIMIT 1`
        ).bind(userNs, fileNameCandidate, bookName).first<{ book_id: string }>();
        bookId = row?.book_id || "";
      }

      if (bookId) {
        const book = await env.DB.prepare(`SELECT total_pages FROM pdf_books WHERE book_id = ?1`).bind(bookId).first<{ total_pages: number }>();
        const count = Math.max(1, book?.total_pages || 1);
        const chapters = Array.from({ length: count }, (_, i) => ({
          index: i,
          title: `第 ${i + 1} 页`,
          url: `local-pdf:${bookId}#${i}`,
        }));
        return jsonResponse({ isSuccess: true, data: chapters });
      }
      return jsonResponse({ isSuccess: false, errorMsg: "书籍不存在，请重新上传" });
    }

    // 4. Online Book Source Chapters
    let bookSourceUrl = (body.bookSourceUrl || "").trim();
    let source: any = null;
    if (bookSourceUrl) {
      const sRow = await env.DB.prepare(
        `SELECT json FROM book_sources WHERE user_ns = ?1 AND book_source_url = ?2`
      ).bind(userNs, bookSourceUrl).first<{ json: string }>();
      if (sRow) {
        try { source = JSON.parse(sRow.json); } catch {}
      }
    }

    let reqUrl = targetUrl;
    if (reqUrl.startsWith("/")) {
      reqUrl = `${source?.bookSourceUrl || ""}${reqUrl}`;
    }
    if (!reqUrl.startsWith("http")) {
      return jsonResponse({ isSuccess: true, data: [] });
    }

    let fetchHeaders = getDynamicHeaders(source);

    const resp = await fetch(reqUrl, { headers: fetchHeaders, signal: AbortSignal.timeout(10000) });
    if (!resp.ok) return jsonResponse({ isSuccess: true, data: [] });
    const text = await fetchTextWithEncoding(resp);
    const chapters = await parseSourceChapterList(text, source, reqUrl);
    return jsonResponse({ isSuccess: true, data: chapters });
  } catch (err: any) {
    console.error("handleGetChapterList error:", err);
    return jsonResponse({ isSuccess: false, errorMsg: err.message || "获取目录失败" });
  }
}

async function parseSourceChapterList(text: string, source: any, targetUrl: string): Promise<any[]> {
  try {
    const ruleChapters = await parseChapterListWithRules(text, source, targetUrl);
    if (ruleChapters && ruleChapters.length > 0) return ruleChapters;
  } catch {}

  const chapters: any[] = [];
  const baseDomain = new URL(targetUrl).origin;

  // 1. JSON response handling
  if (text.trim().startsWith("{") || text.trim().startsWith("[")) {
    try {
      let j = JSON.parse(text);

      // Check XiaoXiao multiple source details
      if (targetUrl.includes("/book/details/") || targetUrl.includes("/book/source/")) {
        let contentB64 = j.data?.content || j.content;
        if (contentB64) {
          try {
            const decoded = await decodeXiaoXiao(contentB64);
            let sitePath = "";
            if (Array.isArray(decoded) && decoded[0]?.site_path) {
              sitePath = decoded[0].site_path;
            } else if (decoded.site_path) {
              sitePath = decoded.site_path;
            } else {
              const sourceUrl = targetUrl.replace("/details/", "/source/");
              const sResp = await fetch(sourceUrl, { headers: getDynamicHeaders(source, sourceUrl) });
              if (sResp.ok) {
                const sJson = await sResp.json<any>();
                if (sJson.data?.content) {
                  const sDecoded = await decodeXiaoXiao(sJson.data.content);
                  if (Array.isArray(sDecoded) && sDecoded[0]?.site_path) {
                    sitePath = sDecoded[0].site_path;
                  }
                }
              }
            }

            if (sitePath) {
              const catalogUrl = `https://catalog.chuangke.tv/${sitePath}`;
              const cResp = await fetch(catalogUrl, { headers: getDynamicHeaders(source, catalogUrl) });
              if (cResp.ok) {
                j = await cResp.json();
              }
            }
          } catch {}
        }
      }

      const rawList = j.data?.chapters || j.chapters || j.data?.list || j.list || (Array.isArray(j.data) ? j.data : Array.isArray(j) ? j : []);
      if (Array.isArray(rawList)) {
        for (let idx = 0; idx < rawList.length; idx++) {
          const ch = rawList[idx];
          let title = ch.name || ch.title || ch.chapterName || `第 ${idx + 1} 章`;
          if (title.length > 20 && /^[A-Za-z0-9+/=_-]+$/.test(title)) {
            try {
              let padTitle = title.replace(/-/g, "+").replace(/_/g, "/");
              while (padTitle.length % 4 !== 0) padTitle += "=";
              title = await cryptoUtils.decryptAes128Cbc(padTitle, "Pxga!h*e4@T8xfOm", "E&z!EHGLd$fli*8R");
            } catch {}
          }

          let url = "";
          if (ch.path && ((source?.bookSourceUrl || "").includes("chuangke") || targetUrl.includes("chuangke"))) {
            url = `https://chapter.chuangke.tv/${ch.path.replace(/^\/+/, "")}`;
          } else if (ch.id && (targetUrl.includes("5006") || (source?.bookSourceUrl || "").includes("5006"))) {
            const bid = j.data?.book_id || j.book_id || j.data?.bookId || "";
            url = `${source?.bookSourceUrl || "http://119.45.176.116:5006"}/chapterContent,{"body":{"book_id":${bid},"chapterIdList":"${ch.id},"},"method":"POST"}`;
          } else {
            url = ch.url || ch.link || ch.path || "";
            if (url.startsWith("//")) {
              url = `${new URL(baseDomain).protocol}${url}`;
            } else if (url && !url.startsWith("http")) {
              url = `${baseDomain}/${url.replace(/^\/+/, "")}`;
            }
          }

          chapters.push({
            index: idx,
            title,
            url,
          });
        }
        if (chapters.length > 0) return chapters;
      }
    } catch {}
  }

  // 2. HTML response handling: extract chapter links
  const linkRegex = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  let idx = 0;
  const seenUrls = new Set<string>();

  const ignorePatterns = [
    /\/author\//i,
    /\/rank/i,
    /\/month/i,
    /\/down/i,
    /\/tag/i,
    /\/css/i,
    /\/login/i,
    /\/register/i,
    /\/look_/i,
    /\/re_/i,
    /\/sr_/i,
    /\.(css|js|png|jpg|jpeg|gif|ico)(\?|$)/i,
  ];

  while ((match = linkRegex.exec(text)) !== null) {
    let href = match[1].trim();
    const rawText = match[2].replace(/<[^>]+>/g, "").trim();

    if (!rawText || rawText.length > 60 || rawText.length < 2) continue;
    if (ignorePatterns.some((p) => p.test(href))) continue;

    if (href.startsWith("//")) {
      href = `${new URL(baseDomain).protocol}${href}`;
    } else if (href.startsWith("/")) {
      href = `${baseDomain}${href}`;
    } else if (!href.startsWith("http")) {
      href = `${baseDomain}/${href}`;
    }

    if (seenUrls.has(href)) continue;

    const isChapter =
      /第\s*[0-9一二三四五六七八九十百千万0-9]+\s*[章回节卷集幕篇部]/.test(rawText) ||
      /_\d+\.html/i.test(href) ||
      /\/\d+\.html/i.test(href) ||
      /chapter|read/i.test(href);

    if (isChapter) {
      seenUrls.add(href);
      chapters.push({
        index: idx++,
        title: rawText,
        url: href,
      });
    }
  }

  return chapters;
}

async function handleSaveBookGroupId(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const { bookUrl, groupId } = await request.json<any>();
  let shelf: any[] = (await documentHandlers.getDocument(env, userNs, "bookshelf.json")) || [];
  const idx = shelf.findIndex((b) => b.bookUrl === bookUrl);
  if (idx >= 0) {
    shelf[idx].group = groupId;
    await documentHandlers.saveDocument(env, userNs, "bookshelf.json", shelf);
    triggerOnChangeSync(env, userNs, ctx);
  }
  return jsonResponse({ isSuccess: true, data: "分组修改成功" });
}

// ==========================================
// 17. WebDAV REST Endpoints (for Web Manager)
// ==========================================

async function handleGetWebdavFileList(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const url = new URL(request.url);
  const relPath = (url.searchParams.get("path") || "/").replace(/^\/+/, "").replace(/\/$/, "");
  const prefix = relPath ? `webdav/${userNs}/${relPath}/` : `webdav/${userNs}/`;

  const listed = await env.BUCKET.list({ prefix, delimiter: "/" });
  const entries: any[] = [];

  // Subdirectories
  for (const dp of listed.delimitedPrefixes || []) {
    const subName = dp.replace(prefix, "").replace(/\/$/, "");
    if (!subName) continue;
    entries.push({
      name: subName,
      size: 0,
      path: `/${relPath ? relPath + "/" : ""}${subName}`,
      lastModified: Date.now(),
      isDirectory: true,
    });
  }

  // Files
  for (const obj of listed.objects || []) {
    const fileName = obj.key.replace(prefix, "");
    if (!fileName || fileName.includes("/")) continue;
    entries.push({
      name: fileName,
      size: obj.size,
      path: `/${relPath ? relPath + "/" : ""}${fileName}`,
      lastModified: obj.uploaded.getTime(),
      isDirectory: false,
    });
  }

  return jsonResponse({ isSuccess: true, data: entries });
}

async function handleGetWebdavFile(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const url = new URL(request.url);
  const relPath = (url.searchParams.get("path") || "").replace(/^\/+/, "");
  const r2Key = `webdav/${userNs}/${relPath}`;
  const fileName = relPath.split("/").pop() || "file";

  const obj = await env.BUCKET.get(r2Key);
  let bodyStream: any = null;
  let byteLen = 0;
  let contentType = "application/octet-stream";

  if (obj) {
    bodyStream = obj.body;
    byteLen = obj.size;
    contentType = obj.httpMetadata?.contentType || contentType;
  } else {
    const remoteBytes = await fallbackFetchFromRemoteWebdav(env, r2Key);
    if (remoteBytes) {
      bodyStream = remoteBytes;
      byteLen = remoteBytes.length;
    }
  }

  if (!bodyStream) {
    return new Response("File Not Found", { status: 404, headers: corsHeaders() });
  }

  const headers = new Headers(corsHeaders());
  headers.set("Content-Type", contentType);
  headers.set("Content-Length", byteLen.toString());
  headers.set("Content-Disposition", `attachment; filename="${encodeURIComponent(fileName)}"; filename*=UTF-8''${encodeURIComponent(fileName)}`);
  return new Response(bodyStream, { headers });
}

async function handleUploadFileToWebdav(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const formData = await request.formData();
  const dirPath = (formData.get("path") as string || "/").replace(/^\/+/, "").replace(/\/$/, "");
  const prefix = dirPath ? `webdav/${userNs}/${dirPath}/` : `webdav/${userNs}/`;

  for (const [key, rawValue] of formData.entries()) {
    // @cloudflare/workers-types models FormData values as `string`, but the
    // runtime returns a File for file inputs, so widen before the check.
    const value = rawValue as unknown as File | string;
    if (key.startsWith("file") && value instanceof File) {
      const safeName = value.name.replace(/[/\\?%*:|"<>]/g, "_");
      await env.BUCKET.put(`${prefix}${safeName}`, await value.arrayBuffer(), {
        httpMetadata: { contentType: value.type || "application/octet-stream" },
      });
    }
  }

  return jsonResponse({ isSuccess: true, data: [] });
}

async function handleDeleteWebdavFile(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const { path } = await request.json<any>();
  const clean = (path || "").replace(/^\/+/, "");
  const r2Key = `webdav/${userNs}/${clean}`;

  await env.BUCKET.delete(r2Key);
  // Also delete subkeys if directory
  const listed = await env.BUCKET.list({ prefix: `${r2Key}/` });
  for (const o of listed.objects || []) {
    await env.BUCKET.delete(o.key);
  }

  return jsonResponse({ isSuccess: true, data: "删除成功" });
}

async function handleDeleteWebdavFileList(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const { path: paths } = await request.json<any>();
  const list: string[] = Array.isArray(paths) ? paths : [paths];

  for (const p of list) {
    const clean = (p || "").replace(/^\/+/, "");
    const r2Key = `webdav/${userNs}/${clean}`;
    await env.BUCKET.delete(r2Key);
  }

  return jsonResponse({ isSuccess: true, data: "批量删除成功" });
}

// ==========================================
// 18. User Management Handlers (Admin & User)
// ==========================================

