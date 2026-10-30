import { jsonResponse, corsHeaders } from "./http";
import { Env } from "./types";
import * as authHandlers from "./handlers/auth";
import * as documentHandlers from "./handlers/document";
import * as userAdminHandlers from "./handlers/user-admin";

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

    // User Management
    if (path === "/reader3/changePassword" && request.method === "POST") return userAdminHandlers.handleChangePassword(request, env);
    if (path === "/reader3/getUserList") return userAdminHandlers.handleGetUserList(request, env);
    if (path === "/reader3/addUser" && request.method === "POST") return userAdminHandlers.handleAddUser(request, env);
    if (path === "/reader3/updateUser" && request.method === "POST") return userAdminHandlers.handleUpdateUser(request, env);
    if (path === "/reader3/deleteUsers" && request.method === "POST") return userAdminHandlers.handleDeleteUsers(request, env);
    if (path === "/reader3/resetPassword" && request.method === "POST") return userAdminHandlers.handleResetPassword(request, env);

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
