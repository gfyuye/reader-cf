import { jsonResponse } from "../http";
import { resolveUserNs } from "../auth";
import { getEnv } from "../env";
import { Env } from "../types";
import * as documentHandlers from "../handlers/document";
import { triggerOnChangeSync } from "./webdav";
import { isSafeRemoteUrl } from "../utils";

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

// ==========================================
