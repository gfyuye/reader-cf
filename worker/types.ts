export interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
  EPUB_QUEUE?: any;
  ASSETS?: any; // Cloudflare Worker Static Assets Binding
  AI?: any; // Cloudflare Workers AI Binding
  CF_ACCOUNT_ID?: string;
  CF_API_TOKEN?: string;
  CF_KITESURF_ENABLED?: string;
  REMOTE_WEBVIEW_API?: string;
  REMOTE_WEBVIEW_API_KEY?: string;
  SECURE?: string;
  SECURE_KEY?: string;
  INVITE_CODE?: string;
  USER_LIMIT?: string;
  USER_BOOK_LIMIT?: string;
  USER_LOCAL_BOOK_LIMIT?: string;
  LOG_LEVEL?: string;
  R2_BUCKET_NAME?: string;
  STORAGE_BACKEND?: string;
  DATABASE_BACKEND?: string;
}

export interface EpubQueueMessage {
  bookId: string;
  userNs: string;
}

export interface CentralDirEntry {
  sig: number;
  verMade: number;
  verNeed: number;
  flags: number;
  method: number;
  modTime: number;
  modDate: number;
  crc32: number;
  compSize: number;
  uncompSize: number;
  nameLen: number;
  extraLen: number;
  commLen: number;
  diskStart: number;
  intAttr: number;
  extAttr: number;
  localHeaderOff: number;
  name: string;
}

export interface EpubTocItem {
  href: string;
  title: string;
  order: number;
  pageIndex: number;
}
