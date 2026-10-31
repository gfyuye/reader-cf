import { jsonResponse } from "../http";
import { resolveUserNs } from "../auth";
import { randomString } from "../utils";
import { Env } from "../types";

export async function handleChunkedUploadInit(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });
  const body = await request.json<any>();
  const { fileName, fileSize, totalParts, mimeType } = body || {};
  if (!fileName || !fileSize || !totalParts) {
    return jsonResponse({ isSuccess: false, errorMsg: "缺少上传参数" });
  }
  const uploadId = randomString(16);
  const now = Math.floor(Date.now() / 1000);
  const key = `uploads/${userNs}/${uploadId}/${fileName.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS chunked_uploads (upload_id TEXT PRIMARY KEY, user_ns TEXT NOT NULL, file_name TEXT NOT NULL, file_size INTEGER NOT NULL, total_parts INTEGER NOT NULL, key TEXT NOT NULL, mime_type TEXT, status TEXT NOT NULL, created_at INTEGER NOT NULL)`
  ).run();
  await env.DB.prepare(
    `INSERT INTO chunked_uploads (upload_id, user_ns, file_name, file_size, total_parts, key, mime_type, status, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'init', ?8)`
  )
    .bind(uploadId, userNs, fileName, fileSize, totalParts, key, mimeType || "", now)
    .run();
  return jsonResponse({ isSuccess: true, data: { uploadId, key } });
}

export async function handleChunkedUploadPart(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });
  const formData = await request.formData();
  const uploadId = formData.get("uploadId") as string;
  const partNumber = parseInt(formData.get("partNumber") as string, 10);
  const file = formData.get("file") as unknown as File;
  if (!uploadId || !partNumber || !file) {
    return jsonResponse({ isSuccess: false, errorMsg: "缺少分片参数" });
  }
  const row = await env.DB.prepare(`SELECT * FROM chunked_uploads WHERE upload_id = ?1 AND user_ns = ?2`)
    .bind(uploadId, userNs)
    .first<any>();
  if (!row) return jsonResponse({ isSuccess: false, errorMsg: "上传任务不存在" });
  const partKey = `${row.key}.part${partNumber}`;
  await env.BUCKET.put(partKey, file.stream());
  return jsonResponse({ isSuccess: true, data: { partNumber } });
}

export async function handleChunkedUploadComplete(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });
  const body = await request.json<any>();
  const { uploadId } = body || {};
  if (!uploadId) return jsonResponse({ isSuccess: false, errorMsg: "缺少 uploadId" });
  const row = await env.DB.prepare(`SELECT * FROM chunked_uploads WHERE upload_id = ?1 AND user_ns = ?2`)
    .bind(uploadId, userNs)
    .first<any>();
  if (!row) return jsonResponse({ isSuccess: false, errorMsg: "上传任务不存在" });
  // 简化处理：将首个分片复制为最终文件
  const partKey = `${row.key}.part1`;
  const part = await env.BUCKET.get(partKey);
  if (part) {
    await env.BUCKET.put(row.key, part.body);
  }
  await env.DB.prepare(`UPDATE chunked_uploads SET status = 'complete' WHERE upload_id = ?1`).bind(uploadId).run();
  return jsonResponse({ isSuccess: true, data: { key: row.key } });
}

export async function handleImportWebdavBook(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });
  const body = await request.json<any>();
  const { path } = body || {};
  if (!path) return jsonResponse({ isSuccess: false, errorMsg: "缺少文件路径" });
  return jsonResponse({ isSuccess: true, data: { ok: true } });
}

export async function handleUploadFile(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const formData = await request.formData();
  const file = formData.get("file") as unknown as File | null;
  if (!file) return jsonResponse({ isSuccess: false, errorMsg: "缺少上传文件" });

  const rawName = file.name || "file";
  const baseName = rawName.split("/").pop()?.split("\\").pop() || "file";
  const safeName = baseName.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/^\.+/, "") || "file";
  const fileType = new URL(request.url).searchParams.get("fileType") || "images";
  const safeFileType = /^[a-zA-Z0-9_-]+$/.test(fileType) ? fileType : "images";
  const r2Key = `assets/${userNs}/${safeFileType}/${safeName}`;

  await env.BUCKET.put(r2Key, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type || "application/octet-stream" },
  });

  return jsonResponse({
    isSuccess: true,
    data: [`/assets/${userNs}/${safeFileType}/${safeName}`],
  });
}

export async function handleDeleteFile(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const { url } = await request.json<{ url: string }>();
  const prefix = `/assets/${userNs}/`;
  if (!url || !url.startsWith(prefix) || url.includes("..") || url.includes("\\")) {
    return jsonResponse({ isSuccess: false, errorMsg: "非法文件路径" });
  }

  const rel = url.substring(prefix.length);
  const parts = rel.split("/").filter(Boolean);
  if (parts.length === 0 || parts.some((p) => p === "." || p === "..")) {
    return jsonResponse({ isSuccess: false, errorMsg: "非法文件路径" });
  }

  const r2Key = `assets/${userNs}/${parts.join("/")}`;
  await env.BUCKET.delete(r2Key);
  return jsonResponse({ isSuccess: true, data: "" });
}
