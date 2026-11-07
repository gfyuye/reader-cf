import { jsonResponse } from "../http";
import { resolveUserNs } from "../auth";
import { Env } from "../types";
import * as documentHandlers from "../handlers/document";
import { parseChapterListWithRules } from "../legado-engine";
import { isSafeRemoteUrl } from "../utils";
import { triggerOnChangeSync } from "./webdav";

export interface SourceBookIndexResult {
  title: string;
  author: string;
  totalChapters: number;
  chapters: Array<{ index: number; title: string; url: string }>;
}

function stableBookId(bookSourceUrl: string, bookUrl: string): string {
  const input = `${bookSourceUrl}|${bookUrl}`;
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return `source_${Math.abs(hash)}`;
}

async function fetchSourceText(url: string, source: any): Promise<string> {
  const headers: Record<string, string> = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  };
  if (source?.header) {
    try {
      Object.assign(headers, JSON.parse(source.header));
    } catch {}
  }
  const resp = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(15000),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return await resp.text();
}

export async function indexSourceBookIntoDatabase(
  env: Env,
  userNs: string,
  bookSourceUrl: string,
  bookUrl: string,
  bookName?: string
): Promise<SourceBookIndexResult> {
  console.log(`[SourceBookIndex] start userNs=${userNs} bookSourceUrl=${bookSourceUrl} bookUrl=${bookUrl}`);

  // 1. 从 book_sources 表获取书源配置
  const sRow = await env.DB.prepare(
    `SELECT json FROM book_sources WHERE user_ns = ?1 AND book_source_url = ?2`
  )
    .bind(userNs, bookSourceUrl)
    .first<{ json: string }>();
  let source: any = null;
  if (sRow) {
    try { source = JSON.parse(sRow.json); } catch {}
  }

  // 2. 抓取书籍详情页（获取书名、作者、封面等，如果前端未提供书名）
  let title = bookName || "";
  let author = "未知作者";
  let coverUrl = "";
  let intro = "";

  try {
    const detailHtml = await fetchSourceText(bookUrl, source);
    if (detailHtml && detailHtml.length > 0) {
      const titleMatch = detailHtml.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
      if (titleMatch && !title) title = titleMatch[1].replace(/<[^>]+>/g, "").trim();
      const authorMatch = detailHtml.match(/(?:作者|author)[^>]*>([\s\S]*?)<\/[^>]*>/i);
      if (authorMatch) author = authorMatch[1].replace(/<[^>]+>/g, "").trim() || "未知作者";
      const coverMatch = detailHtml.match(/<img[^>]*\bsrc=["']([^"']+)["'][^>]*>/i);
      if (coverMatch) coverUrl = coverMatch[1];
    }
  } catch (err: any) {
    console.log(`[SourceBookIndex] fetch detail failed bookUrl=${bookUrl} err=${err.message || err}`);
  }

  if (!title) title = bookName || "未知书名";

  // 3. 抓取目录页并解析章节列表（使用书源 ruleToc 规则）
  let chapters: Array<{ index: number; title: string; url: string }> = [];
  try {
    const tocHtml = await fetchSourceText(bookUrl, source);
    const parsed = await parseChapterListWithRules(tocHtml, source, bookUrl);
    chapters = parsed.map((ch, idx) => ({
      index: ch.index ?? idx,
      title: ch.title,
      url: ch.url,
    }));
  } catch (err: any) {
    console.log(`[SourceBookIndex] parse toc failed bookUrl=${bookUrl} err=${err.message || err}`);
  }

  const totalChapters = chapters.length;
  const now = Math.floor(Date.now() / 1000);
  const bookId = stableBookId(bookSourceUrl, bookUrl);

  const newBook = {
    name: title,
    author,
    bookUrl,
    origin: "source",
    originName: source?.bookSourceName || "书源",
    tocUrl: bookUrl,
    canUpdate: false,
    durChapterIndex: 0,
    durChapterPos: 0,
    durChapterTitle: chapters[0]?.title || "第一章",
    durChapterTime: now,
    totalChapterNum: totalChapters,
    latestChapterTitle: chapters[chapters.length - 1]?.title,
    kind: "网络连载",
    coverUrl,
    intro,
  };

  // 4. 写入 book_details（一本书一条 JSON：元数据 + 章节目录 + 进度）
  const bookDetail = {
    ...newBook,
    bookId,
    r2Key: "",
    fileSize: 0,
    updatedAt: now,
    chapters: chapters.map((ch) => ({
      index: ch.index,
      title: ch.title,
      url: ch.url,
    })),
  };
  await documentHandlers.saveBookDetail(env, userNs, bookId, bookDetail);

  console.log(`[SourceBookIndex] end userNs=${userNs} bookId=${bookId} title=${title} totalChapters=${totalChapters}`);

  return { title, author, totalChapters, chapters };
}

export async function handleSourceBookImport(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const body = await request.json<any>();
  const { bookSourceUrl, bookUrl, bookName } = body || {};
  if (!bookSourceUrl || !bookUrl) {
    return jsonResponse({ isSuccess: false, errorMsg: "缺少 bookSourceUrl 或 bookUrl" });
  }

  if (!isSafeRemoteUrl(bookUrl)) {
    return jsonResponse({ isSuccess: false, errorMsg: "禁止访问内网或本地地址 (SSRF 防御)" });
  }

  console.log(`[SourceBookImport] start userNs=${userNs} bookSourceUrl=${bookSourceUrl} bookUrl=${bookUrl}`);

  // 检查书架中是否已有同一书源书籍（按 bookUrl 去重）
  let shelf: any[] = [];
  try {
    shelf = (await documentHandlers.getDocument(env, userNs, "bookshelf.json")) || [];
  } catch (shelfErr: any) {
    console.log(`[SourceBookImport] get shelf error userNs=${userNs} err=${shelfErr.message || shelfErr}`);
    return jsonResponse({ isSuccess: false, errorMsg: `读取书架失败：${shelfErr.message || shelfErr}` });
  }

  const existingIdx = shelf.findIndex((b) => b.bookUrl === bookUrl && b.origin === "source");
  if (existingIdx >= 0) {
    return jsonResponse({ isSuccess: false, errorMsg: "书籍已存在于书架" });
  }

  const now = Math.floor(Date.now() / 1000);
  let newBook: any;

  try {
    const result = await indexSourceBookIntoDatabase(env, userNs, bookSourceUrl, bookUrl, bookName);
    newBook = {
      name: result.title,
      author: result.author,
      bookUrl,
      origin: "source",
      originName: "书源",
      tocUrl: bookUrl,
      canUpdate: false,
      durChapterIndex: 0,
      durChapterPos: 0,
      durChapterTitle: result.chapters[0]?.title || "第一章",
      durChapterTime: now,
      totalChapterNum: result.totalChapters,
      latestChapterTitle: result.chapters[result.totalChapters - 1]?.title,
      kind: "网络连载",
    };
  } catch (err: any) {
    console.log(`[SourceBookImport] index error bookUrl=${bookUrl} err=${err.message || err}`);
    return jsonResponse({ isSuccess: false, errorMsg: `书源书籍入库失败：${err.message || err}` });
  }

  // 保存书架
  shelf.unshift(newBook);
  try {
    await documentHandlers.saveDocument(env, userNs, "bookshelf.json", shelf);
    triggerOnChangeSync(env, userNs, ctx);
  } catch (shelfErr: any) {
    console.log(`[SourceBookImport] save shelf error bookUrl=${bookUrl} err=${shelfErr.message || shelfErr}`);
    return jsonResponse({ isSuccess: false, errorMsg: `保存书架失败：${shelfErr.message || shelfErr}` });
  }

  return jsonResponse({ isSuccess: true, data: newBook });
}
