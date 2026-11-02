import { jsonResponse } from "../http";
import { resolveUserNs } from "../auth";
import { Env } from "../types";
import * as documentHandlers from "../handlers/document";
import { indexEpubIntoDatabase } from "../handlers/epub";
import { indexPdfIntoDatabase } from "../handlers/pdf";
import { decodeTxtBytes, scanTxtChapterOffsets, scanTxtChaptersStreaming } from "../handlers/txt";
import { triggerOnChangeSync } from "./webdav";

export async function handleImportWebdavBook(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });
  const body = await request.json<any>();
  const { path, name: importName } = body || {};
  if (!path) return jsonResponse({ isSuccess: false, errorMsg: "缺少文件路径" });

  console.log(`[ImportBook] start path=${path}`);

  // 导入书架阶段：检查重名、转移文件、解析书籍、保存书架
  const shelf: any[] = (await documentHandlers.getDocument(env, userNs, "bookshelf.json")) || [];
  const fileName = importName || path.split("/").pop() || path;
  const safeName = fileName.replace(/[/\\?%*:|"<>]/g, "_");
  const lowerName = safeName.toLowerCase();

  console.log(`[ImportBook] userNs=${userNs} fileName=${fileName} safeName=${safeName} lowerName=${lowerName}`);

  // 检查书架中是否已有同名的本地书籍
  const existingIdx = shelf.findIndex((b) => b.name === fileName && (b.origin === "local-epub" || b.origin === "local-pdf" || b.origin === "local-txt"));
  if (existingIdx >= 0) {
    return jsonResponse({ isSuccess: false, errorMsg: "书籍已存在" });
  }

  // 将文件从 WebDAV 路径移动到 book 文件夹
  const sourceKey = path.startsWith(`webdav/${userNs}/`) ? path : `webdav/${userNs}/${safeName}`;
  const bookKey = `webdav/${userNs}/book/${safeName}`;

  console.log(`[ImportBook] sourceKey=${sourceKey} bookKey=${bookKey}`);

  // 如果文件已在 book/ 目录下，直接解析入库，不需要移动
  if (sourceKey !== bookKey) {
    // 检查 book/ 目录下是否已有同名文件，避免覆盖
    const existingBookObj = await env.BUCKET.get(bookKey);
    if (existingBookObj) {
      return jsonResponse({ isSuccess: false, errorMsg: "文件已存在于 book 文件夹下，请在该文件夹下导入书籍" });
    }
  }

  const fileObj = await env.BUCKET.get(sourceKey);
  if (!fileObj || !fileObj.body) return jsonResponse({ isSuccess: false, errorMsg: "源文件不存在，请先上传" });
  const fileSize = fileObj.size || 0;

  console.log(`[ImportBook] fileSize=${fileSize} sourceObj exists=true`);

  const now = Math.floor(Date.now() / 1000);
  const bookId = `local_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  let newBook: any;

  if (lowerName.endsWith(".epub")) {
    console.log(`[ImportBook] epub parsing start bookId=${bookId}`);
    try {
      // 直接从 sourceKey 解析（R2 range 读取，不占内存），不先 copy 到 bookKey
      const { title, author, totalChapters } = await indexEpubIntoDatabase(env, userNs, bookId, fileName, sourceKey, fileSize);
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

      // 先将文件从 sourceKey 移动到 book/ 目录，再从 bookKey 解析
      let finalR2Key = sourceKey;
      if (sourceKey !== bookKey) {
        try {
          await env.BUCKET.put(bookKey, fileObj.body, { httpMetadata: { contentType: "application/epub+zip" } });
          await env.BUCKET.delete(sourceKey);
          finalR2Key = bookKey;
          console.log(`[ImportBook] epub file moved to book/ bookId=${bookId}`);
        } catch (moveErr: any) {
          console.log(`[ImportBook] epub file move warning bookId=${bookId} err=${moveErr.message || moveErr}`);
          // 移动失败则保持在 sourceKey 解析
        }
      }

      await env.DB.prepare(
        `INSERT INTO epub_books (book_id, user_ns, file_name, r2_key, file_size, status, total_chapters, parsed_chapters, title, author, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 'ready', ?6, ?6, ?7, ?8, ?9, ?10)
         ON CONFLICT(book_id) DO UPDATE SET status='ready', total_chapters=excluded.total_chapters, parsed_chapters=excluded.parsed_chapters, updated_at=excluded.updated_at`
      )
        .bind(bookId, userNs, fileName, finalR2Key, fileSize, totalChapters, displayTitle, author || "未知作者", now, now)
        .run();
    } catch (err: any) {
      console.log(`[ImportBook] epub parsing error bookId=${bookId} err=${err.message || err}`);
      return jsonResponse({ isSuccess: false, errorMsg: `EPUB解析失败：${err.message || err}` });
    }
  } else if (lowerName.endsWith(".pdf")) {
    console.log(`[ImportBook] pdf parsing start bookId=${bookId}`);
    try {
      // 移动文件到 book/ 目录（如果还不在），流式 put 不一次性加载全文到内存
      let finalR2Key = sourceKey;
      if (sourceKey !== bookKey) {
        try {
          const existingBookObj = await env.BUCKET.get(bookKey);
          if (existingBookObj) {
            return jsonResponse({ isSuccess: false, errorMsg: "文件已存在于 book 文件夹下，请在该文件夹下导入书籍" });
          }
          await env.BUCKET.put(bookKey, fileObj.body, { httpMetadata: { contentType: "application/pdf" } });
          await env.BUCKET.delete(sourceKey);
          finalR2Key = bookKey;
          console.log(`[ImportBook] pdf file moved to book/ bookId=${bookId}`);
        } catch (moveErr: any) {
          console.log(`[ImportBook] pdf file move warning bookId=${bookId} err=${moveErr.message || moveErr}`);
        }
      }
      // 仅 Range 读取尾部 64KB 解析页数和元数据，不一次性加载全文到内存
      const { title, author, totalPages } = await indexPdfIntoDatabase(env, userNs, bookId, fileName, finalR2Key, fileSize);
      console.log(`[ImportBook] pdf parsing end bookId=${bookId} title=${title} author=${author} totalPages=${totalPages}`);
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
      await env.DB.prepare(
        `INSERT INTO pdf_books (book_id, user_ns, file_name, r2_key, file_size, total_pages, title, author, status, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'ready', ?9, ?10)`
      ).bind(bookId, userNs, fileName, finalR2Key, fileSize, totalPages, title, author, now, now).run();
    } catch (err: any) {
      console.log(`[ImportBook] pdf parsing error bookId=${bookId} err=${err.message || err}`);
      return jsonResponse({ isSuccess: false, errorMsg: `PDF解析失败：${err.message || err}` });
    }
  } else if (lowerName.endsWith(".txt")) {
    console.log(`[ImportBook] txt parsing start bookId=${bookId}`);
    try {
      // 移动文件到 book/ 目录（如果还不在），流式 put 不一次性加载全文到内存
      let finalR2Key = sourceKey;
      if (sourceKey !== bookKey) {
      try {
        const existingBookObj = await env.BUCKET.get(bookKey);
        if (existingBookObj) {
          return jsonResponse({ isSuccess: false, errorMsg: "文件已存在于 book 文件夹下，请在该文件夹下导入书籍" });
        }
        await env.BUCKET.put(bookKey, fileObj.body, { httpMetadata: { contentType: "text/plain; charset=utf-8" } });
        await env.BUCKET.delete(sourceKey);
        finalR2Key = bookKey;
        console.log(`[ImportBook] txt file moved to book/ bookId=${bookId}`);
      } catch (moveErr: any) {
        console.log(`[ImportBook] txt file move warning bookId=${bookId} err=${moveErr.message || moveErr}`);
      }
    }

    // 流式扫描章节：分块 Range 读取 R2，不一次性加载全文到内存
    const chapters = await scanTxtChaptersStreaming(env, finalR2Key, fileSize);
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
      wordCount: `${Math.ceil(fileSize / 2)}字`,
    };
    await env.DB.prepare(
      `INSERT INTO txt_books (book_id, user_ns, file_name, r2_key, file_size, total_chapters, title, author, status, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, '本地导入', 'ready', ?8, ?9)
       ON CONFLICT(book_id) DO UPDATE SET file_size=excluded.file_size, total_chapters=excluded.total_chapters, title=excluded.title, updated_at=excluded.updated_at`
    )
      .bind(bookId, userNs, fileName, finalR2Key, fileSize, totalChapters, title, now, now)
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
    } catch (err: any) {
      console.log(`[ImportBook] txt parsing error bookId=${bookId} err=${err.message || err}`);
      return jsonResponse({ isSuccess: false, errorMsg: `TXT解析失败：${err.message || err}` });
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
