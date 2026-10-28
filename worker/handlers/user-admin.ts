import { jsonResponse } from "../http";
import { resolveUserNs, isAuthorizedAdmin } from "../auth";
import { randomString } from "../utils";
import * as cryptoUtils from "../crypto";
import { Env } from "../types";

async function handleChangePassword(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const { oldPassword, newPassword } = await request.json<any>();
  if (!newPassword || newPassword.length < 8) {
    return jsonResponse({ isSuccess: false, errorMsg: "新密码长度不能少于8位" });
  }

  const user = await env.DB.prepare(`SELECT password, salt FROM users WHERE username = ?1`).bind(userNs).first<any>();
  if (!user) return jsonResponse({ isSuccess: false, errorMsg: "用户不存在" });

  if (!(await cryptoUtils.verifyPassword(oldPassword, user.salt, user.password))) {
    return jsonResponse({ isSuccess: false, errorMsg: "原密码错误" });
  }

  const newSalt = randomString(8);
  const newEncrypted = await cryptoUtils.genSecurePassword(newPassword, newSalt);

  await env.DB.prepare(`UPDATE users SET password = ?1, salt = ?2 WHERE username = ?3`)
    .bind(newEncrypted, newSalt, userNs)
    .run();

  return jsonResponse({ isSuccess: true, data: "密码修改成功" });
}

async function handleGetUserList(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  if (!isAuthorizedAdmin(request, env)) {
    return jsonResponse({ isSuccess: false, errorMsg: "需要验证管理密码 (SecureKey)" });
  }

  const rows = await env.DB.prepare(
    `SELECT username, last_login_at, created_at, enable_webdav, enable_local_store, enable_ai_model, is_admin FROM users ORDER BY created_at ASC`
  ).all<any>();

  const list = (rows.results || []).map((r) => ({
    username: r.username,
    lastLoginAt: r.last_login_at || 0,
    createdAt: r.created_at || 0,
    enableWebdav: r.enable_webdav === 1,
    enableLocalStore: r.enable_local_store === 1,
    enableAiModel: r.enable_ai_model === 1,
    isAdmin: r.is_admin === 1,
  }));

  return jsonResponse({ isSuccess: true, data: list });
}

async function handleAddUser(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  if (!isAuthorizedAdmin(request, env)) {
    return jsonResponse({ isSuccess: false, errorMsg: "需要验证管理密码 (SecureKey)" });
  }

  const { username, password } = await request.json<any>();
  if (!username || !password || password.length < 8) {
    return jsonResponse({ isSuccess: false, errorMsg: "用户名与密码格式不符" });
  }

  const salt = randomString(8);
  const encrypted = await cryptoUtils.genSecurePassword(password, salt);
  const now = Math.floor(Date.now() / 1000);

  await env.DB.prepare(
    `INSERT INTO users (username, password, salt, token, last_login_at, created_at, enable_webdav, enable_local_store, enable_ai_model, is_admin)
     VALUES (?1, ?2, ?3, '', ?4, ?4, 1, 1, 1, 0)`
  ).bind(username, encrypted, salt, now).run();

  return handleGetUserList(request, env);
}

async function handleUpdateUser(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  if (!isAuthorizedAdmin(request, env)) {
    return jsonResponse({ isSuccess: false, errorMsg: "需要验证管理密码 (SecureKey)" });
  }

  const { username, enableWebdav, enableLocalStore, enableAiModel, isAdmin } = await request.json<any>();

  const user = await env.DB.prepare(`SELECT * FROM users WHERE username = ?1`).bind(username).first<any>();
  if (!user) return jsonResponse({ isSuccess: false, errorMsg: "用户不存在" });

  const newWebdav = enableWebdav !== undefined ? (enableWebdav ? 1 : 0) : user.enable_webdav;
  const newLocal = enableLocalStore !== undefined ? (enableLocalStore ? 1 : 0) : user.enable_local_store;
  const newAi = enableAiModel !== undefined ? (enableAiModel ? 1 : 0) : user.enable_ai_model;
  const newAdmin = isAdmin !== undefined ? (isAdmin ? 1 : 0) : user.is_admin;

  await env.DB.prepare(
    `UPDATE users SET enable_webdav = ?1, enable_local_store = ?2, enable_ai_model = ?3, is_admin = ?4 WHERE username = ?5`
  )
    .bind(newWebdav, newLocal, newAi, newAdmin, username)
    .run();

  return handleGetUserList(request, env);
}

async function handleDeleteUsers(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  if (!isAuthorizedAdmin(request, env)) {
    return jsonResponse({ isSuccess: false, errorMsg: "需要验证管理密码 (SecureKey)" });
  }

  const usernames = await request.json<string[]>();
  for (const u of usernames) {
    if (u !== userNs) {
      await env.DB.prepare(`DELETE FROM users WHERE username = ?1`).bind(u).run();
    }
  }

  return handleGetUserList(request, env);
}

async function handleResetPassword(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  if (!isAuthorizedAdmin(request, env)) {
    return jsonResponse({ isSuccess: false, errorMsg: "需要验证管理密码 (SecureKey)" });
  }

  const { username, password } = await request.json<any>();
  const salt = randomString(8);
  const encrypted = await cryptoUtils.genSecurePassword(password, salt);

  await env.DB.prepare(`UPDATE users SET password = ?1, salt = ?2 WHERE username = ?3`)
    .bind(encrypted, salt, username)
    .run();

  return jsonResponse({ isSuccess: true, data: "重置密码成功" });
}