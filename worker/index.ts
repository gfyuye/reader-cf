import { Env, EpubQueueMessage, CentralDirEntry, EpubTocItem } from "./types";
import { handleRequest } from "./router";
import { cleanupStaleMultipartUploads } from "./handlers/cleanup";

export type { Env, EpubQueueMessage, CentralDirEntry, EpubTocItem } from "./types";

/**
 * Cloudflare Worker Backend for reader-rust
 * 极薄网关入口：所有路由已收束至 worker/router.ts。
 *
 * 路由模块：
 * - auth, document, user-admin, book-source, bookshelf, content, epub, pdf, txt
 *   rss, ai, asset, search, upload, webdav
 *
 * 职责：仅负责请求入口分发，具体路由处理见 worker/router.ts。
 *
 * R2 碎片清理策略：在 Worker 冷启动（Isolate 首次初始化）时，第一个请求
 * 会触发一次未完成 multipart upload 的清理，避免定期 Cron 触发。
 */

let _cleanupDone = false;

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (!_cleanupDone) {
      _cleanupDone = true;
      try {
        const { aborted, errors } = await cleanupStaleMultipartUploads(env);
        console.log(`Cold-start cleanup stale multipart uploads: aborted=${aborted}, errors=${errors}`);
      } catch (e) {
        console.error("Cold-start cleanup failed:", e);
      }
    }
    return handleRequest(request, env, ctx);
  },
};
