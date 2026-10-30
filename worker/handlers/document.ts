import { jsonResponse } from "../http";
import { resolveUserNs } from "../auth";
import { Env } from "../types";

export async function getDocument(env: Env, namespace: string, name: string): Promise<any | null> {
  const row = await env.DB.prepare(`SELECT json FROM json_documents WHERE namespace = ?1 AND name = ?2`)
    .bind(namespace, name)
    .first<{ json: string }>();
  if (!row || !row.json) return null;
  try {
    return JSON.parse(row.json);
  } catch {
    return null;
  }
}

export async function saveDocument(env: Env, namespace: string, name: string, data: any): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `INSERT INTO json_documents (namespace, name, json, updated_at) VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT(namespace, name) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`
  )
    .bind(namespace, name, JSON.stringify(data), now)
    .run();
}

export async function deleteDocument(env: Env, namespace: string, name: string): Promise<void> {
  await env.DB.prepare(`DELETE FROM json_documents WHERE namespace = ?1 AND name = ?2`)
    .bind(namespace, name)
    .run();
}

export async function handleGetDocument(request: Request, env: Env, name: string): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });
  const data = await getDocument(env, userNs, name);
  return jsonResponse({ isSuccess: true, data: data || [] });
}

export async function handleSaveDocumentItem(request: Request, env: Env, name: string, ctx: ExecutionContext): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });
  const body = await request.json<any>();
  const list = (await getDocument(env, userNs, name)) || [];
  const items = Array.isArray(list) ? list : [];
  const existing = items.findIndex((it: any) => it && it.id && it.id === body.id);
  if (existing >= 0) {
    items[existing] = { ...items[existing], ...body };
  } else {
    items.push(body);
  }
  await saveDocument(env, userNs, name, items);
  return jsonResponse({ isSuccess: true, data: body });
}

export async function handleDeleteDocumentItem(request: Request, env: Env, name: string, ctx: ExecutionContext): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });
  const body = await request.json<any>();
  const list = (await getDocument(env, userNs, name)) || [];
  const items = Array.isArray(list) ? list : [];
  const filtered = items.filter((it: any) => !(it && it.id && body && it.id === body.id));
  await saveDocument(env, userNs, name, filtered);
  return jsonResponse({ isSuccess: true, data: "" });
}

export async function handleSaveDocumentItems(request: Request, env: Env, name: string, ctx: ExecutionContext): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });
  const body = await request.json<any>();
  const items = Array.isArray(body) ? body : body?.list || [];
  await saveDocument(env, userNs, name, items);
  return jsonResponse({ isSuccess: true, data: items });
}

export async function handleDeleteDocumentItems(request: Request, env: Env, name: string, ctx: ExecutionContext): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });
  const body = await request.json<any>();
  const list = (await getDocument(env, userNs, name)) || [];
  const items = Array.isArray(list) ? list : [];
  const ids = Array.isArray(body) ? body : body?.ids || [];
  const filtered = items.filter((it: any) => !(it && it.id && ids.includes(it.id)));
  await saveDocument(env, userNs, name, filtered);
  return jsonResponse({ isSuccess: true, data: "" });
}
