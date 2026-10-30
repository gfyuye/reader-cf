import { ENV_DEFAULTS } from "./env-defaults";
import { md5Hex as md5 } from "./md5";
import {
  parseSearchResultsWithRules,
  parseChapterListWithRules,
  parseContentWithRules,
  executeLegadoJs,
} from "./legado-engine";
import { Env, EpubQueueMessage } from "./types";
import { corsHeaders, jsonResponse, getAccessToken } from "./http";
import { getEnv } from "./env";
import { randomString, isSafeRemoteUrl, fetchTextWithEncoding } from "./utils";
import { isAuthorizedAdmin, resolveUserNs } from "./auth";
import * as documentHandlers from "./handlers/document";
import * as authHandlers from "./handlers/auth";
import * as userAdminHandlers from "./handlers/user-admin";
import * as cryptoUtils from "./crypto";
import * as uploadHandlers from "./handlers/upload";
import { handleRequest } from "./router";

export type { Env, EpubQueueMessage, CentralDirEntry, EpubTocItem } from "./types";

/**
 * Cloudflare Worker Backend for reader-rust
 * Entry point: delegates all routes to router.handleRequest.
 * Individual handler implementations live in worker/handlers/* modules.
 */

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }
    if (new URL(request.url).pathname === "/health") {
      return jsonResponse({ status: "ok", service: "reader-rust-cloudflare-worker" });
    }
    return handleRequest(request, env, ctx);
  },
};

// === TEMP STUBS ===
const _stubHandler = (name: string) => (..._args: any[]) => ({ isSuccess: false, errorMsg: name + ' not implemented' });
const handleSearchBookMulti: any = _stubHandler("handleSearchBookMulti");
const handleTestBookSources: any = _stubHandler("handleTestBookSources");
const handleExploreBook: any = _stubHandler("handleExploreBook");
const handleGetShelfBook: any = _stubHandler("handleGetShelfBook");
const handleGetBookInfo: any = _stubHandler("handleGetBookInfo");
const handleGetChapterList: any = _stubHandler("handleGetChapterList");
const handleSaveBookGroupId: any = _stubHandler("handleSaveBookGroupId");
const handleGetRssArticles: any = _stubHandler("handleGetRssArticles");
const handleGetRssContent: any = _stubHandler("handleGetRssContent");
const handleUploadFile: any = _stubHandler("handleUploadFile");
const handleDeleteFile: any = _stubHandler("handleDeleteFile");
const handleGetAsset: any = _stubHandler("handleGetAsset");
const handleGetWebdavFileList: any = _stubHandler("handleGetWebdavFileList");
const handleGetWebdavFile: any = _stubHandler("handleGetWebdavFile");
const handleUploadFileToWebdav: any = _stubHandler("handleUploadFileToWebdav");
const handleDeleteWebdavFile: any = _stubHandler("handleDeleteWebdavFile");
const handleDeleteWebdavFileList: any = _stubHandler("handleDeleteWebdavFileList");
const handleGetAiBookMemory: any = _stubHandler("handleGetAiBookMemory");
const handleSaveAiBookMemory: any = _stubHandler("handleSaveAiBookMemory");
const handleDeleteAiBookMemory: any = _stubHandler("handleDeleteAiBookMemory");
const handleAiProxy: any = _stubHandler("handleAiProxy");
const handleAiProxyImage: any = _stubHandler("handleAiProxyImage");
// === END STUBS ===
