import { jsonResponse } from "../http";
import { resolveUserNs } from "../auth";
import { getEnv } from "../env";
import { Env } from "../types";

export async function handleGetBookContent(request: Request, env: Env): Promise<Response> {
  try {
    const userNs = await resolveUserNs(request, env);
    if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

    let chapterUrl = "";
    let bookUrl = "";
    let bookSourceUrl = "";
    let index = 0;

    const url = new URL(request.url);
    chapterUrl = url.searchParams.get("url") || url.searchParams.get("chapterUrl") || "";
    bookUrl = url.searchParams.get("bookUrl") || "";
    bookSourceUrl = url.searchParams.get("bookSourceUrl") || "";
    index = parseInt(url.searchParams.get("index") || "0", 10);

    if (request.method === "POST") {
      try {
        const body = await request.clone().json<any>();
        chapterUrl = body.chapterUrl || body.url || chapterUrl;
        bookUrl = body.bookUrl || body.url || bookUrl;
        bookSourceUrl = body.bookSourceUrl || body.origin || bookSourceUrl;
        if (body.index !== undefined) {
          index = parseInt(body.index, 10);
        }
      } catch {}
    }

  // Extract index from #anchor if present
  if (chapterUrl.includes("#")) {
    const parts = chapterUrl.split("#");
    const parsedIdx = parseInt(parts[1], 10);
    if (!isNaN(parsedIdx)) {
      index = parsedIdx;
    }
  }

  // 0. TXT Book
  if (bookUrl.startsWith("local-txt:") || chapterUrl.startsWith("local-txt:")) {
    const rawId = (bookUrl || chapterUrl).split(":")[1].split("#")[0];
    const text = await readTxtChapterText(rawId, index, env);
    return jsonResponse({ isSuccess: true, data: text });
  }

  // 1. EPUB Book
  if (bookUrl.startsWith("local-epub:") || chapterUrl.startsWith("local-epub:")) {
    const bookId = (bookUrl || chapterUrl).split(":")[1].split("#")[0];
    const html = await readEpubChapterHtml(bookId, index, env);
    return jsonResponse({ isSuccess: true, data: html });
  }

  // 2. PDF Book
  if (bookUrl.startsWith("local-pdf:") || chapterUrl.startsWith("local-pdf:")) {
    const bookId = (bookUrl || chapterUrl).split(":")[1].split("#")[0];
    const page = index >= 0 ? index + 1 : 1;
    const streamUrl = `/reader3/pdf/stream?bookId=${encodeURIComponent(bookId)}#page=${page}`;
    const html = `<div class="pdf-reader-frame-container" style="width: 100%; height: 85vh; min-height: 600px; display: flex; flex-direction: column;">
      <iframe src="${streamUrl}" style="width: 100%; height: 100%; flex: 1; border: none; border-radius: 8px; background: #fff;" allowfullscreen></iframe>
    </div>`;
    return jsonResponse({ isSuccess: true, data: html });
  }

  // 3. Web Novel (Direct fetch or Kitesurf)
  if (chapterUrl.startsWith("http://") || chapterUrl.startsWith("https://")) {
    if (!isSafeRemoteUrl(chapterUrl)) {
      return jsonResponse({ isSuccess: false, errorMsg: "禁止访问内网或本地地址 (SSRF 防御)" });
    }

    const isWebView = url.searchParams.get("webView") === "true";
    const cfAccountId = getEnv(env, "CF_ACCOUNT_ID");
    const cfApiToken = getEnv(env, "CF_API_TOKEN");
    const kitesurfEnabled = getEnv(env, "CF_KITESURF_ENABLED", "true") !== "false";
    const remoteWebview = getEnv(env, "REMOTE_WEBVIEW_API");
    const remoteWebviewKey = getEnv(env, "REMOTE_WEBVIEW_API_KEY");

    if (isWebView && cfAccountId && cfApiToken && kitesurfEnabled) {
      // 1. Try Kitesurf
      try {
        const kitesurfUrl = `https://api.cloudflare.com/client/v4/accounts/${cfAccountId}/browser-run/content?browser=kitesurf`;
        const kResp = await fetch(kitesurfUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${cfApiToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            url: chapterUrl,
            rejectResourceTypes: ["image", "media", "font"],
          }),
        });
        if (kResp.ok) {
          const html = await kResp.text();
          return jsonResponse({ isSuccess: true, data: html });
        }
      } catch (e) {
        // Fall through to backup
      }
    }

    // 2. Try Remote WebView API if webView was requested
    if (isWebView && remoteWebview) {
      try {
        const rResp = await fetch(`${remoteWebview.replace(/\/$/, "")}/render.html`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(remoteWebviewKey ? { Authorization: `Bearer ${remoteWebviewKey}` } : {}),
          },
          body: JSON.stringify({
            url: chapterUrl,
            http_method: "GET",
          }),
        });
        if (rResp.ok) {
          const html = await rResp.text();
          return jsonResponse({ isSuccess: true, data: html });
        }
      } catch (e) {
        // Fall through to direct fetch
      }
    }

    // 3. Direct HTTP fetch fallback
    let source: any = null;
    if (bookSourceUrl) {
      const sRow = await env.DB.prepare(
        `SELECT json FROM book_sources WHERE user_ns = ?1 AND book_source_url = ?2`
      ).bind(userNs, bookSourceUrl).first<{ json: string }>();
      if (sRow) {
        try { source = JSON.parse(sRow.json); } catch {}
      }
    }

    let reqUrl = chapterUrl;
    let fetchOpts: RequestInit = {
      headers: {},
    };
    if (chapterUrl.includes(",{") || chapterUrl.includes(", {")) {
      const idx = chapterUrl.indexOf(",{") !== -1 ? chapterUrl.indexOf(",{") : chapterUrl.indexOf(", {");
      try {
        const cfg = JSON.parse(chapterUrl.substring(idx + 1));
        reqUrl = chapterUrl.substring(0, idx).trim();
        if (cfg.method) fetchOpts.method = cfg.method.toUpperCase();
        if (cfg.headers) Object.assign(fetchOpts.headers as any, cfg.headers);
        if (cfg.body) {
          fetchOpts.body = typeof cfg.body === "string" ? cfg.body : JSON.stringify(cfg.body);
          if (typeof cfg.body !== "string") {
            (fetchOpts.headers as any)["Content-Type"] = "application/json";
          }
        }
      } catch {}
    }

    const dynamicHeaders = getDynamicHeaders(source, reqUrl);
    fetchOpts.headers = {
      ...dynamicHeaders,
      ...(fetchOpts.headers as Record<string, string>),
    };
    if (fetchOpts.body && !(fetchOpts.headers as any)["Content-Type"]) {
      (fetchOpts.headers as any)["Content-Type"] = "application/json";
    }

    try {
      const resp = await fetch(reqUrl, fetchOpts);
      if (!resp.ok) {
        return jsonResponse({
          isSuccess: false,
          errorMsg: `源站返回 HTTP ${resp.status} (${resp.statusText || "访问受限"})`,
        });
      }
      const raw = await fetchTextWithEncoding(resp);

      // Try rule-based content extraction using Legado Engine first
      if (source?.ruleContent?.content) {
        try {
          const ruleBody = await parseContentWithRules(raw, source, reqUrl);
          if (ruleBody && ruleBody.trim().length > 0) {
            return jsonResponse({ isSuccess: true, data: ruleBody });
          }
        } catch {}
      }

      if (raw.trim().startsWith("{") || raw.trim().startsWith("[")) {
        try {
          const j = JSON.parse(raw);
          let contentVal = "";
          const findContent = (obj: any) => {
            if (!obj || contentVal) return;
            if (typeof obj === "object") {
              for (const [k, v] of Object.entries(obj)) {
                if (k.toLowerCase() === "content" && typeof v === "string" && v.length > contentVal.length) {
                  contentVal = v;
                } else {
                  findContent(v);
                }
              }
            }
          };
          findContent(j);
          if (contentVal) {
            if (contentVal.length > 50 && /^[A-Za-z0-9+/=]+$/.test(contentVal)) {
              try {
                contentVal = await cryptoUtils.decryptAes128Cbc(contentVal, "Pxga!h*e4@T8xfOm", "E&z!EHGLd$fli*8R");
              } catch {}
            }
            return jsonResponse({ isSuccess: true, data: contentVal });
          }
        } catch {}
      }

      // HTML response: extract body content from standard content containers
      const contentMatch =
        raw.match(/<div[^>]+(?:id|class)=["'][^"']*(?:novelcontent|read-content|chapter-content|content)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i) ||
        raw.match(/<article[^>]*>([\s\S]*?)<\/article>/i);

      if (contentMatch) {
        return jsonResponse({ isSuccess: true, data: contentMatch[1] });
      }

      return jsonResponse({ isSuccess: true, data: raw });
    } catch (err: any) {
      return jsonResponse({ isSuccess: false, errorMsg: err.message || "获取章节正文失败" });
    }
  }

    return jsonResponse({ isSuccess: false, errorMsg: "未识别的书籍格式" });
  } catch (err: any) {
    console.error("handleGetBookContent error:", err);
    return jsonResponse({ isSuccess: false, errorMsg: err.message || "读取章节正文失败" });
  }
}
