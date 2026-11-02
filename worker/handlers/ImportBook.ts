import { jsonResponse } from "../http";
import { resolveUserNs } from "../auth";
import { Env } from "../types";
import * as documentHandlers from "../handlers/document";
import { indexEpubIntoDatabase } from "../handlers/epub";
import { indexPdfIntoDatabase } from "../handlers/pdf";
import { decodeTxtBytes, scanTxtChapterOffsets } from "../handlers/txt";
import { triggerOnChangeSync } from "./webdav";

export async function handleImportWebdavBook(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });
  const body = await request.json<any>();
  const { path } = body || {};
  if (!path) return jsonResponse({ isSuccess: false, errorMsg: "缺少文件路径" });

  console.log(`[ImportBook] start path=${path}`);

  // 导入书架阶段：检查重名、转移文件、解析书籍、保存书架
  const shelf: any[] = (await documentHandlers.getDocument(env, userNs, "bookshelf.json")) || [];
  const fileName = path.split("/").pop() || path;
  const safeName = fileName.replace(/[/\\?%*:|"<>]/g, "_");
  const lowerName = safeName.toLowerCase();

  console.log(`[ImportBook] userNs=${userNs} fileName=${fileName} safeName=${safeName} lowerName=${lowerName}`);

  // 检查书架中是否已有同名的本地书籍
  const existingIdx = shelf.findIndex((b) => b.name === fileName && (b.origin === "local-epub" || b.origin === "local-pdf" || b.origin === "local-txt"));
  if (existingIdx >= 0) {
    return jsonResponse({ isSuccess: false, errorMsg: `书架中已存在同名书籍《${fileName}》，请先删除或重命名` });
  }

  // 将文件从 WebDAV 路径移动到 book 文件夹
  const sourceKey = path.startsWith(`webdav/${userNs}/`) ? path : `webdav/${userNs}/${safeName}`;
  const bookKey = `webdav/${userNs}/book/${safeName}`;

  console.log(`[ImportBook] sourceKey=${sourceKey} bookKey=${bookKey}`);

  // 检查 book/ 目录下是否已有同名文件，避免覆盖
  const existingBookObj = await env.BUCKET.get(bookKey);
  if (existingBookObj) {
    return jsonResponse({ isSuccess: false, errorMsg: `书籍已存在：《${safeName}》，请先删除或重命名` });
  }

  const fileObj = await env.BUCKET.get(sourceKey);
  if (!fileObj || !fileObj.body) return jsonResponse({ isSuccess: false, errorMsg: "源文件不存在，请先上传" });
  const fileSize = fileObj.size || 0;

  console.log(`[ImportBook] fileSize=${fileSize} sourceObj exists=true`);
  await env.BUCKET.put(bookKey, fileObj.body, {
    httpMetadata: lowerName.endsWith(".epub") ? { contentType: "application/epub+zip" } : lowerName.endsWith(".pdf") ? { contentType: "application/pdf" } : { contentType: "text/plain; charset=utf-8" },
  });
  if (sourceKey !== bookKey) {
    await env.BUCKET.delete(sourceKey);
  }

  const now = Math.floor(Date.now() / 1000);
  const bookId = `local_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  let newBook: any;

  if (lowerName.endsWith(".epub")) {
    console.log(`[ImportBook] epub parsing start bookId=${bookId}`);
    try {
      const { title, author, totalChapters } = await indexEpubIntoDatabase(env, userNs, bookId, fileName, bookKey, fileSize);
      console.log(`[ImportBook] epub parsing end bookId=${bookId} title=${title} author=${author} totalChapters=${totalChapters}`);
      const displayTitle = title || safeName.replace(/\.epub$/i, "");
      newBook = {
        name: displayTitle,
        author: author || "未知作者",
        bookUrl: `local-epub:${bookId}`,
        origin: "local-epub",
        originName: "本地 EPUB",
        tocUrl: `local-epub:${bookId}`,
        canUpdate: false,
        durChapterIndex: 0,
        durChapterPos: 0,
        durChapterTitle: "第 1 节",
        durChapterTime: now,
        totalChapterNum: totalChapters,
        kind: "本地EPUB",
      };
      await env.DB.prepare(
        `INSERT INTO epub_books (book_id, user_ns, file_name, r2_key, file_size, status, total_chapters, parsed_chapters, title, author, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 'ready', ?6, ?6, ?7, ?8, ?9, ?10)
         ON CONFLICT(book_id) DO UPDATE SET status='ready', total_chapters=excluded.total_chapters, parsed_chapters=excluded.parsed_chapters, updated_at=excluded.updated_at`
      )
        .bind(bookId, userNs, fileName, bookKey, fileSize, totalChapters, displayTitle, author || "未知作者", now, now)
        .run();
    } catch (err: any) {
      console.log(`[ImportBook] epub parsing error bookId=${bookId} err=${err.message || err}`);
      return jsonResponse({ isSuccess: false, errorMsg: `EPUB解析失败：${err.message || err}` });
    }
  } else if (lowerName.endsWith(".pdf")) {
    const pdfObj = await env.BUCKET.get(bookKey);
    const pdfBodyBytes = pdfObj ? new Uint8Array(await pdfObj.arrayBuffer()) : new Uint8Array(0);
    const { title, author, totalPages } = await indexPdfIntoDatabase(env, userNs, bookId, fileName, bookKey, fileSize, pdfBodyBytes);
    newBook = {
      name: title,
      author: author,
      bookUrl: `local-pdf:${bookId}`,
      origin: "local-pdf",
      originName: "本地 PDF",
      tocUrl: `local-pdf:${bookId}`,
      canUpdate: false,
      durChapterIndex: 1,
      durChapterPos: 0,
      durChapterTitle: "第 1 页",
      durChapterTime: now,
      totalChapterNum: totalPages,
      kind: "本地PDF",
    };
  } else if (lowerName.endsWith(".txt")) {
    const txtObj = await env.BUCKET.get(bookKey);
    const txtBodyBytes = txtObj ? new Uint8Array(await txtObj.arrayBuffer()) : new Uint8Array(0);
    const text = decodeTxtBytes(txtBodyBytes);
    const utf8Bytes = new TextEncoder().encode(text);
    const chapters = scanTxtChapterOffsets(text, utf8Bytes);
    const totalChapters = chapters.length;
    const title = safeName.replace(/\.txt$/i, "");
    newBook = {
      name: title,
      author: "本地导入",
      bookUrl: `local-txt:${bookId}`,
      origin: "local-txt",
      originName: "本地 TXT",
      tocUrl: `local-txt:${bookId}`,
      canUpdate: false,
      durChapterIndex: 0,
      durChapterPos: 0,
      durChapterTitle: chapters[0]?.title || "第一章",
      durChapterTime: now,
      totalChapterNum: totalChapters,
      latestChapterTitle: chapters[chapters.length - 1]?.title,
      kind: "本地TXT",
      wordCount: `${text.length}字`,
    };
    await env.DB.prepare(
      `INSERT INTO txt_books (book_id, user_ns, file_name, r2_key, file_size, total_chapters, title, author, status, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, '本地导入', 'ready', ?8, ?9)
       ON CONFLICT(book_id) DO UPDATE SET file_size=excluded.file_size, total_chapters=excluded.total_chapters, title=excluded.title, updated_at=excluded.updated_at`
    )
      .bind(bookId, userNs, fileName, bookKey, fileSize, totalChapters, title, now, now)
      .run();
    const stmts = chapters.map((ch, idx) =>
      env.DB.prepare(
        `INSERT INTO txt_chapters (book_id, chapter_index, title, byte_offset, byte_length, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(book_id, chapter_index) DO UPDATE SET byte_offset=excluded.byte_offset, byte_length=excluded.byte_length`
      ).bind(bookId, idx, ch.title, ch.offset, ch.length, now)
    );
    for (let i = 0; i < stmts.length; i += 50) {
      await env.DB.batch(stmts.slice(i, i + 50));
    }
  } else {
    return jsonResponse({ isSuccess: false, errorMsg: "不支持的文件类型" });
  }

  // 保存书架
  const shelfIdx = shelf.findIndex((b) => b.bookUrl === newBook.bookUrl || (b.name === newBook.name && b.origin === newBook.origin));
  if (shelfIdx >= 0) {
    shelf[shelfIdx] = { ...shelf[shelfIdx], ...newBook, bookUrl: shelf[shelfIdx].bookUrl, durChapterTime: now };
  } else {
    shelf.unshift(newBook);
  }
  await documentHandlers.saveDocument(env, userNs, "bookshelf.json", shelf);
  triggerOnChangeSync(env, userNs, ctx);

  return jsonResponse({ isSuccess: true, data: newBook });
}
