import { jsonResponse, corsHeaders } from "./http";
import { Env } from "./types";
import * as authHandlers from "./handlers/auth";
import * as documentHandlers from "./handlers/document";
import * as userAdminHandlers from "./handlers/user-admin";
import * as bookSourceHandlers from "./handlers/book-source";
import * as bookshelfHandlers from "./handlers/bookshelf";
import * as contentHandlers from "./handlers/content";
import * as epubHandlers from "./handlers/epub";
import * as pdfHandlers from "./handlers/pdf";
import * as txtHandlers from "./handlers/txt";
import * as rssHandlers from "./handlers/rss";
import * as aiHandlers from "./handlers/ai";
import * as assetHandlers from "./handlers/asset";
import * as searchHandlers from "./handlers/search";
import * as uploadHandlers from "./handlers/upload";
import * as webdavHandlers from "./handlers/webdav";

export async function handleRequest(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(),
    });
  }

  const url = new URL(request.url);
  const path = url.pathname;

  try {
    // ==========================================
    // 1. User Authentication & Profile
    // ==========================================
    if (path === "/reader3/login" && request.method === "POST") {
      return authHandlers.handleLogin(request, env);
    }
    if (path === "/reader3/logout" && request.method === "POST") {
      return authHandlers.handleLogout(request, env);
    }
    if (path === "/reader3/getUserInfo" && request.method === "GET") {
      return authHandlers.handleGetUserInfo(request, env);
    }

    // ==========================================
    // 2. Document Store (Bookmarks, ReplaceRules, BookGroups, RSS Sources, AI Config)
    // ==========================================
    if (path === "/reader3/getBookmarks") return documentHandlers.handleGetDocument(request, env, "bookmark.json");
    if (path === "/reader3/saveBookmark" && request.method === "POST") return documentHandlers.handleSaveDocumentItem(request, env, "bookmark.json", ctx);
    if (path === "/reader3/deleteBookmark" && request.method === "POST") return documentHandlers.handleDeleteDocumentItem(request, env, "bookmark.json", ctx);

    if (path === "/reader3/getReplaceRules") return documentHandlers.handleGetDocument(request, env, "replaceRule.json");
    if (path === "/reader3/saveReplaceRule" && request.method === "POST") return documentHandlers.handleSaveDocumentItem(request, env, "replaceRule.json", ctx);
    if (path === "/reader3/deleteReplaceRule" && request.method === "POST") return documentHandlers.handleDeleteDocumentItem(request, env, "replaceRule.json", ctx);

    if (path === "/reader3/getBookGroups") return documentHandlers.handleGetDocument(request, env, "bookGroup.json");
    if (path === "/reader3/saveBookGroup" && request.method === "POST") return documentHandlers.handleSaveDocumentItem(request, env, "bookGroup.json", ctx);
    if (path === "/reader3/deleteBookGroup" && request.method === "POST") return documentHandlers.handleDeleteDocumentItem(request, env, "bookGroup.json", ctx);

    if (path === "/reader3/getRssSources") return documentHandlers.handleGetDocument(request, env, "rssSource.json");
    if (path === "/reader3/saveRssSource" && request.method === "POST") return documentHandlers.handleSaveDocumentItem(request, env, "rssSource.json", ctx);
    if (path === "/reader3/saveRssSources" && request.method === "POST") return documentHandlers.handleSaveDocumentItems(request, env, "rssSource.json", ctx);
    if (path === "/reader3/deleteRssSource" && request.method === "POST") return documentHandlers.handleDeleteDocumentItem(request, env, "rssSource.json", ctx);
    if (path === "/reader3/deleteRssSources" && request.method === "POST") return documentHandlers.handleDeleteDocumentItems(request, env, "rssSource.json", ctx);

    if (path === "/reader3/getAiModelConfig") return documentHandlers.handleGetDocument(request, env, "ai-model-config.json");
    if (path === "/reader3/saveAiModelConfig" && request.method === "POST") return documentHandlers.handleSaveDocumentItem(request, env, "ai-model-config.json", ctx);

    // ==========================================
    // 3. Book Sources (D1)
    // ==========================================
    if (path === "/reader3/getBookSources") return bookSourceHandlers.handleGetBookSources(request, env);
    if (path === "/reader3/getBookSource" && request.method === "GET") return bookSourceHandlers.handleGetBookSource(request, env);
    if (path === "/reader3/saveBookSource" && request.method === "POST") return bookSourceHandlers.handleSaveBookSource(request, env, ctx);
    if (path === "/reader3/saveBookSources" && request.method === "POST") return bookSourceHandlers.handleSaveBookSources(request, env, ctx);
    if (path === "/reader3/deleteBookSource" && request.method === "POST") return bookSourceHandlers.handleDeleteBookSource(request, env, ctx);
    if (path === "/reader3/deleteBookSources" && request.method === "POST") return bookSourceHandlers.handleDeleteBookSources(request, env, ctx);
    if (path === "/reader3/deleteAllBookSources" && request.method === "POST") return bookSourceHandlers.handleDeleteAllBookSources(request, env, ctx);
    if (path === "/reader3/readRemoteSourceFile" && request.method === "POST") return bookSourceHandlers.handleReadRemoteSourceFile(request, env);

    // Multi-Source Search
    if (path === "/reader3/searchBookMulti" && request.method === "POST") return searchHandlers.handleSearchBookMulti(request, env);
    if (path === "/reader3/testBookSources" && request.method === "POST") return searchHandlers.handleTestBookSources(request, env);
    if (path === "/reader3/exploreBook" && request.method === "POST") return searchHandlers.handleExploreBook(request, env);

    // ==========================================
    // 4. User Management
    // ==========================================
    if (path === "/reader3/changePassword" && request.method === "POST") return userAdminHandlers.handleChangePassword(request, env);
    if (path === "/reader3/getUserList") return userAdminHandlers.handleGetUserList(request, env);
    if (path === "/reader3/addUser" && request.method === "POST") return userAdminHandlers.handleAddUser(request, env);
    if (path === "/reader3/updateUser" && request.method === "POST") return userAdminHandlers.handleUpdateUser(request, env);
    if (path === "/reader3/deleteUsers" && request.method === "POST") return userAdminHandlers.handleDeleteUsers(request, env);
    if (path === "/reader3/resetPassword" && request.method === "POST") return userAdminHandlers.handleResetPassword(request, env);

    // ==========================================
    // 5. Bookshelf & Reading Progress
    // ==========================================
    if (path === "/reader3/getBookshelf") return bookshelfHandlers.handleGetBookshelf(request, env);
    if (path === "/reader3/getShelfBookWithCacheInfo" && request.method === "GET") return bookshelfHandlers.handleGetShelfBookWithCacheInfo(request, env);
    if (path === "/reader3/saveBook" && request.method === "POST") return bookshelfHandlers.handleSaveBook(request, env, ctx);
    if (path === "/reader3/saveBooks" && request.method === "POST") return bookshelfHandlers.handleSaveBooks(request, env, ctx);
    if (path === "/reader3/deleteBook" && request.method === "POST") return bookshelfHandlers.handleDeleteBook(request, env, ctx);
    if (path === "/reader3/deleteBooks" && request.method === "POST") return bookshelfHandlers.handleDeleteBooks(request, env, ctx);
    if (path === "/reader3/saveBookProgress" && request.method === "POST") return bookshelfHandlers.handleSaveBookProgress(request, env, ctx);
    if (path === "/reader3/setBookSource" && request.method === "POST") return bookshelfHandlers.handleSetBookSource(request, env);
    if (path === "/reader3/saveBookGroupId" && request.method === "POST") return bookshelfHandlers.handleSaveBookGroupId(request, env, ctx);
    if (path === "/reader3/getShelfBook" && request.method === "GET") return bookshelfHandlers.handleGetShelfBook(request, env);
    if (path === "/reader3/getBookInfo") return bookshelfHandlers.handleGetBookInfo(request, env);
    if (path === "/reader3/getChapterList") return bookshelfHandlers.handleGetChapterList(request, env);

    // ==========================================
    // 6. Chapter Content Router
    // ==========================================
    if (path === "/reader3/getBookContent") return contentHandlers.handleGetBookContent(request, env);

    // ==========================================
    // 7. RSS Articles
    // ==========================================
    if (path === "/reader3/getRssArticles") return rssHandlers.handleGetRssArticles(request, env);
    if (path === "/reader3/getRssContent") return rssHandlers.handleGetRssContent(request, env);

    // ==========================================
    // 8. EPUB Streaming & Indexing
    // ==========================================
    if ((path === "/reader3/epub/upload" || path === "/reader3/uploadEpubBook") && request.method === "POST") return epubHandlers.handleEpubUpload(request, env);
    if (path === "/reader3/epub/read" && request.method === "GET") {
      const bookId = url.searchParams.get("bookId") || "";
      const pageIndex = parseInt(url.searchParams.get("page") || "0", 10);
      return epubHandlers.handleEpubRead(bookId, pageIndex, env);
    }
    if (path === "/reader3/epub/status" && request.method === "GET") {
      return epubHandlers.handleEpubStatus(url.searchParams.get("bookId") || "", env);
    }
    if (path === "/reader3/epub/asset" && request.method === "GET") {
      return epubHandlers.handleEpubAsset(request, env);
    }

    // ==========================================
    // 9. PDF Streaming & TOC
    // ==========================================
    if ((path === "/reader3/pdf/upload" || path === "/reader3/uploadPdfBook") && request.method === "POST") return pdfHandlers.handlePdfUpload(request, env);
    if (path === "/reader3/pdf/stream" && request.method === "GET") return pdfHandlers.handlePdfStream(request, env);
    if (path === "/reader3/pdf/info" && request.method === "GET") return pdfHandlers.handlePdfInfo(url.searchParams.get("bookId") || "", env);
    if (path === "/reader3/pdf/toc" && request.method === "GET") return pdfHandlers.handlePdfToc(url.searchParams.get("bookId") || "", env);

    // ==========================================
    // 10. TXT Streaming & Heading Indexing
    // ==========================================
    if ((path === "/reader3/txt/upload" || path === "/reader3/uploadLocalBook" || path === "/reader3/uploadTxtBook") && request.method === "POST") {
      return txtHandlers.handleTxtUpload(request, env, ctx);
    }
    if (path === "/reader3/txt/read" && request.method === "GET") {
      const bookId = url.searchParams.get("bookId") || "";
      const chapterIndex = parseInt(url.searchParams.get("index") || "0", 10);
      return txtHandlers.handleTxtRead(bookId, chapterIndex, env);
    }
    if (path === "/reader3/txt/info" && request.method === "GET") {
      return txtHandlers.handleTxtInfo(url.searchParams.get("bookId") || "", env);
    }

    // ==========================================
    // 11. Upload (Chunked + File)
    // ==========================================
    if (path === "/reader3/upload/init" && request.method === "POST") return uploadHandlers.handleChunkedUploadInit(request, env);
    if (path === "/reader3/upload/part" && request.method === "POST") return uploadHandlers.handleChunkedUploadPart(request, env);
    if (path === "/reader3/upload/complete" && request.method === "POST") return uploadHandlers.handleChunkedUploadComplete(request, env, ctx);
    if (path === "/reader3/importWebdavBook" && request.method === "POST") {
      return uploadHandlers.handleImportWebdavBook(request, env, ctx);
    }
    if (path === "/reader3/uploadFile" && request.method === "POST") return uploadHandlers.handleUploadFile(request, env);
    if (path === "/reader3/deleteFile" && request.method === "POST") return uploadHandlers.handleDeleteFile(request, env);

    // ==========================================
    // 12. Assets & Covers (R2)
    // ==========================================
    if (path.startsWith("/assets/") || path === "/reader3/cover") return assetHandlers.handleGetAsset(request, env);

    // ==========================================
    // 13. WebDAV Protocol & REST APIs
    // ==========================================
    if (path === "/webdav" || path.startsWith("/webdav/")) {
      return webdavHandlers.handleWebdav(request, env);
    }
    if (path.startsWith("/reader3/webdav")) return webdavHandlers.handleWebdav(request, env);
    if (path === "/reader3/getWebdavFileList" && request.method === "GET") return webdavHandlers.handleGetWebdavFileList(request, env);
    if (path === "/reader3/getWebdavFile" && request.method === "GET") return webdavHandlers.handleGetWebdavFile(request, env);
    if (path === "/reader3/uploadFileToWebdav" && request.method === "POST") return webdavHandlers.handleUploadFileToWebdav(request, env);
    if (path === "/reader3/deleteWebdavFile" && request.method === "POST") return webdavHandlers.handleDeleteWebdavFile(request, env);
    if (path === "/reader3/deleteWebdavFileList" && request.method === "POST") return webdavHandlers.handleDeleteWebdavFileList(request, env);

    // Remote WebDAV Sync Configuration & Actions
    if (path === "/reader3/user/remoteWebdav" && request.method === "GET") {
      return webdavHandlers.handleGetRemoteWebdav(request, env);
    }
    if (path === "/reader3/user/remoteWebdav" && request.method === "POST") {
      return webdavHandlers.handleSaveRemoteWebdav(request, env);
    }
    if (path === "/reader3/user/remoteWebdav/test" && request.method === "POST") {
      return webdavHandlers.handleTestRemoteWebdav(request, env);
    }
    if (path === "/reader3/user/remoteWebdav/syncNow" && request.method === "POST") {
      return webdavHandlers.handleSyncRemoteWebdavNow(request, env);
    }

    // ==========================================
    // 14. AI Companion & Reading Assistant
    // ==========================================
    if (path === "/reader3/getAiBookMemory") return aiHandlers.handleGetAiBookMemory(request, env);
    if (path === "/reader3/saveAiBookMemory" && request.method === "POST") return aiHandlers.handleSaveAiBookMemory(request, env);
    if (path === "/reader3/deleteAiBookMemory" && request.method === "POST") return aiHandlers.handleDeleteAiBookMemory(request, env);
    if (path === "/reader3/aiProxy" && request.method === "POST") return aiHandlers.handleAiProxy(request, env);
    if (path === "/reader3/aiProxyImage" && request.method === "POST") return aiHandlers.handleAiProxyImage(request, env);

    // ==========================================
    // 15. Health Check
    // ==========================================
    if (path === "/health") {
      return jsonResponse({ status: "ok", service: "reader-rust-cloudflare-worker" });
    }

    // ==========================================
    // 16. Fallback to static assets
    // ==========================================
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return jsonResponse({ isSuccess: false, errorMsg: "接口未找到" }, 404);
  } catch (err: any) {
    return jsonResponse({ isSuccess: false, errorMsg: err.message || "服务器内部错误" }, 500);
  }
}
