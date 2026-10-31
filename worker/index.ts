import { Env, EpubQueueMessage, CentralDirEntry, EpubTocItem } from "./types";
import { handleRequest } from "./router";

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
 */

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return handleRequest(request, env, ctx);
  },
};
