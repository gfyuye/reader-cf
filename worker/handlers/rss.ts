import { jsonResponse } from "../http";
import { resolveUserNs } from "../auth";
import { getEnv } from "../env";
import { Env } from "../types";
import * as documentHandlers from "../handlers/document";
import { isSafeRemoteUrl, fetchTextWithEncoding } from "../utils";
import { parseContentWithRules } from "../legado-engine";

export async function handleGetRssArticles(request: Request, env: Env): Promise<Response> {
  try {
    const userNs = await resolveUserNs(request, env);
    if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

    const sources = await documentHandlers.getDocument(env, userNs, "rssSource.json");
    const list: any[] = Array.isArray(sources) ? sources : [];

    const articles: any[] = [];
    const now = Date.now();

    for (const src of list) {
      const url = src.url || src.bookSourceUrl || src.rssUrl;
      if (!url || !isSafeRemoteUrl(url)) continue;

      try {
        const resp = await fetch(url, {
          headers: { "User-Agent": "Mozilla/5.0 (compatible; ReaderRSS/1.0)" },
        });
        if (!resp.ok) continue;
        const raw = await fetchTextWithEncoding(resp);

        // Try RSS/XML parsing
        const itemRegex = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
        let itemMatch;
        while ((itemMatch = itemRegex.exec(raw)) !== null) {
          const block = itemMatch[1];
          const titleMatch = block.match(/<title[^>]*>([^<]*)<\/title>/i);
          const linkMatch = block.match(/<link[^>]*>([^<]*)<\/link>/i);
          const descMatch = block.match(/<description[^>]*>([\s\S]*?)<\/description>/i);
          const pubDateMatch = block.match(/<pubDate[^>]*>([^<]*)<\/pubDate>/i);
          const title = titleMatch ? titleMatch[1].trim() : "";
          const link = linkMatch ? linkMatch[1].trim() : "";
          const description = descMatch ? descMatch[1].replace(/<[^>]+>/g, "").trim() : "";
          const pubDate = pubDateMatch ? pubDateMatch[1].trim() : "";

          if (title && link) {
            articles.push({
              title,
              link,
              description,
              pubDate,
              sourceName: src.name || src.bookSourceName || "RSS",
              sourceUrl: url,
              fetchedAt: now,
            });
          }
        }
      } catch {}
    }

    return jsonResponse({ isSuccess: true, data: articles });
  } catch (err: any) {
    return jsonResponse({ isSuccess: false, errorMsg: err.message });
  }
}

export async function handleGetRssContent(request: Request, env: Env): Promise<Response> {
  try {
    const userNs = await resolveUserNs(request, env);
    if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

    const url = new URL(request.url);
    const articleUrl = url.searchParams.get("url") || "";
    if (!articleUrl || !isSafeRemoteUrl(articleUrl)) {
      return jsonResponse({ isSuccess: false, errorMsg: "无效或受限制的文章 URL" });
    }

    // 查找对应的 RSS 源以获取解析规则
    const sources = await documentHandlers.getDocument(env, userNs, "rssSource.json");
    const list: any[] = Array.isArray(sources) ? sources : [];
    let source: any = null;
    for (const s of list) {
      const sUrl = s.url || s.bookSourceUrl || s.rssUrl;
      if (sUrl === articleUrl || articleUrl.startsWith(sUrl)) {
        source = s;
        break;
      }
    }

    try {
      const resp = await fetch(articleUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; ReaderRSS/1.0)" },
      });
      if (!resp.ok) {
        return jsonResponse({ isSuccess: false, errorMsg: `源站返回 HTTP ${resp.status}` });
      }
      const raw = await fetchTextWithEncoding(resp);

      // Try rule-based content extraction using Legado Engine
      if (source?.ruleContent?.content) {
        try {
          const ruleBody = await parseContentWithRules(raw, source, articleUrl);
          if (ruleBody && ruleBody.trim().length > 0) {
            return jsonResponse({ isSuccess: true, data: ruleBody });
          }
        } catch {}
      }

      // HTML content extraction fallback
      const contentMatch =
        raw.match(/<div[^>]+(?:id|class)=["'][^"']*(?:novelcontent|read-content|chapter-content|content|post-content|entry-content)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i) ||
        raw.match(/<article[^>]*>([\s\S]*?)<\/article>/i);

      if (contentMatch) {
        return jsonResponse({ isSuccess: true, data: contentMatch[1] });
      }

      return jsonResponse({ isSuccess: true, data: raw });
    } catch (err: any) {
      return jsonResponse({ isSuccess: false, errorMsg: err.message || "获取文章正文失败" });
    }
  } catch (err: any) {
    return jsonResponse({ isSuccess: false, errorMsg: err.message });
  }
}
