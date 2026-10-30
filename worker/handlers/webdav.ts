import { jsonResponse, corsHeaders } from "../http";
import { resolveUserNs } from "../auth";
import { getEnv } from "../env";
import { Env } from "../types";
import * as cryptoUtils from "../crypto";
import { isSafeRemoteUrl } from "../utils";
import * as documentHandlers from "../handlers/document";
import { createZipArchive } from "../handlers/epub-pdf-txt";

export async function resolveWebdavUser(request: Request, env: Env): Promise<string | null> {
  const auth = request.headers.get("Authorization") || "";
  if (!auth.toLowerCase().startsWith("basic ")) return null;
  const b64 = auth.substring(6).trim();
  let decoded = "";
  try {
    decoded = atob(b64);
  } catch {
    return null;
  }
  const [username, password] = decoded.split(":");
  if (!username || !password) return null;

  const user = await env.DB.prepare(
    `SELECT username, password, salt, enable_webdav FROM users WHERE username = ?1`
  )
    .bind(username)
    .first<{ username: string; password: string; salt: string; enable_webdav: number }>();

  if (!user || user.enable_webdav !== 1) return null;
  if (!(await cryptoUtils.verifyPassword(password, user.salt, user.password))) return null;
  return user.username;
}

export async function handleWebdav(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveWebdavUser(request, env);
  if (!userNs) {
    return new Response("Unauthorized", {
      status: 401,
      headers: {
        "WWW-Authenticate": 'Basic realm="reader-webdav"',
        ...corsHeaders(),
      },
    });
  }

  const url = new URL(request.url);
  const rawRelPath = url.pathname.replace(/^\/reader3\/webdav\/?/, "");
  if (rawRelPath.includes("..") || rawRelPath.includes("\\")) {
    return new Response("Forbidden", { status: 403, headers: corsHeaders() });
  }

  const cleanPath = rawRelPath.replace(/^\/+/, "");
  const r2Key = cleanPath ? `webdav/${userNs}/${cleanPath}` : `webdav/${userNs}/`;
  const method = request.method.toUpperCase();

  // 1. OPTIONS: Capability discovery
  if (method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: {
        DAV: "1, 2",
        Allow: "OPTIONS, GET, HEAD, POST, PUT, DELETE, PROPFIND, MKCOL, MOVE, COPY, LOCK, UNLOCK",
        ...corsHeaders(),
      },
    });
  }

  // 2. PROPFIND: Directory / File Property Discovery (XML Multi-Status)
  if (method === "PROPFIND") {
    const isRoot = !cleanPath || cleanPath === "";
    const prefix = isRoot ? `webdav/${userNs}/` : r2Key;
    const listed = await env.BUCKET.list({ prefix, delimiter: "/" });

    let xml = `<?xml version="1.0" encoding="utf-8"?><D:multistatus xmlns:D="DAV:">`;
    const hrefBase = `/reader3/webdav/${cleanPath ? cleanPath.replace(/\/$/, "") + "/" : ""}`;

    // Add current collection entry
    xml += `<D:response><D:href>/reader3/webdav/${cleanPath ? cleanPath : ""}</D:href><D:propstat><D:status>HTTP/1.1 200 OK</D:status><D:prop><D:resourcetype><D:collection/></D:resourcetype></D:prop></D:propstat></D:response>`;

    // Add subdirectories
    for (const delimitedPrefix of listed.delimitedPrefixes || []) {
      const subName = delimitedPrefix.replace(prefix, "").replace(/\/$/, "");
      if (!subName) continue;
      const subHref = `${hrefBase}${subName}/`;
      xml += `<D:response><D:href>${subHref}</D:href><D:propstat><D:status>HTTP/1.1 200 OK</D:status><D:prop><D:resourcetype><D:collection/></D:resourcetype></D:prop></D:propstat></D:response>`;
    }

    // Add files
    for (const obj of listed.objects || []) {
      const fileName = obj.key.replace(prefix, "");
      if (!fileName || fileName.includes("/")) continue;
      const fileHref = `${hrefBase}${fileName}`;
      const mod = Math.floor(obj.uploaded.getTime() / 1000);
      xml += `<D:response><D:href>${fileHref}</D:href><D:propstat><D:status>HTTP/1.1 200 OK</D:status><D:prop><D:getlastmodified>${mod}</D:getlastmodified><D:getcontentlength>${obj.size}</D:getcontentlength><D:resourcetype/></D:prop></D:propstat></D:response>`;
    }

    xml += `</D:multistatus>`;
    return new Response(xml, {
      status: 207,
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        ...corsHeaders(),
      },
    });
  }

  // 3. MKCOL: Create Directory
  if (method === "MKCOL") {
    await env.BUCKET.put(`${r2Key.replace(/\/$/, "")}/`, new Uint8Array(0));
    return new Response(null, { status: 201, headers: corsHeaders() });
  }

  // 4. PUT: Upload File
  if (method === "PUT") {
    const body = await request.arrayBuffer();
    await env.BUCKET.put(r2Key, body, {
      httpMetadata: { contentType: request.headers.get("Content-Type") || "application/octet-stream" },
    });

    // Bridge Legado WebDAV sync to D1 database for real-time progress & source synchronization
    const baseDocName = cleanPath.split("/").pop() || "";
    if (
      baseDocName === "bookshelf.json" ||
      baseDocName === "bookSource.json" ||
      baseDocName === "bookmark.json" ||
      baseDocName === "replaceRule.json"
    ) {
      try {
        const text = new TextDecoder().decode(body);
        const data = JSON.parse(text);
        if (baseDocName === "bookshelf.json" && Array.isArray(data)) {
          await documentHandlers.saveDocument(env, userNs, "bookshelf.json", data);
        } else if (baseDocName === "bookSource.json" && Array.isArray(data)) {
          const now = Math.floor(Date.now() / 1000);
          const stmts = data.filter((s: any) => s && s.bookSourceUrl).map((s: any) =>
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
        } else {
          await documentHandlers.saveDocument(env, userNs, baseDocName, data);
        }
      } catch (e) {
        console.error("WebDAV to D1 bridge error:", e);
      }
    }

    return new Response(null, { status: 201, headers: corsHeaders() });
  }

  // 5. GET / HEAD: Download File
  if (method === "GET" || method === "HEAD") {
    const baseDocName = cleanPath.split("/").pop() || "";
    if (
      baseDocName === "bookshelf.json" ||
      baseDocName === "bookmark.json" ||
      baseDocName === "replaceRule.json"
    ) {
      const doc = await documentHandlers.getDocument(env, userNs, baseDocName);
      if (doc) {
        const jsonText = JSON.stringify(doc, null, 2);
        const bytes = new TextEncoder().encode(jsonText);
        return new Response(method === "HEAD" ? null : bytes, {
          status: 200,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Content-Length": bytes.length.toString(),
            ...corsHeaders(),
          },
        });
      }
    }

    const obj = await env.BUCKET.get(r2Key);
    if (!obj) return new Response("Not Found", { status: 404, headers: corsHeaders() });
    const headers = new Headers(corsHeaders());
    headers.set("Content-Type", obj.httpMetadata?.contentType || "application/octet-stream");
    headers.set("Content-Length", obj.size.toString());
    return new Response(method === "HEAD" ? null : obj.body, { status: 200, headers });
  }

  // MOVE: Move/Rename file in R2
  if (method === "MOVE") {
    const destination = request.headers.get("Destination") || "";
    const destMatch = destination.match(/\/reader3\/webdav\/?(.*)/);
    if (!destMatch) return new Response("Bad Destination", { status: 400, headers: corsHeaders() });
    const targetClean = destMatch[1].replace(/^\/+/, "");
    const targetKey = `webdav/${userNs}/${targetClean}`;

    const sourceObj = await env.BUCKET.get(r2Key);
    if (!sourceObj) return new Response("Not Found", { status: 404, headers: corsHeaders() });

    await env.BUCKET.put(targetKey, sourceObj.body, {
      httpMetadata: sourceObj.httpMetadata,
    });
    await env.BUCKET.delete(r2Key);
    return new Response(null, { status: 201, headers: corsHeaders() });
  }

  // 6. DELETE: Remove File or Directory
  if (method === "DELETE") {
    await env.BUCKET.delete(r2Key);
    const listed = await env.BUCKET.list({ prefix: `${r2Key}/` });
    for (const obj of listed.objects || []) {
      await env.BUCKET.delete(obj.key);
    }
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  // 7. LOCK / UNLOCK: Virtual lock for client concurrency
  if (method === "LOCK") {
    const lockToken = `urn:uuid:${crypto.randomUUID()}`;
    const lockXml = `<?xml version="1.0" encoding="utf-8"?><D:prop xmlns:D="DAV:"><D:lockdiscovery><D:activelock><D:locktype><write/></D:locktype><D:lockscope><exclusive/></D:lockscope><D:locktoken><D:href>${lockToken}</D:href></D:locktoken><D:timeout>Second-3600</D:timeout></D:activelock></D:lockdiscovery></D:prop>`;
    return new Response(lockXml, {
      status: 200,
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Lock-Token": `<${lockToken}>`,
        ...corsHeaders(),
      },
    });
  }

  if (method === "UNLOCK") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  return new Response("Method Not Allowed", { status: 405, headers: corsHeaders() });
}

// ==========================================
// 12. Remote WebDAV Sync Handlers & Engine
// ==========================================

export async function handleGetRemoteWebdav(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const row = await env.DB.prepare(
    `SELECT server_url, webdav_user, webdav_password, enabled, sync_on_change, sync_interval_mins, last_sync_at, last_sync_status, last_sync_error FROM user_remote_webdav WHERE username = ?1`
  )
    .bind(userNs)
    .first<{
      server_url: string;
      webdav_user: string;
      webdav_password: string;
      enabled: number;
      sync_on_change: number;
      sync_interval_mins: number;
      last_sync_at: number;
      last_sync_status: string;
      last_sync_error: string | null;
    }>();

  if (!row) {
    return jsonResponse({
      isSuccess: true,
      data: {
        enabled: false,
        serverUrl: "",
        webdavUser: "",
        hasPassword: false,
        syncOnChange: true,
        syncIntervalMins: 5,
        lastSyncAt: 0,
        lastSyncStatus: "",
        lastSyncError: null,
      },
    });
  }

  return jsonResponse({
    isSuccess: true,
    data: {
      enabled: row.enabled === 1,
      serverUrl: row.server_url,
      webdavUser: row.webdav_user,
      hasPassword: !!row.webdav_password,
      syncOnChange: row.sync_on_change === 1,
      syncIntervalMins: row.sync_interval_mins || 5,
      lastSyncAt: row.last_sync_at || 0,
      lastSyncStatus: row.last_sync_status || "",
      lastSyncError: row.last_sync_error,
    },
  });
}

export async function handleSaveRemoteWebdav(request: Request, env: Env): Promise<Response> {
  try {
    const userNs = await resolveUserNs(request, env);
    if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

    const body = await request.json<any>();
    const { enabled, serverUrl, webdavUser, webdavPassword, syncOnChange, syncIntervalMins } = body;

    const now = Math.floor(Date.now() / 1000);
    const enabledInt = enabled ? 1 : 0;
    const syncOnChangeInt = syncOnChange ? 1 : 0;
    const interval = parseInt(syncIntervalMins || "5", 10) || 5;

    await env.DB.prepare(
      `INSERT OR IGNORE INTO users (username, password, salt, is_admin, enable_webdav, created_at)
       VALUES (?1, '', '', 1, 1, ?2)`
    ).bind(userNs, now).run();

    const existing = await env.DB.prepare(
      `SELECT webdav_password FROM user_remote_webdav WHERE username = ?1`
    )
      .bind(userNs)
      .first<{ webdav_password: string }>();

    let passwordToSave = existing?.webdav_password || "";
    if (webdavPassword && webdavPassword !== "******") {
      passwordToSave = webdavPassword;
    }
    // HIGH-7: Encrypt WebDAV password before storage
    const encKey = getEnv(env, "SECURE_KEY") ? getEnv(env, "SECURE_KEY").substring(0,16).padEnd(16,"0") : null;
    if (encKey && passwordToSave) {
      try {
        passwordToSave = await cryptoUtils.encryptAes128Cbc(passwordToSave, encKey);
      } catch {
        // Best-effort encryption; store as-is if it fails
      }
    }

    await env.DB.prepare(
      `INSERT INTO user_remote_webdav (username, enabled, server_url, webdav_user, webdav_password, sync_on_change, sync_interval_mins, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
       ON CONFLICT(username) DO UPDATE SET
         enabled = excluded.enabled,
         server_url = excluded.server_url,
         webdav_user = excluded.webdav_user,
         webdav_password = excluded.webdav_password,
         sync_on_change = excluded.sync_on_change,
         sync_interval_mins = excluded.sync_interval_mins,
         updated_at = excluded.updated_at`
    )
      .bind(userNs, enabledInt, serverUrl || "", webdavUser || "", passwordToSave, syncOnChangeInt, interval, now)
      .run();

    return jsonResponse({ isSuccess: true, data: "配置保存成功" });
  } catch (err: any) {
    console.error("handleSaveRemoteWebdav error:", err);
    return jsonResponse({ isSuccess: false, errorMsg: err.message || "保存配置失败" });
  }
}

export async function handleTestRemoteWebdav(request: Request, env: Env): Promise<Response> {
  try {
    const userNs = await resolveUserNs(request, env);
    if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

    const body = await request.json<any>();
    let { serverUrl, webdavUser, webdavPassword } = body;

    if (webdavPassword === "******") {
      const existing = await env.DB.prepare(
        `SELECT webdav_password FROM user_remote_webdav WHERE username = ?1`
      ).bind(userNs).first<{ webdav_password: string }>();
      webdavPassword = existing?.webdav_password || "";
    }
    // HIGH-7: Decrypt stored WebDAV password before use
    const encKey = getEnv(env, "SECURE_KEY") ? getEnv(env, "SECURE_KEY").substring(0,16).padEnd(16,"0") : null;
    if (encKey && webdavPassword) {
      webdavPassword = await cryptoUtils.decryptWebdavPassword(webdavPassword, encKey);
    }

    if (!serverUrl || !webdavUser || !webdavPassword) {
      return jsonResponse({ isSuccess: false, errorMsg: "请填写完整 WebDAV 地址、用户名和密码" });
    }

    if (!isSafeRemoteUrl(serverUrl)) {
      return jsonResponse({ isSuccess: false, errorMsg: "WebDAV 地址不合法或指向受限网络" });
    }

    const authHeader = `Basic ${btoa(webdavUser + ":" + webdavPassword)}`;
    const cleanUrl = serverUrl.replace(/\/$/, "");

    const resp = await fetch(cleanUrl, {
      method: "PROPFIND",
      headers: {
        Authorization: authHeader,
        Depth: "0",
      },
      signal: AbortSignal.timeout(8000),
    });

    if (resp.ok || resp.status === 207) {
      return jsonResponse({ isSuccess: true, data: "连接成功！WebDAV 服务正常响应。" });
    } else {
      return jsonResponse({ isSuccess: false, errorMsg: `连接响应异常 (HTTP ${resp.status}): 请检查路径与账号权限` });
    }
  } catch (err: any) {
    return jsonResponse({ isSuccess: false, errorMsg: err.message || "测试连接失败" });
  }
}

export async function handleSyncRemoteWebdavNow(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const res = await syncUserToRemoteWebdav(env, userNs);
  if (res.success) {
    return jsonResponse({ isSuccess: true, data: "同步成功" });
  } else {
    return jsonResponse({ isSuccess: false, errorMsg: res.error || "同步失败" });
  }
}

export function triggerOnChangeSync(env: Env, userNs: string, ctx: ExecutionContext): void {
  ctx.waitUntil(
    (async () => {
      try {
        const row = await env.DB.prepare(
          `SELECT enabled, sync_on_change, last_sync_at FROM user_remote_webdav WHERE username = ?1`
        )
          .bind(userNs)
          .first<{ enabled: number; sync_on_change: number; last_sync_at: number }>();

        if (row && row.enabled === 1 && row.sync_on_change === 1) {
          const now = Math.floor(Date.now() / 1000);
          if (now - (row.last_sync_at || 0) >= 30) {
            await syncUserToRemoteWebdav(env, userNs);
          }
        }
      } catch (e) {
        console.error("OnChange sync error:", e);
      }
    })()
  );
}

export async function handleScheduledSync(env: Env): Promise<void> {
  try {
    const rows = await env.DB.prepare(
      `SELECT username, last_sync_at, sync_interval_mins FROM user_remote_webdav WHERE enabled = 1`
    ).all<{ username: string; last_sync_at: number; sync_interval_mins: number }>();

    const now = Math.floor(Date.now() / 1000);
    for (const r of rows.results || []) {
      const intervalSecs = (r.sync_interval_mins || 5) * 60;
      if (now - (r.last_sync_at || 0) >= intervalSecs) {
        await syncUserToRemoteWebdav(env, r.username);
      }
    }
  } catch (e) {
    console.error("Scheduled sync error:", e);
  }
}

export async function remoteWebdavEnsureDir(baseUrl: string, authHeader: string, relPath: string): Promise<void> {
  const parts = relPath.replace(/^\/+/, "").split("/").filter(Boolean);
  parts.pop(); // remove file name, keep directory path
  let current = baseUrl.replace(/\/$/, "");
  for (const seg of parts) {
    current += `/${seg}`;
    try {
      await fetch(current, {
        method: "MKCOL",
        headers: { Authorization: authHeader },
      });
    } catch {
      // ignore (MKCOL on existing collection returns 405)
    }
  }
}

export async function remoteWebdavPutFile(
  baseUrl: string,
  authHeader: string,
  relPath: string,
  body: Uint8Array | string,
  contentType: string = "application/octet-stream"
): Promise<boolean> {
  const cleanBase = baseUrl.replace(/\/$/, "");
  const cleanRel = relPath.replace(/^\/+/, "");
  await remoteWebdavEnsureDir(cleanBase, authHeader, cleanRel);

  const url = `${cleanBase}/${cleanRel}`;
  const resp = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: authHeader,
      "Content-Type": contentType,
    },
    body,
  });

  return resp.ok || resp.status === 201 || resp.status === 204;
}

export async function remoteWebdavGetFile(
  baseUrl: string,
  authHeader: string,
  relPath: string,
  range?: { offset: number; length?: number }
): Promise<Uint8Array | null> {
  const cleanBase = baseUrl.replace(/\/$/, "");
  const cleanRel = relPath.replace(/^\/+/, "");
  const url = `${cleanBase}/${cleanRel}`;

  const headers: Record<string, string> = {
    Authorization: authHeader,
  };

  if (range) {
    const end = range.length !== undefined ? range.offset + range.length - 1 : "";
    headers["Range"] = `bytes=${range.offset}-${end}`;
  }

  try {
    const resp = await fetch(url, { headers });
    if (resp.status === 404) return null;
    if (!resp.ok && resp.status !== 206) return null;
    return new Uint8Array(await resp.arrayBuffer());
  } catch {
    return null;
  }
}

export async function fallbackFetchFromRemoteWebdav(
  env: Env,
  relKey: string,
  range?: { offset: number; length?: number }
): Promise<Uint8Array | null> {
  try {
    const parts = relKey.replace(/^\/+/, "").split("/");
    const username = parts.length > 1 ? parts[1] : "";
    if (!username) return null;

    const config = await env.DB.prepare(
      `SELECT server_url, webdav_user, webdav_password, enabled FROM user_remote_webdav WHERE username = ?1`
    )
      .bind(username)
      .first<{ server_url: string; webdav_user: string; webdav_password: string; enabled: number }>();

    if (!config || config.enabled !== 1 || !config.server_url) return null;
    // HIGH-7: Decrypt stored WebDAV password before use
    const encKey = getEnv(env, "SECURE_KEY") ? getEnv(env, "SECURE_KEY").substring(0,16).padEnd(16,"0") : null;
    let decryptedPassword = config.webdav_password;
    if (encKey && decryptedPassword) {
      decryptedPassword = await cryptoUtils.decryptWebdavPassword(decryptedPassword, encKey);
    }
    const authHeader = `Basic ${btoa(config.webdav_user + ":" + decryptedPassword)}`;
    return await remoteWebdavGetFile(config.server_url, authHeader, relKey, range);
  } catch {
    return null;
  }
}

export async function syncUserToRemoteWebdav(env: Env, username: string): Promise<{ success: boolean; error?: string }> {
  try {
    const config = await env.DB.prepare(
      `SELECT server_url, webdav_user, webdav_password, enabled, last_sync_at FROM user_remote_webdav WHERE username = ?1`
    )
      .bind(username)
      .first<{ server_url: string; webdav_user: string; webdav_password: string; enabled: number; last_sync_at: number }>();

    if (!config || config.enabled !== 1 || !config.server_url) {
      return { success: false, error: "未启用远端同步或未配置地址" };
    }

    if (!isSafeRemoteUrl(config.server_url)) {
      throw new Error("远端 WebDAV 地址不合法或指向受限网络");
    }

    const cleanBase = config.server_url.replace(/\/$/, "");
    // HIGH-7: Decrypt stored WebDAV password before use
    const encKey = getEnv(env, "SECURE_KEY") ? getEnv(env, "SECURE_KEY").substring(0,16).padEnd(16,"0") : null;
    let decryptedPassword = config.webdav_password;
    if (encKey && decryptedPassword) {
      decryptedPassword = await cryptoUtils.decryptWebdavPassword(decryptedPassword, encKey);
    }
    const authHeader = `Basic ${btoa(config.webdav_user + ":" + decryptedPassword)}`;

    // 1. Gather all data for this user
    const [shelf, groups, sources, rss, bookmarks, rules] = await Promise.all([
      documentHandlers.getDocument(env, username, "bookshelf.json"),
      documentHandlers.getDocument(env, username, "bookGroup.json"),
      env.DB.prepare(`SELECT json FROM book_sources WHERE user_ns = ?1`).bind(username).all<{ json: string }>(),
      documentHandlers.getDocument(env, username, "rssSource.json"),
      documentHandlers.getDocument(env, username, "bookmark.json"),
      documentHandlers.getDocument(env, username, "replaceRule.json"),
    ]);

    const parsedSources = (sources.results || []).map((r) => {
      try { return JSON.parse(r.json); } catch { return null; }
    }).filter(Boolean);

    // ==============================================================
    // PART A: 1:1 Mirror User Personal Folder (data/, assets/, books/, webdav/)
    // Allows remote WebDAV to seamlessly replace local R2 when needed!
    // ==============================================================
    const jsonFiles: Record<string, string> = {
      [`data/${username}/bookshelf.json`]: JSON.stringify(shelf || [], null, 2),
      [`data/${username}/bookGroup.json`]: JSON.stringify(groups || [], null, 2),
      [`data/${username}/bookSource.json`]: JSON.stringify(parsedSources, null, 2),
      [`data/${username}/rssSource.json`]: JSON.stringify(rss || [], null, 2),
      [`data/${username}/bookmark.json`]: JSON.stringify(bookmarks || [], null, 2),
      [`data/${username}/replaceRule.json`]: JSON.stringify(rules || [], null, 2),
    };

    for (const [relPath, content] of Object.entries(jsonFiles)) {
      await remoteWebdavPutFile(cleanBase, authHeader, relPath, content, "application/json;charset=utf-8");
    }

    // Mirror user R2 storage objects (assets, epubs, pdfs, mobis, webdav)
    const prefixes = [
      `assets/${username}/`,
      `txts/${username}/`,
      `epubs/${username}/`,
      `pdfs/${username}/`,
      `mobis/${username}/`,
      `webdav/${username}/`,
    ];

    for (const prefix of prefixes) {
      const listed = await env.BUCKET.list({ prefix, limit: 100 });
      for (const obj of listed.objects || []) {
        if (obj.key.endsWith("/")) continue;
        const r2File = await env.BUCKET.get(obj.key);
        if (r2File) {
          const bodyBytes = new Uint8Array(await r2File.arrayBuffer());
          const ct = r2File.httpMetadata?.contentType || "application/octet-stream";
          await remoteWebdavPutFile(cleanBase, authHeader, obj.key, bodyBytes, ct);
        }
      }
    }

    // ==============================================================
    // PART B: Extra Full-Asset Standalone Backup ZIP Archive
    // (Contains: bookshelf + progress, bookSources, groups, rules, bookmarks, rss, readConfig)
    // ==============================================================
    const zipArchiveFiles: Record<string, string> = {
      "bookshelf.json": JSON.stringify(shelf || [], null, 2),
      "bookGroup.json": JSON.stringify(groups || [], null, 2),
      "bookSource.json": JSON.stringify(parsedSources, null, 2),
      "rssSource.json": JSON.stringify(rss || [], null, 2),
      "bookmark.json": JSON.stringify(bookmarks || [], null, 2),
      "replaceRule.json": JSON.stringify(rules || [], null, 2),
    };

    const zipBytes = await createZipArchive(zipArchiveFiles);

    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const timestampZip = `backups/backup-${username}-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}-${pad(now.getMinutes())}.zip`;
    const latestZip = `backups/backup-${username}-latest.zip`;

    await remoteWebdavPutFile(cleanBase, authHeader, timestampZip, zipBytes, "application/zip");
    await remoteWebdavPutFile(cleanBase, authHeader, latestZip, zipBytes, "application/zip");

    const nowTs = Math.floor(Date.now() / 1000);
    await env.DB.prepare(
      `UPDATE user_remote_webdav SET last_sync_at = ?1, last_sync_status = 'success', last_sync_error = NULL WHERE username = ?2`
    )
      .bind(nowTs, username)
      .run();

    return { success: true };
  } catch (err: any) {
    const nowTs = Math.floor(Date.now() / 1000);
    await env.DB.prepare(
      `UPDATE user_remote_webdav SET last_sync_at = ?1, last_sync_status = 'failed', last_sync_error = ?2 WHERE username = ?3`
    )
      .bind(nowTs, err.message, username)
      .run();
    return { success: false, error: err.message };
  }
}

// === ZIP Creation Helpers for Worker ===

const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[i] = c >>> 0;
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
