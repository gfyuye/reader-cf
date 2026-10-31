import { jsonResponse } from "../http";
import { resolveUserNs, isAuthorizedAdmin } from "../auth";
import { getEnv } from "../env";
import { randomString } from "../utils";
import { pbkdf2Hash, genSecurePassword, verifyPassword } from "../crypto";
import { Env } from "../types";

export async function handleLogin(request: Request, env: Env): Promise<Response> {
  const body = await request.json<any>();
  const { username, password, isLogin, code } = body;

  if (!username || !password) {
    return jsonResponse({ isSuccess: false, errorMsg: "用户名和密码不能为空" });
  }

  // Rate limiting: max 5 login attempts per 15 minutes per IP+username
  const clientIp = request.headers.get("CF-Connecting-IP") || "unknown";
  const rateLimitKey = `${clientIp}:${username}`;
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS login_attempts (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       identifier TEXT NOT NULL,
       attempted_at INTEGER NOT NULL
     )`
  ).run();
  const fifteenMinAgo = Math.floor(Date.now() / 1000) - 15 * 60;
  const recentAttempts = await env.DB.prepare(
    `SELECT count(*) as cnt FROM login_attempts WHERE identifier = ?1 AND attempted_at > ?2`
  )
    .bind(rateLimitKey, fifteenMinAgo)
    .first<{ cnt: number }>();
  if ((recentAttempts?.cnt || 0) >= 5) {
    return jsonResponse({ isSuccess: false, errorMsg: "登录尝试过于频繁，请稍后再试" });
  }

  const existing = await env.DB.prepare(
    `SELECT username, password, salt, token, is_admin, enable_webdav, enable_local_store, enable_ai_model FROM users WHERE username = ?1`
  )
    .bind(username)
    .first<{
      username: string;
      password: string;
      salt: string;
      token: string;
      is_admin: number;
      enable_webdav: number;
      enable_local_store: number;
      enable_ai_model: number;
    }>();

  if (existing) {
    if (!isLogin) {
      return jsonResponse({ isSuccess: false, errorMsg: "用户名已被占用" });
    }
    if (!(await verifyPassword(password, existing.salt, existing.password))) {
      await env.DB.prepare(
        `INSERT INTO login_attempts (identifier, attempted_at) VALUES (?1, ?2)`
      )
        .bind(rateLimitKey, Math.floor(Date.now() / 1000))
        .run();
      return jsonResponse({ isSuccess: false, errorMsg: "密码错误" });
    }
    if (!existing.password.startsWith("$pbkdf2$")) {
      const rehashed = await genSecurePassword(password, existing.salt);
      await env.DB.prepare(`UPDATE users SET password = ?1 WHERE username = ?2`)
        .bind(rehashed, username)
        .run();
    }

    // Clear rate limit attempts on successful login
    await env.DB.prepare(`DELETE FROM login_attempts WHERE identifier = ?1`).bind(rateLimitKey).run();

    const token = `${Date.now()}_${randomString(16)}`;
    const expireAt = Math.floor(Date.now() / 1000) + 30 * 86400;
    await env.DB.prepare(
      `INSERT INTO user_sessions (username, token, expire_at) VALUES (?1, ?2, ?3)`
    )
      .bind(username, token, expireAt)
      .run();

    return jsonResponse({
      isSuccess: true,
      data: {
        username,
        accessToken: `${username}:${token}`,
        isAdmin: existing.is_admin === 1,
        enableWebdav: existing.enable_webdav === 1,
        enableLocalStore: existing.enable_local_store === 1,
        enableAiModel: existing.enable_ai_model === 1,
      },
    });
  }

  if (isLogin) {
    return jsonResponse({ isSuccess: false, errorMsg: "用户不存在" });
  }

  if (password.length < 8) {
    return jsonResponse({ isSuccess: false, errorMsg: "密码长度不能少于8位" });
  }

  const inviteCode = getEnv(env, "INVITE_CODE");
  if (inviteCode && inviteCode !== code) {
    return jsonResponse({ isSuccess: false, errorMsg: "邀请码无效" });
  }

  const userCount = await env.DB.prepare(`SELECT count(*) as cnt FROM users`).first<{ cnt: number }>();
  const userLimit = parseInt(getEnv(env, "USER_LIMIT", "50"), 10);
  if ((userCount?.cnt || 0) >= userLimit) {
    return jsonResponse({ isSuccess: false, errorMsg: "系统注册用户数已达上限" });
  }

  const isAdmin: number = 0;
  const salt = randomString(8);
  const encrypted = await genSecurePassword(password, salt);
  const now = Math.floor(Date.now() / 1000);

  await env.DB.prepare(
    `INSERT INTO users (username, password, salt, token, last_login_at, created_at, is_admin)
     VALUES (?1, ?2, ?3, '', ?4, ?4, ?5)`
  )
    .bind(username, encrypted, salt, now, isAdmin)
    .run();

  const token = `${Date.now()}_${randomString(16)}`;
  const expireAt = now + 30 * 86400;
  await env.DB.prepare(
    `INSERT INTO user_sessions (username, token, expire_at) VALUES (?1, ?2, ?3)`
  )
    .bind(username, token, expireAt)
    .run();

  return jsonResponse({
    isSuccess: true,
    data: {
      username,
      accessToken: `${username}:${token}`,
      isAdmin: isAdmin === 1,
      enableWebdav: true,
      enableLocalStore: true,
      enableAiModel: true,
    },
  });
}

export async function handleLogout(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (userNs) {
    const accessToken = request.headers.get("Authorization");
    if (accessToken && accessToken.includes(":")) {
      const parts = accessToken.split(":");
      if (parts.length >= 2) {
        const token = parts.slice(1).join(":");
        await env.DB.prepare(`DELETE FROM user_sessions WHERE username = ?1 AND token = ?2`)
          .bind(userNs, token)
          .run();
      }
    }
  }
  return jsonResponse({ isSuccess: true, data: "" });
}

export async function handleGetUserInfo(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  const adminAuthorized = isAuthorizedAdmin(request, env);
  const secure = !!getEnv(env, "SECURE_KEY");
  if (!userNs) {
    return jsonResponse({
      isSuccess: true,
      data: {
        username: null,
        isAdmin: false,
        enableWebdav: false,
        enableLocalStore: false,
        enableAiModel: false,
        secure,
        secureKeyRequired: secure,
        adminAuthorized: false,
      },
    });
  }
  const row = await env.DB.prepare(
    `SELECT username, is_admin, enable_webdav, enable_local_store, enable_ai_model FROM users WHERE username = ?1`
  )
    .bind(userNs)
    .first<any>();
  if (!row) {
    return jsonResponse({
      isSuccess: true,
      data: {
        username: null,
        isAdmin: false,
        enableWebdav: false,
        enableLocalStore: false,
        enableAiModel: false,
        secure,
        secureKeyRequired: secure,
        adminAuthorized: false,
      },
    });
  }
  return jsonResponse({
    isSuccess: true,
    data: {
      username: row.username,
      isAdmin: row.is_admin === 1,
      enableWebdav: row.enable_webdav === 1,
      enableLocalStore: row.enable_local_store === 1,
      enableAiModel: row.enable_ai_model === 1,
      secure,
      secureKeyRequired: secure,
      adminAuthorized,
    },
  });
}
