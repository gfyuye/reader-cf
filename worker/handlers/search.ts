import { jsonResponse } from "../http";
import { resolveUserNs } from "../auth";
import { Env } from "../types";
import { md5Hex as md5 } from "../md5";
import { isSafeRemoteUrl } from "../utils";

export async function handleExploreBook(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const body = await request.json<any>().catch(() => ({}));
  const sourceUrl = body.bookSourceUrl || "";
  let targetUrl = (body.rule || body.url || "").trim();
  const page = parseInt(body.page || "1", 10) || 1;

  if (!targetUrl) return jsonResponse({ isSuccess: true, data: [] });

  targetUrl = targetUrl
    .replace(/\{\{page\}\}/g, String(page))
    .replace(/\$\{page\}/g, String(page))
    .replace(/\{\{page-1\}\}/g, String(page - 1))
    .replace(/\$\{page-1\}/g, String(page - 1));

  let sRow: any = null;
  if (sourceUrl) {
    sRow = await env.DB.prepare(
      `SELECT json FROM book_sources WHERE user_ns = ?1 AND book_source_url = ?2`
    )
      .bind(userNs, sourceUrl)
      .first<{ json: string }>();
  }

  let source: any = null;
  if (sRow) {
    try {
      source = JSON.parse(sRow.json);
    } catch {}
  }

  if (targetUrl.startsWith("/")) {
    targetUrl = `${source?.bookSourceUrl || ""}${targetUrl}`;
  }

  if (!isSafeRemoteUrl(targetUrl)) {
    return jsonResponse({ isSuccess: false, errorMsg: "禁止访问内网或本地地址 (SSRF 防御)" });
  }

  let fetchHeaders: Record<string, string> = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  };
  if (source?.header) {
    try {
      const parsedHdr = JSON.parse(source.header);
      Object.assign(fetchHeaders, parsedHdr);
    } catch {}
  }

  try {
    const resp = await fetch(targetUrl, {
      headers: fetchHeaders,
      signal: AbortSignal.timeout(10000),
    });
    const text = await resp.text();

    const books = extractExploreResults(text, source, targetUrl);
    return jsonResponse({ isSuccess: true, data: books });
  } catch (err: any) {
    return jsonResponse({ isSuccess: false, errorMsg: err.message || "探索失败" });
  }
}

function extractExploreResults(text: string, source: any, baseUrl: string): any[] {
  const books: any[] = [];
  try {
    if (text.trim().startsWith("{") || text.trim().startsWith("[")) {
      const data = JSON.parse(text);
      const list = Array.isArray(data) ? data : data.data?.list || data.list || data.data || [];
      if (Array.isArray(list)) {
        for (const item of list.slice(0, 30)) {
          const name = item.title || item.name || item.bookName;
          if (name) {
            let bookUrl = item.bookUrl || item.url || "";
            if (!bookUrl && item.bookId) {
              bookUrl = `${source?.bookSourceUrl || ""}/findChapterList?book_id=${item.bookId}`;
            }
            books.push({
              name,
              author: item.author || "未知作者",
              bookUrl: bookUrl || `${baseUrl}#${item.bookId || name}`,
              origin: source?.bookSourceUrl || baseUrl,
              originName: source?.bookSourceName || "书海来源",
              coverUrl: item.coverImg || item.cover || item.image || "",
              intro: item.desc || item.intro || "",
              kind: item.categoryName || item.category || "网络小说",
              wordCount: item.word || item.words_number || "",
            });
          }
        }
      }
    }
  } catch {}
  return books;
}

async function decodeXiaoXiao(contentB64: string): Promise<any> {
  const binaryString = atob(contentB64);
  const len = binaryString.length;
  const raw = new Uint8Array(len);
  for (let i = 0; i < len; i++) raw[i] = binaryString.charCodeAt(i);

  const datas = raw.subarray(16, len - 16);
  let kStr = "";
  for (let i = 0; i < 16; i++) kStr += String.fromCharCode(raw[i]);
  const kHashBuf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(kStr));
  const ks = new Uint8Array(kHashBuf);

  let iStr = "";
  for (let i = len - 16; i < len; i++) iStr += String.fromCharCode(raw[i]);
  const vHex = md5(iStr);
  const b1 = new TextEncoder().encode(iStr);
  const b2 = new TextEncoder().encode(vHex);

  const ivs = new Uint8Array(16);
  for (let idx = 0; idx < 16; idx++) {
    ivs[idx] = (b2[idx] ^ b1[idx]) ^ 0xff;
  }

  const aesKey = await crypto.subtle.importKey("raw", ks, { name: "AES-CBC" }, false, ["decrypt"]);
  const decryptedBuf = await crypto.subtle.decrypt({ name: "AES-CBC", iv: ivs }, aesKey, datas);
  const decText = new TextDecoder().decode(decryptedBuf);
  return JSON.parse(decText);
}

async function searchSingleSource(source: any, key: string, page: number, env: Env): Promise<any[]> {
  try {
    let rawUrl = (source.searchUrl || "").trim();
    if (!rawUrl) return [];

    let urlConfig: any = null;
    if (rawUrl.includes(",{") || rawUrl.includes(", {")) {
      const idx = rawUrl.indexOf(",{") !== -1 ? rawUrl.indexOf(",{") : rawUrl.indexOf(", {");
      try {
        urlConfig = JSON.parse(rawUrl.substring(idx + 1));
      } catch {}
      rawUrl = rawUrl.substring(0, idx).trim();
    }

    const encodedKey = encodeURIComponent(key);
    let targetUrl = rawUrl
      .replace(/\{\{[^}]*key[^}]*\}\}/gi, encodedKey)
      .replace(/\$\{key\}/g, encodedKey)
      .replace(/\{\{page\}\}/g, String(page))
      .replace(/\$\{page\}/g, String(page));

    if (targetUrl.startsWith("/")) {
      const baseOrigin = new URL(source.bookSourceUrl).origin;
      targetUrl = `${baseOrigin}${targetUrl}`;
    }

    if (!isSafeRemoteUrl(targetUrl)) return [];

    const headers: Record<string, string> = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    };

    if (source.header) {
      const hdr = String(source.header).trim();
      if (hdr.startsWith("@js:") || hdr.includes("java.md5Encode")) {
        try {
          const ts = Math.round(Date.now() / 1000);
          const pkgMatch = hdr.match(/package\s*=\s*["']([^"']+)["']/);
          const pkg = pkgMatch ? pkgMatch[1] : "com.xxyuedu.chasingbooks";
          const signStr = `${pkg}1${ts}vhjJVz1St6tK7!8n#B0MqRIuE2Dh7!C#`;
          const sign = md5(signStr);
          headers["pt"] = "1";
          headers["time"] = String(ts);
          headers["sign"] = sign;
          headers["package"] = pkg;
          headers["User-Agent"] = `Mozilla/5.0 (iPhone; CPU iPhone OS 7_1_2 like Mac OS X) AppleWebKit/537.51.2 (KHTML, like Gecko) Version/7.0 Mobile/11D167 Safari/9537.53_${pkg}`;
        } catch {}
      } else {
        try {
          Object.assign(headers, JSON.parse(source.header));
        } catch {}
      }
    }

    const fetchOptions: RequestInit = {
      headers,
      signal: AbortSignal.timeout(8000),
    };

    if (urlConfig) {
      if (urlConfig.method) fetchOptions.method = urlConfig.method.toUpperCase();
      if (urlConfig.headers) Object.assign(headers, urlConfig.headers);
      if (urlConfig.body) {
        let bStr = typeof urlConfig.body === "string" ? urlConfig.body : JSON.stringify(urlConfig.body);
        bStr = bStr
          .replace(/\{\{[^}]*key[^}]*\}\}/gi, encodedKey)
          .replace(/\$\{key\}/g, encodedKey)
          .replace(/\{\{page\}\}/g, String(page));
        fetchOptions.body = bStr;
        if (typeof urlConfig.body !== "string" && !headers["Content-Type"]) {
          headers["Content-Type"] = "application/json";
        }
      }
    }

    const resp = await fetch(targetUrl, fetchOptions);
    if (!resp.ok) return [];
    const text = await resp.text();

    return await extractSearchResults(text, source, targetUrl, key);
  } catch {
    return [];
  }
}

async function extractSearchResults(text: string, source: any, baseUrl: string, keyword: string): Promise<any[]> {
  const books: any[] = [];
  let baseDomain = "";
  try {
    baseDomain = new URL(baseUrl).origin;
  } catch {
    return [];
  }

  // 1. JSON response handling (including XiaoXiao encrypted content)
  if (text.trim().startsWith("{") || text.trim().startsWith("[")) {
    try {
      let data = JSON.parse(text);
      if (data.data?.content && typeof data.data.content === "string") {
        try {
          data = await decodeXiaoXiao(data.data.content);
        } catch {}
      }

      const list = data.book || data.data?.list || data.list || data.books || (Array.isArray(data) ? data : []);
      if (Array.isArray(list)) {
        for (const item of list.slice(0, 20)) {
          const name = item.name || item.title || item.bookName;
          if (name) {
            let bookUrl = item.bookUrl || item.url || "";
            if (!bookUrl && item.book_id) {
              bookUrl = `https://d.chuangke.tv/book/details/v4/${Math.floor(item.book_id / 1000)}/${item.book_id}.html`;
            } else if (!bookUrl && item.bookId) {
              bookUrl = `${source?.bookSourceUrl || baseDomain}/findChapterList?book_id=${item.bookId}`;
            }

            books.push({
              name,
              author: item.author || "未知作者",
              bookUrl: bookUrl || `${baseUrl}#${item.bookId || item.book_id || name}`,
              origin: source?.bookSourceUrl || baseUrl,
              originName: source?.bookSourceName || "网络书源",
              coverUrl: item.coverImg || item.cover || item.image || "",
              intro: item.desc || item.intro || item.remark || "",
              kind: item.categoryName || item.category || item.ltype || "网络小说",
              wordCount: item.word || item.words_number || "",
            });
          }
        }
        if (books.length > 0) return books;
      }
    } catch {}
  }

  // 2. HTML response handling: Extract matching books by headings or links
  const cardRegex = /<(?:div|li|tr|article)[^>]*class=["'][^"']*(?:book|item|novel|card)[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|li|tr|article)>/gi;
  let cardMatch;
  while ((cardMatch = cardRegex.exec(text)) !== null) {
    const cardHtml = cardMatch[1];
    const titleMatch = cardHtml.match(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    if (titleMatch) {
      let bookUrl = titleMatch[1].trim();
      const rawText = titleMatch[2].replace(/<[^>]+>/g, "").trim();
      if (rawText && rawText.length <= 40) {
        if (bookUrl.startsWith("/")) bookUrl = `${baseDomain}${bookUrl}`;
        else if (!bookUrl.startsWith("http")) bookUrl = `${baseDomain}/${bookUrl}`;

        const authorMatch =
          cardHtml.match(/(?:作者|auth)[^>]*>([^<]+)/i) ||
          cardHtml.match(/<span[^>]*class=["'][^"']*author[^"']*["'][^>]*>([\s\S]*?)<\/span>/i);
        const author = authorMatch ? authorMatch[1].replace(/<[^>]+>/g, "").trim() : "未知作者";

        books.push({
          name: rawText,
          author,
          bookUrl,
          origin: source.bookSourceUrl,
          originName: source.bookSourceName,
          kind: "网络连载",
        });
      }
    }
  }
  if (books.length > 0) return books.slice(0, 20);

  // 3. Fallback: standard link regex
  const linkRegex = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  const seenUrls = new Set<string>();

  while ((match = linkRegex.exec(text)) !== null) {
    let href = match[1].trim();
    const rawText = match[2].replace(/<[^>]+>/g, "").trim();

    if (rawText.toLowerCase().includes(keyword.toLowerCase()) && rawText.length <= 40) {
      let bookUrl = href;
      if (bookUrl.startsWith("/")) bookUrl = `${baseDomain}${bookUrl}`;
      else if (!bookUrl.startsWith("http")) bookUrl = `${baseDomain}/${bookUrl}`;

      if (!seenUrls.has(bookUrl)) {
        seenUrls.add(bookUrl);
        books.push({
          name: rawText,
          author: source.bookSourceName || "网络来源",
          bookUrl,
          origin: source.bookSourceUrl,
          originName: source.bookSourceName,
          kind: "网络连载",
        });
      }
    }
  }

  return books.slice(0, 20);
}

export async function handleSearchBookMulti(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const body = await request.json<any>();
  const key = (body.key || "").trim();
  const page = parseInt(body.page || "1", 10) || 1;
  const bookSourceUrls: string[] | undefined = Array.isArray(body.bookSourceUrls) ? body.bookSourceUrls : undefined;
  const bookSourceGroup: string | undefined = body.bookSourceGroup;

  if (!key) return jsonResponse({ isSuccess: true, data: [] });

  // 1. Fetch enabled book sources from D1
  const rows = await env.DB.prepare(
    `SELECT json FROM book_sources WHERE user_ns = ?1`
  )
    .bind(userNs)
    .all<{ json: string }>();

  let sources: any[] = (rows.results || [])
    .map((r) => {
      try {
        return JSON.parse(r.json);
      } catch {
        return null;
      }
    })
    .filter((s) => s && s.enabled !== false && s.searchUrl && s.searchUrl.trim().length > 0);

  if (bookSourceUrls && bookSourceUrls.length > 0) {
    const urlSet = new Set(bookSourceUrls);
    sources = sources.filter((s) => urlSet.has(s.bookSourceUrl));
  } else if (bookSourceGroup) {
    sources = sources.filter((s) => s.bookSourceGroup?.includes(bookSourceGroup));
  }

  // Scheme 1 Safety: Bound to max 20 sources per Worker invocation to never exceed Cloudflare's 50 subrequests limit!
  const targetChunk = sources.slice(0, 20);
  if (targetChunk.length === 0) {
    return jsonResponse({ isSuccess: true, data: [] });
  }

  // 2. Concurrently search the chunk using Promise.allSettled
  const searchTasks = targetChunk.map((source) => searchSingleSource(source, key, page, env));
  const settled = await Promise.allSettled(searchTasks);

  const allBooks: any[] = [];
  for (const res of settled) {
    if (res.status === "fulfilled" && Array.isArray(res.value)) {
      allBooks.push(...res.value);
    }
  }

  return jsonResponse({ isSuccess: true, data: allBooks });
}

export async function handleTestBookSources(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const body = await request.json<any>().catch(() => ({}));
  const urls: string[] = body.bookSourceUrls || [];
  const keyword = body.keyword || "我的";

  const rows = await env.DB.prepare(
    `SELECT book_source_url, book_source_name, json FROM book_sources WHERE user_ns = ?1`
  )
    .bind(userNs)
    .all<{ book_source_url: string; book_source_name: string; json: string }>();

  let allSources = (rows.results || []).map((r) => {
    try {
      return { ...JSON.parse(r.json), bookSourceUrl: r.book_source_url, bookSourceName: r.book_source_name };
    } catch {
      return { bookSourceUrl: r.book_source_url, bookSourceName: r.book_source_name };
    }
  });

  if (urls.length > 0) {
    allSources = allSources.filter((s) => urls.includes(s.bookSourceUrl));
  }

  const toTest = allSources.slice(0, 10);
  const startTime = Date.now();
  const results = [];

  for (const s of toTest) {
    const t0 = Date.now();
    try {
      if (s.searchUrl) {
        let testUrl = s.searchUrl;
        if (testUrl.includes("{{key}}")) testUrl = testUrl.replace(/\{\{key\}\}/g, encodeURIComponent(keyword));
        else if (testUrl.includes("${key}")) testUrl = testUrl.replace(/\$\{key\}/g, encodeURIComponent(keyword));
        else testUrl = testUrl.split("@")[0].split(";")[0].split(",")[0];

        if (testUrl.startsWith("http")) {
          if (!isSafeRemoteUrl(testUrl)) {
            results.push({
              bookSourceUrl: s.bookSourceUrl,
              bookSourceName: s.bookSourceName,
              status: "failed",
              durationMs: Date.now() - t0,
              error: "禁止访问内网或本地地址 (SSRF 防御)",
            });
            continue;
          }
          const resp = await fetch(testUrl, {
            headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
            signal: AbortSignal.timeout(5000),
          });
          results.push({
            bookSourceUrl: s.bookSourceUrl,
            bookSourceName: s.bookSourceName,
            status: resp.ok ? "success" : "failed",
            durationMs: Date.now() - t0,
            searchCount: resp.ok ? 1 : 0,
            error: resp.ok ? undefined : `HTTP ${resp.status}`,
          });
          continue;
        }
      }

      results.push({
        bookSourceUrl: s.bookSourceUrl,
        bookSourceName: s.bookSourceName,
        status: "success",
        durationMs: Date.now() - t0,
        searchCount: 1,
      });
    } catch (err: any) {
      results.push({
        bookSourceUrl: s.bookSourceUrl,
        bookSourceName: s.bookSourceName,
        status: "failed",
        durationMs: Date.now() - t0,
        error: err.message || "请求失败",
      });
    }
  }

  const validCount = results.filter((r) => r.status === "success").length;
  const invalidCount = results.length - validCount;

  // If markInvalid is enabled, add "失效" to the group of failed sources in D1
  if (body.markInvalid !== false && invalidCount > 0) {
    const invalidUrls = new Set(results.filter((r) => r.status !== "success").map((r) => r.bookSourceUrl));
    const now = Math.floor(Date.now() / 1000);
    for (const s of allSources) {
      if (invalidUrls.has(s.bookSourceUrl)) {
        const groups = (s.bookSourceGroup || "")
          .split(/[,，;；]/)
          .map((g: string) => g.trim())
          .filter(Boolean);
        if (!groups.includes("失效")) {
          groups.push("失效");
          s.bookSourceGroup = groups.join(",");
          await env.DB.prepare(
            `UPDATE book_sources SET json = ?1, updated_at = ?2 WHERE user_ns = ?3 AND book_source_url = ?4`
          )
            .bind(JSON.stringify(s), now, userNs, s.bookSourceUrl)
            .run();
        }
      }
    }
  }

  const mappedResults = results.map((r) => ({
    bookSourceName: r.bookSourceName,
    bookSourceUrl: r.bookSourceUrl,
    valid: r.status === "success",
    searchOk: r.status === "success",
    exploreOk: false,
    keyword,
    markedInvalid: r.status !== "success",
    error: r.error,
  }));

  const summary = {
    total: results.length,
    success: validCount,
    failed: invalidCount,
    durationMs: Date.now() - startTime,
  };

  return jsonResponse({
    isSuccess: true,
    data: {
      total: results.length,
      valid: validCount,
      invalid: invalidCount,
      markedInvalid: invalidCount,
      results: mappedResults,
      summary,
    },
  });
}
