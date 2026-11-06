import { jsonResponse } from "../http";
import { resolveUserNs, isAuthorizedAdmin } from "../auth";
import { getEnv } from "../env";
import { Env } from "../types";
import * as documentHandlers from "../handlers/document";
import { triggerOnChangeSync } from "./webdav";
import { isSafeRemoteUrl, fetchTextWithEncoding } from "../utils";

export async function handleGetBookSources(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10), 200);
  const offset = Math.max(parseInt(url.searchParams.get("offset") || "0", 10), 0);

  const rows = await env.DB.prepare(
    `SELECT json FROM book_sources WHERE user_ns = ?1 ORDER BY updated_at DESC LIMIT ?2 OFFSET ?3`
  )
    .bind(userNs, limit, offset)
    .all<{ json: string }>();

  const totalRow = await env.DB.prepare(
    `SELECT count(*) as cnt FROM book_sources WHERE user_ns = ?1`
  )
    .bind(userNs)
    .first<{ cnt: number }>();

  const list = (rows.results || []).map((r) => {
    try {
      return JSON.parse(r.json);
    } catch {
      return null;
    }
  }).filter(Boolean);

  return jsonResponse({
    isSuccess: true,
    data: list,
    total: totalRow?.cnt || 0,
    count: list.length,
    offset,
    limit,
  });
}

export async function handleGetBookSource(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  let sourceUrl = "";
  if (request.method === "POST") {
    try {
      const body = await request.json<any>();
      sourceUrl = body.bookSourceUrl || body.url || "";
    } catch {}
  }
  if (!sourceUrl) {
    const url = new URL(request.url);
    sourceUrl = url.searchParams.get("url") || "";
  }

  const row = await env.DB.prepare(
    `SELECT json FROM book_sources WHERE user_ns = ?1 AND book_source_url = ?2`
  )
    .bind(userNs, sourceUrl)
    .first<{ json: string }>();

  if (!row) return jsonResponse({ isSuccess: false, errorMsg: "未找到该书源" });
  return jsonResponse({ isSuccess: true, data: JSON.parse(row.json) });
}

export async function handleSaveBookSource(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
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

export async function handleSaveBookSources(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
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

export async function handleDeleteBookSource(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
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

export async function handleDeleteBookSources(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
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

export async function handleDeleteAllBookSources(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  await env.DB.prepare(`DELETE FROM book_sources WHERE user_ns = ?1`).bind(userNs).run();
  triggerOnChangeSync(env, userNs, ctx);
  return jsonResponse({ isSuccess: true, data: "全部书源已清空" });
}

export async function handleReadRemoteSourceFile(request: Request, env: Env): Promise<Response> {
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

export const DEFAULT_USER_NS = "__default__";
const SYSTEM_NS = "system";
const DEFAULT_OWNER_KEY = "default_book_source_owner";

async function readDefaultOwner(env: Env): Promise<string | null> {
  const row = await env.DB.prepare(
    `SELECT json FROM json_documents WHERE namespace = ?1 AND name = ?2`
  )
    .bind(SYSTEM_NS, DEFAULT_OWNER_KEY)
    .first<{ json: string }>();
  if (!row) return null;
  try {
    return (JSON.parse(row.json) as { username?: string }).username || null;
  } catch {
    return null;
  }
}

export async function handleGetDefaultBookSourceOwner(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });
  const owner = await readDefaultOwner(env);
  return jsonResponse({ isSuccess: true, data: { username: owner || null } });
}

export async function handleSetAsDefaultBookSources(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });
  if (!(await isAuthorizedAdmin(request, env))) {
    return jsonResponse({ isSuccess: false, errorMsg: "需要验证管理密码 (SecureKey)" });
  }

  const { username } = await request.json<{ username: string }>();
  if (!username) return jsonResponse({ isSuccess: false, errorMsg: "缺少 username" });

  const target = await env.DB.prepare(`SELECT 1 FROM users WHERE username = ?1`).bind(username).first();
  if (!target) return jsonResponse({ isSuccess: false, errorMsg: "用户不存在" });

  const currentOwner = await readDefaultOwner(env);

  // Toggle：若已是默认，则取消；否则设置为该用户
  if (currentOwner === username) {
    await env.DB.prepare(`DELETE FROM json_documents WHERE namespace = ?1 AND name = ?2`)
      .bind(SYSTEM_NS, DEFAULT_OWNER_KEY)
      .run();
    await env.DB.prepare(`DELETE FROM book_sources WHERE user_ns = ?1`).bind(DEFAULT_USER_NS).run();
    return jsonResponse({ isSuccess: true, data: `已取消 ${username} 的默认书源设置` });
  }

  // 设置 owner 元数据
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `INSERT INTO json_documents (namespace, name, json, updated_at)
     VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT(namespace, name) DO UPDATE SET json=excluded.json, updated_at=excluded.updated_at`
  )
    .bind(SYSTEM_NS, DEFAULT_OWNER_KEY, JSON.stringify({ username }), now)
    .run();

  // 清空旧的默认模板，复制目标用户的书源到默认模板
  await env.DB.prepare(`DELETE FROM book_sources WHERE user_ns = ?1`).bind(DEFAULT_USER_NS).run();

  const rows = await env.DB.prepare(
    `SELECT book_source_url, book_source_name, json, updated_at FROM book_sources WHERE user_ns = ?1`
  )
    .bind(username)
    .all<any>();

  const stmts = (rows.results || []).map((r) =>
    env.DB.prepare(
      `INSERT INTO book_sources (user_ns, book_source_url, book_source_name, json, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT(user_ns, book_source_url) DO UPDATE SET
       book_source_name=excluded.book_source_name, json=excluded.json, updated_at=excluded.updated_at`
    ).bind(DEFAULT_USER_NS, r.book_source_url, r.book_source_name, r.json, now)
  );

  for (let i = 0; i < stmts.length; i += 50) {
    await env.DB.batch(stmts.slice(i, i + 50));
  }

  return jsonResponse({ isSuccess: true, data: `已将 ${username} 的书源设为默认书源 (${stmts.length} 项)` });
}

// ==========================================
// 书源测试 / 登录 / 代理 / 导入
// ==========================================

export async function handleTestBookSources(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const body = await request.json<{
    bookSourceUrls?: string[];
    keyword?: string;
    markInvalid?: boolean;
    concurrent?: number;
  }>();
  const urls = (body?.bookSourceUrls || []).filter(Boolean);
  if (!urls.length) {
    return jsonResponse({ isSuccess: false, errorMsg: "没有书源可测试" });
  }

  const keyword = body?.keyword || "";
  const markInvalid = body?.markInvalid === true;
  const concurrent = Math.min(Math.max(body?.concurrent || 6, 1), 20);

  const results: any[] = [];
  let valid = 0;
  let invalid = 0;
  let markedInvalid = 0;

  const testOne = async (sourceUrl: string) => {
    const row = await env.DB.prepare(
      `SELECT json FROM book_sources WHERE user_ns = ?1 AND book_source_url = ?2`
    )
      .bind(userNs, sourceUrl)
      .first<{ json: string }>();
    if (!row) return;
    let source: any;
    try {
      source = JSON.parse(row.json);
    } catch {
      return;
    }

    const result: any = {
      bookSourceName: source.bookSourceName,
      bookSourceUrl: source.bookSourceUrl,
      valid: false,
      searchOk: false,
      exploreOk: false,
      keyword,
      markedInvalid: false,
    };

    const testUrl = (source.exploreUrl || source.searchUrl || "").replace("{keyword}", encodeURIComponent(keyword || "test"));
    if (!testUrl) {
      result.valid = false;
      invalid++;
      results.push(result);
      return;
    }

    try {
      if (!isSafeRemoteUrl(testUrl)) throw new Error("受限制的 URL");
      const resp = await fetch(testUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
      });
      const ok = resp.status >= 200 && resp.status < 400;
      result.searchOk = ok;
      result.exploreOk = ok;
      result.valid = ok;
      if (ok) valid++;
      else invalid++;
    } catch (err: any) {
      result.searchError = err.message;
      result.exploreError = err.message;
      result.valid = false;
      invalid++;
    }

    if (markInvalid && !result.valid) {
      try {
        await env.DB.prepare(
          `UPDATE book_sources SET json = ?1 WHERE user_ns = ?2 AND book_source_url = ?3`
        ).bind(
          JSON.stringify({ ...source, enabled: false }),
          userNs,
          sourceUrl
        ).run();
        result.markedInvalid = true;
        markedInvalid++;
      } catch {}
    }
    results.push(result);
  };

  // 分批并发测试
  for (let i = 0; i < urls.length; i += concurrent) {
    const batch = urls.slice(i, i + concurrent);
    await Promise.all(batch.map(testOne));
  }

  return jsonResponse({
    isSuccess: true,
    data: {
      total: urls.length,
      valid,
      invalid,
      markedInvalid,
      results,
    },
  });
}

export async function handleGetInvalidBookSources(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const rows = await env.DB.prepare(
    `SELECT json FROM book_sources WHERE user_ns = ?1 AND (json LIKE '%"enabled":false%' OR json LIKE '%"enabled": false%')`
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

export async function handleDeleteInvalidBookSources(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const before = await env.DB.prepare(
    `SELECT count(*) as cnt FROM book_sources WHERE user_ns = ?1 AND (json LIKE '%"enabled":false%' OR json LIKE '%"enabled": false%)`
  )
    .bind(userNs)
    .first<{ cnt: number }>();

  await env.DB.prepare(
    `DELETE FROM book_sources WHERE user_ns = ?1 AND (json LIKE '%"enabled":false%' OR json LIKE '%"enabled": false%)`
  )
    .bind(userNs)
    .run();

  triggerOnChangeSync(env, userNs, ctx);
  return jsonResponse({ isSuccess: true, data: { deleted: before?.cnt || 0 } });
}

export async function handleLoginBookSource(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const body = await request.json<{ bookSourceUrl: string }>();
  const sourceUrl = body?.bookSourceUrl || "";
  if (!sourceUrl) {
    return jsonResponse({ isSuccess: false, errorMsg: "缺少 bookSourceUrl" });
  }

  const row = await env.DB.prepare(
    `SELECT json FROM book_sources WHERE user_ns = ?1 AND book_source_url = ?2`
  )
    .bind(userNs, sourceUrl)
    .first<{ json: string }>();
  if (!row) return jsonResponse({ isSuccess: false, errorMsg: "未找到该书源" });

  let source: any;
  try {
    source = JSON.parse(row.json);
  } catch {
    return jsonResponse({ isSuccess: false, errorMsg: "书源数据损坏" });
  }

  const loginUrl = source.loginUrl;
  if (!loginUrl) {
    return jsonResponse({ isSuccess: false, errorMsg: "当前书源未配置 loginUrl" });
  }

  if (!isSafeRemoteUrl(loginUrl)) {
    return jsonResponse({ isSuccess: false, errorMsg: "受限制的登录 URL" });
  }

  try {
    const resp = await fetch(loginUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
    });
    const status = resp.status;
    const text = await fetchTextWithEncoding(resp);
    const checkResult = text.slice(0, 200);
    const bodyPreview = text.slice(0, 500);
    const bodyHtml = text.slice(0, 2000);

    return jsonResponse({
      isSuccess: true,
      data: {
        success: status >= 200 && status < 400,
        status,
        url: loginUrl,
        checkResult,
        bodyPreview,
        bodyHtml,
      },
    });
  } catch (err: any) {
    return jsonResponse({
      isSuccess: true,
      data: {
        success: false,
        status: 0,
        url: loginUrl,
        checkResult: err.message,
        bodyPreview: "",
        bodyHtml: "",
      },
    });
  }
}

export async function handleReadSourceFile(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const formData = await request.formData();
  const file = formData.get("file") as unknown as File | null;
  if (!file) return jsonResponse({ isSuccess: false, errorMsg: "缺少文件" });

  const text = await file.text();
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    return jsonResponse({ isSuccess: false, errorMsg: "文件不是有效的 JSON" });
  }

  const sources = Array.isArray(parsed) ? parsed : [parsed];
  const validSources = sources.filter((s: any) => s && s.bookSourceUrl && s.bookSourceName);

  return jsonResponse({ isSuccess: true, data: validSources });
}

export async function handleBookSourceProxy(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const targetUrl = url.searchParams.get("url") || "";
  const bookSourceUrl = url.searchParams.get("bookSourceUrl") || "";

  if (!targetUrl || !isSafeRemoteUrl(targetUrl)) {
    return jsonResponse({ isSuccess: false, errorMsg: "无效或受限制的目标 URL" });
  }

  try {
    const headers: Record<string, string> = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    };
    if (bookSourceUrl) {
      try {
        const parsedSource = new URL(bookSourceUrl);
        headers["Referer"] = `${parsedSource.protocol}//${parsedSource.host}`;
      } catch {}
    }
    const resp = await fetch(targetUrl, { headers });
    const contentType = resp.headers.get("content-type") || "";
    const body = await resp.arrayBuffer();

    return new Response(body, {
      status: resp.status,
      headers: {
        "content-type": contentType,
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "*",
      },
    });
  } catch (err: any) {
    return jsonResponse({ isSuccess: false, errorMsg: `代理请求失败：${err.message}` });
  }
}
