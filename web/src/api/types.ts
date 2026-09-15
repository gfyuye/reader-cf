export interface Book {
  bookUrl: string
  name: string
  author: string
  origin: string
  bookSource: string
  coverUrl: string
  intro: string
  chapterCount: number
  lastChapterRead?: string
  updateTime?: number
  serializedState?: string
  bookGroup?: string
  pdfImageWidth?: number
  isLocal?: boolean
  order?: number
  [key: string]: any
}

export interface BookChapter {
  bookUrl: string
  chapterUrl: string
  name: string
  index: number
  cacheUrl?: string
  bookSource?: string
  start?: number
  end?: number
  [key: string]: any
}

export interface BookSource {
  bookSourceUrl: string
  bookSourceName: string
  bookSourceGroup: string
  bookSourceType?: string
  searchUrl?: string
  searchRule?: string
  exploreUrl?: string
  exploreRule?: string
  bookInfoRule?: string
  chapterListRule?: string
  contentRule?: string
  coverUrlRule?: string
  weight?: number
  enabled?: boolean
  [key: string]: any
}

export interface SearchBook {
  name: string
  author: string
  bookUrl: string
  coverUrl: string
  bookSource: string
  intro: string
  chapterCount: number
  isSearch?: boolean
}

export interface RssSource {
  rssSrcName: string
  rssSrcUrl: string
  rssSrcGroup: string
  interval: number
  lastUpdateTime?: number
  enabled?: boolean
  [key: string]: any
}

export interface RssArticle {
  rssSrcName: string
  articleUrl: string
  articleTitle: string
  author?: string
  description?: string
  pubDate?: string
  imageUrl?: string
  [key: string]: any
}

export interface Bookmark {
  bookUrl: string
  bookName: string
  bookAuthor: string
  chapterUrl: string
  chapterName: string
  bookmarkText: string
  time: number
  [key: string]: any
}

export interface BookGroup {
  groupId: number
  groupName: string
  order: number
  show: boolean
  [key: string]: any
}

export interface ReplaceRule {
  name: string
  pattern: string
  replacement: string
  scope?: string
  [key: string]: any
}

export interface HttpTTS {
  id?: string
  name: string
  url: string
  [key: string]: any
}

// ===== 以下为新增 =====

/** 统一的 API 响应结构 */
export interface ApiResult<T = any> {
  isSuccess: boolean
  data: T
  errorMsg?: string
}

/** 系统信息 */
export interface SystemInfo {
  version?: string
  os?: string
  javaVersion?: string
  memory?: {
    total: number
    used: number
    free: number
  }
  cpu?: {
    cores: number
    usage: number
  }
  [key: string]: any
}

/** 用户信息 */
export interface User {
  username: string
  password?: string
  userNS?: string
  bookLimit?: number
  bookCount?: number
  enabled?: boolean
  isAdmin?: boolean
  [key: string]: any
}
