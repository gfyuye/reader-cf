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
  durChapterIndex?: number
  durChapterPos?: number
  wordCount?: string
  canUpdate?: boolean
  lastUpdateTime?: string
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
  chapterIndex?: number
  chapterPos?: number
  content?: string
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
  isRegex?: boolean
  isEnabled?: boolean
  [key: string]: any
}

export interface HttpTTS {
  id?: string
  name: string
  url: string
  contentType?: string
  header?: string
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
  enable_webdav?: boolean
  enable_local_store?: boolean
  enable_book_source?: boolean
  enable_rss_source?: boolean
  book_source_limit?: number
  last_login_at?: number
  created_at?: number
  token_map?: Record<string, number> | null
  [key: string]: any
}

/** 阅读配置 */
export interface ReadConfig {
  name?: string
  configDefaultType?: string
  customConfig?: string
  theme?: number | string
  font?: number
  chineseFont?: string
  fontSize?: number
  fontWeight?: number
  fontColor?: string
  bodyColor?: string
  contentColor?: string
  popupColor?: string
  themeType?: 'day' | 'night'
  readMethod?: string
  clickMethod?: string
  animateMSTime?: number
  readWidth?: number
  lineHeight?: number
  paragraphSpace?: number
  autoReadingMethod?: string
  autoReadingPixel?: number
  autoReadingLineTime?: number
  pageMode?: string
  selectionAction?: string
  topPadding?: number
  bottomPadding?: number
  horizontalPadding?: number
  epubMode?: string
  chapterRequestTimeout?: number
  quickKeyMode?: string
  quickKey?: Record<string, string>
  autoTheme?: boolean
  pageType?: string
  contentBGImg?: string
  isNormalPage?: boolean
  customFontsMap?: Record<string, string>
  [key: string]: any
}

/** 自定义配置方案 */
export interface CustomConfig {
  name: string
  configDefaultType?: string
  theme?: number
  font?: number
  fontSize?: number
  fontColor?: string
  bodyColor?: string
  contentColor?: string
  popupColor?: string
  themeType?: 'day' | 'night'
  [key: string]: any
}

/** 书源调试结果 */
export interface SourceDebugResult {
  success: boolean
  msg: string
  data: {
    bookInfo: any
    chapterList: BookChapter[]
    content?: string
    toc?: any[]
  }
}

/** 文件信息 */
export interface FileInfo {
  name: string
  isDir: boolean
  size?: number
  modified?: number
  path: string
  [key: string]: any
}

/** 分页结果 */
export interface PaginatedResult<T> {
  list: T[]
  total?: number
  hasMore?: boolean
  lastIndex?: number
}
