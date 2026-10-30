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
    // User Authentication & Profile
    if (path === "/reader3/login" && request.method === "POST") {
      return authHandlers.handleLogin(request, env);
    }
    if (path === "/reader3/logout" && request.method === "POST") {
      return authHandlers.handleLogout(request, env);
    }
    if (path === "/reader3/getUserInfo" && request.method === "GET") {
      return authHandlers.handleGetUserInfo(request, env);
    }

    // Document Store
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

    // Book Sources
    if (path === "/reader3/getBookSources") return bookSourceHandlers.handleGetBookSources(request, env);
    if (path === "/reader3/getBookSource" && request.method === "GET") return bookSourceHandlers.handleGetBookSource(request, env);
    if (path === "/reader3/saveBookSource" && request.method === "POST") return bookSourceHandlers.handleSaveBookSource(request, env, ctx);
    if (path === "/reader3/saveBookSources" && request.method === "POST") return bookSourceHandlers.handleSaveBookSources(request, env, ctx);
    if (path === "/reader3/deleteBookSource" && request.method === "POST") return bookSourceHandlers.handleDeleteBookSource(request, env, ctx);
    if (path === "/reader3/deleteBookSources" && request.method === "POST") return bookSourceHandlers.handleDeleteBookSources(request, env, ctx);
    if (path === "/reader3/deleteAllBookSources" && request.method === "POST") return bookSourceHandlers.handleDeleteAllBookSources(request, env, ctx);
    if (path === "/reader3/readRemoteSourceFile" && request.method === "GET") return bookSourceHandlers.handleReadRemoteSourceFile(request, env);

    // User Management
    if (path === "/reader3/changePassword" && request.method === "POST") return userAdminHandlers.handleChangePassword(request, env);
    if (path === "/reader3/getUserList") return userAdminHandlers.handleGetUserList(request, env);
    if (path === "/reader3/addUser" && request.method === "POST") return userAdminHandlers.handleAddUser(request, env);
    if (path === "/reader3/updateUser" && request.method === "POST") return userAdminHandlers.handleUpdateUser(request, env);
    if (path === "/reader3/deleteUsers" && request.method === "POST") return userAdminHandlers.handleDeleteUsers(request, env);
    if (path === "/reader3/resetPassword" && request.method === "POST") return userAdminHandlers.handleResetPassword(request, env);

    // Bookshelf
    if (path === "/reader3/getBookshelf") return bookshelfHandlers.handleGetBookshelf(request, env);
    if (path === "/reader3/saveBook" && request.method === "POST") return bookshelfHandlers.handleSaveBook(request, env, ctx);
    if (path === "/reader3/saveBooks" && request.method === "POST") return bookshelfHandlers.handleSaveBooks(request, env, ctx);
    if (path === "/reader3/deleteBook" && request.method === "POST") return bookshelfHandlers.handleDeleteBook(request, env, ctx);
    if (path === "/reader3/deleteBooks" && request.method === "POST") return bookshelfHandlers.handleDeleteBooks(request, env, ctx);
    if (path === "/reader3/saveBookProgress" && request.method === "POST") return bookshelfHandlers.handleSaveBookProgress(request, env, ctx);
    if (path === "/reader3/setBookSource" && request.method === "POST") return bookshelfHandlers.handleSetBookSource(request, env);
    if (path === "/reader3/saveBookGroupId" && request.method === "POST") return bookshelfHandlers.handleSaveBookGroupId(request, env, ctx);
    if (path === "/reader3/getShelfBook" && request.method === "GET") return bookshelfHandlers.handleGetShelfBook(request, env);
    if (path === "/reader3/getShelfBookWithCacheInfo" && request.method === "GET") return bookshelfHandlers.handleGetShelfBookWithCacheInfo(request, env);

    // Content
    if (path === "/reader3/getBookContent") return contentHandlers.handleGetBookContent(request, env);

    // WebDAV
    if (path === "/webdav" || path.startsWith("/webdav/")) {
      return webdavHandlers.handleWebdav(request, env);
    }
    if (path === "/reader3/getWebdav") return webdavHandlers.handleGetRemoteWebdav(request, env);
    if (path === "/reader3/saveWebdav" && request.method === "POST") return webdavHandlers.handleSaveRemoteWebdav(request, env);
    if (path === "/reader3/testWebdav" && request.method === "POST") return webdavHandlers.handleTestRemoteWebdav(request, env);
    if (path === "/reader3/syncWebdavNow" && request.method === "POST") return webdavHandlers.handleSyncRemoteWebdavNow(request, env);

    // EPUB/PDF/TXT
    if (path === "/reader3/epub" || path.startsWith("/reader3/epub/")) {
      if (epubHandlers.handleEpubRead) {
        const url = new URL(request.url);
        const bookId = url.searchParams.get("bookId") || path.split("/").pop() || "";
        const index = parseInt(url.searchParams.get("index") || url.searchParams.get("page") || "0", 10);
        return epubHandlers.handleEpubRead(bookId, index, env);
      }
      return jsonResponse({error:'not impl'}, 500);
    }
    if (path === "/reader3/upload" && request.method === "POST") return txtHandlers.handleTxtUpload ? txtHandlers.handleTxtUpload(request, env, ctx) : jsonResponse({isSuccess:false,errorMsg:'not impl'});
    if (path === "/reader3/uploadFile" && request.method === "POST") return jsonResponse({isSuccess:false,errorMsg:'not impl'});
    if (path === "/reader3/deleteFile" && request.method === "POST") return jsonResponse({isSuccess:false,errorMsg:'not impl'});

    // Health check
    if (path === "/health") {
      return jsonResponse({ status: "ok", service: "reader-rust-cloudflare-worker" });
    }

    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return jsonResponse({ isSuccess: false, errorMsg: "接口未找到" }, 404);
  } catch (err: any) {
    return jsonResponse({ isSuccess: false, errorMsg: err.message || "服务器内部错误" }, 500);
  }
}
