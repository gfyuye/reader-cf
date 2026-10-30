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
import * as uploadHandlers from "./handlers/upload";
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
import * as webdavHandlers from "./handlers/webdav";
import { handleRequest } from "./router";

export type { Env, EpubQueueMessage, CentralDirEntry, EpubTocItem } from "./types";

// Bind handler functions from split modules
const {
  handleGetBookSources,
  handleGetBookSource,
  handleSaveBookSource,
  handleSaveBookSources,
  handleDeleteBookSource,
  handleDeleteBookSources,
  handleDeleteAllBookSources,
  handleReadRemoteSourceFile,
} = bookSourceHandlers;

const {
  handleGetBookshelf,
  handleSaveBook,
  handleSaveBooks,
  handleDeleteBook,
  handleDeleteBooks,
  handleSaveBookProgress,
} = bookshelfHandlers;

const { handleGetBookContent } = contentHandlers;

const {
  handleEpubUpload,
  handleEpubRead,
  handleEpubStatus,
  handleEpubAsset,
} = epubHandlers;

const {
  handlePdfUpload,
  handlePdfStream,
  handlePdfInfo,
  handlePdfToc,
} = pdfHandlers;

const {
  handleTxtUpload,
  handleTxtRead,
  handleTxtInfo,
} = txtHandlers;

const {
  handleWebdav,
  handleGetRemoteWebdav,
  handleSaveRemoteWebdav,
  handleTestRemoteWebdav,
  handleSyncRemoteWebdavNow,
  handleGetWebdavFileList,
  handleGetWebdavFile,
  handleUploadFileToWebdav,
  handleDeleteWebdavFile,
  handleDeleteWebdavFileList,
} = webdavHandlers;

const { handleGetRssArticles, handleGetRssContent } = rssHandlers;

const {
  handleGetAiBookMemory,
  handleSaveAiBookMemory,
  handleDeleteAiBookMemory,
  handleAiProxy,
  handleAiProxyImage,
} = aiHandlers;

const { handleGetAsset } = assetHandlers;

const {
  handleSearchBookMulti,
  handleTestBookSources,
  handleExploreBook,
} = searchHandlers;

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
    // Delegate to router for migrated routes
    const url = new URL(request.url);
    const path = url.pathname;
    const migrated = [
      "/reader3/login",
      "/reader3/logout",
      "/reader3/getUserInfo",
      "/reader3/getBookmarks",
      "/reader3/saveBookmark",
      "/reader3/deleteBookmark",
      "/reader3/getReplaceRules",
      "/reader3/saveReplaceRule",
      "/reader3/deleteReplaceRule",
      "/reader3/getBookGroups",
      "/reader3/saveBookGroup",
      "/reader3/deleteBookGroup",
      "/reader3/getRssSources",
      "/reader3/saveRssSource",
      "/reader3/saveRssSources",
      "/reader3/deleteRssSource",
      "/reader3/deleteRssSources",
      "/reader3/getAiModelConfig",
      "/reader3/saveAiModelConfig",
      "/reader3/changePassword",
      "/reader3/getUserList",
      "/reader3/addUser",
      "/reader3/updateUser",
      "/reader3/deleteUsers",
      "/reader3/resetPassword",
      "/health",
    ];
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(),
      });
    }
    if (migrated.includes(path) || path === "/health") {
      return handleRequest(request, env, ctx);
    }

    try {
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
        return searchHandlers.handleSearchBookMulti(request, env);
      }
      if (path === "/reader3/testBookSources" && request.method === "POST") {
        return searchHandlers.handleTestBookSources(request, env);
      }
      if (path === "/reader3/exploreBook" && request.method === "POST") {
        return searchHandlers.handleExploreBook(request, env);
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
      if (path === "/reader3/getRssArticles") return rssHandlers.handleGetRssArticles(request, env);
      if (path === "/reader3/getRssContent") return rssHandlers.handleGetRssContent(request, env);

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
        return uploadHandlers.handleImportWebdavBook(request, env, ctx);
      }

      // Chunked Upload for Big Files (100MB ~ 1GB+)
      if (path === "/reader3/upload/init" && request.method === "POST") return uploadHandlers.handleChunkedUploadInit(request, env);
      if (path === "/reader3/upload/part" && request.method === "POST") return uploadHandlers.handleChunkedUploadPart(request, env);
      if (path === "/reader3/upload/complete" && request.method === "POST") return uploadHandlers.handleChunkedUploadComplete(request, env, ctx);

      // 10. Assets & Covers (R2)
      if (path === "/reader3/uploadFile" && request.method === "POST") return handleUploadFile(request, env, ctx);
      if (path === "/reader3/deleteFile" && request.method === "POST") return handleDeleteFile(request, env, ctx);
      if (path.startsWith("/assets/") || path === "/reader3/cover") return assetHandlers.handleGetAsset(request, env);

      // 10. WebDAV Protocol & REST APIs (for Web & App)
      if (path.startsWith("/reader3/webdav")) return handleWebdav(request, env);
      if (path === "/reader3/getWebdavFileList" && request.method === "GET") return webdavHandlers.handleGetWebdavFileList(request, env);
      if (path === "/reader3/getWebdavFile" && request.method === "GET") return webdavHandlers.handleGetWebdavFile(request, env);
      if (path === "/reader3/uploadFileToWebdav" && request.method === "POST") return webdavHandlers.handleUploadFileToWebdav(request, env);
      if (path === "/reader3/deleteWebdavFile" && request.method === "POST") return webdavHandlers.handleDeleteWebdavFile(request, env);
      if (path === "/reader3/deleteWebdavFileList" && request.method === "POST") return webdavHandlers.handleDeleteWebdavFileList(request, env);

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
      if (path === "/reader3/getAiBookMemory") return aiHandlers.handleGetAiBookMemory(request, env);
      if (path === "/reader3/saveAiBookMemory" && request.method === "POST") return aiHandlers.handleSaveAiBookMemory(request, env);
      if (path === "/reader3/deleteAiBookMemory" && request.method === "POST") return aiHandlers.handleDeleteAiBookMemory(request, env);
      if (path === "/reader3/getAiModelConfig") return documentHandlers.handleGetDocument(request, env, "ai-model-config.json");
      if (path === "/reader3/saveAiModelConfig" && request.method === "POST") return documentHandlers.handleSaveDocumentItem(request, env, "ai-model-config.json", ctx);
      if (path === "/reader3/aiProxy" && request.method === "POST") return aiHandlers.handleAiProxy(request, env);
      if (path === "/reader3/aiProxyImage" && request.method === "POST") return aiHandlers.handleAiProxyImage(request, env);

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

// === TEMP STUBS ===
const _stubHandler = (name: string) => (..._args: any[]) => ({ isSuccess: false, errorMsg: name + ' not implemented' });
const handleGetShelfBook: any = _stubHandler("handleGetShelfBook");
const handleGetBookInfo: any = _stubHandler("handleGetBookInfo");
const handleGetChapterList: any = _stubHandler("handleGetChapterList");
const handleSaveBookGroupId: any = _stubHandler("handleSaveBookGroupId");
const handleUploadFile: any = _stubHandler("handleUploadFile");
const handleDeleteFile: any = _stubHandler("handleDeleteFile");
// === END STUBS ===
