import { jsonResponse } from "../http";
import { resolveUserNs } from "../auth";
import { Env } from "../types";
import { triggerOnChangeSync } from "./webdav";

export async function handleChunkedUploadInit(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });
  const body = await request.json<any>();
  const { fileName, fileSize, totalParts, mimeType, target, path } = body || {};
  if (!fileName || !fileSize) {
    return jsonResponse({ isSuccess: false, errorMsg: "缺少上传参数" });
  }
  const cleanPath = (path || "/").replace(/^\/+/, "").replace(/\/$/, "");
  const safeName = fileName.replace(/[/\\?%*:|"<>]/g, "_");

  let r2Key = "";
  if (target === "webdav") {
    r2Key = cleanPath ? `webdav/${userNs}/${cleanPath}/${safeName}` : `webdav/${userNs}/${safeName}`;
  } else {
    r2Key = `webdav/${userNs}/book/${safeName}`;
  }

  // 上传前检查 R2 是否已有同名文件，避免覆盖并产生碎片
  try {
    await env.BUCKET.head(r2Key);
    return jsonResponse({ isSuccess: false, errorMsg: `文件已存在：《${safeName}》，请先删除或重命名` });
  } catch {
    // 文件不存在，继续上传
  }

  let contentType = mimeType || "application/octet-stream";
  const lower = safeName.toLowerCase();
  if (lower.endsWith(".epub")) contentType = "application/epub+zip";
  else if (lower.endsWith(".txt")) contentType = "text/plain; charset=utf-8";
  else if (lower.endsWith(".pdf")) contentType = "application/pdf";

  try {
    const mp = await env.BUCKET.createMultipartUpload(r2Key, {
      httpMetadata: { contentType },
    });
    return jsonResponse({
      isSuccess: true,
      data: {
        uploadId: mp.uploadId,
        key: mp.key,
        chunkSize: 10 * 1024 * 1024,
      },
    });
  } catch (err: any) {
    return jsonResponse({ isSuccess: false, errorMsg: err.message || "初始化分片上传失败" });
  }
}

export async function handleChunkedUploadPart(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const url = new URL(request.url);
  const uploadId = url.searchParams.get("uploadId") || request.headers.get("X-Upload-Id") || "";
  const key = url.searchParams.get("key") || request.headers.get("X-Key") || "";
  const partNumberStr = url.searchParams.get("partNumber") || request.headers.get("X-Part-Number") || "1";
  const partNumber = parseInt(partNumberStr, 10);

  if (!uploadId || !key || isNaN(partNumber) || partNumber < 1) {
    return jsonResponse({ isSuccess: false, errorMsg: "分片参数缺失" });
  }

  let partBytes: Uint8Array;
  const contentType = request.headers.get("Content-Type") || "";
  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    const fileEntry = formData.get("file");
    const file = fileEntry as unknown as File;
    if (!file || !(file instanceof File)) return jsonResponse({ isSuccess: false, errorMsg: "缺少分片数据" });
    partBytes = new Uint8Array(await file.arrayBuffer());
  } else {
    partBytes = new Uint8Array(await request.arrayBuffer());
  }

  try {
    const mp = env.BUCKET.resumeMultipartUpload(key, uploadId);
    const uploaded = await mp.uploadPart(partNumber, partBytes);
    return jsonResponse({
      isSuccess: true,
      data: {
        partNumber,
        etag: uploaded.etag,
      },
    });
  } catch (err: any) {
    return jsonResponse({ isSuccess: false, errorMsg: err.message || "上传分片失败" });
  }
}

export async function handleChunkedUploadComplete(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });
  const body = await request.json<any>();
  const { uploadId, key, parts, fileName, fileSize, target } = body;

  if (!uploadId || !key || !Array.isArray(parts)) {
    return jsonResponse({ isSuccess: false, errorMsg: "参数缺失" });
  }

  try {
    const mp = env.BUCKET.resumeMultipartUpload(key, uploadId);
    await mp.complete(parts);

    // 上传阶段：只负责文件合并和存储，不做书籍解析，不保存书架
    // 所有书籍解析由 handleImportWebdavBook 独立完成
    triggerOnChangeSync(env, userNs, ctx);
    return jsonResponse({
      isSuccess: true,
      data: { key, name: fileName, size: fileSize },
    });
  } catch (err: any) {
    return jsonResponse({ isSuccess: false, errorMsg: err.message || "合并分片失败" });
  }
}

export async function handleChunkedUploadAbort(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });
  const body = await request.json<any>();
  const { uploadId, key } = body || {};
  if (!uploadId || !key) {
    return jsonResponse({ isSuccess: false, errorMsg: "缺少上传参数" });
  }
  try {
    const mp = env.BUCKET.resumeMultipartUpload(key, uploadId);
    await mp.abort();
    return jsonResponse({ isSuccess: true, data: "" });
  } catch (err: any) {
    return jsonResponse({ isSuccess: false, errorMsg: err.message || "取消上传失败" });
  }
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
