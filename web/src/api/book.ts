import { get, post } from './http'
import type { Book, BookSource, SearchBook, BookChapter, ReadConfig } from './types'

export async function getSystemInfo() {
  return get('/getSystemInfo')
}

export async function getBookshelf(userNameSpace?: string) {
  return get('/getBookshelf', { userNameSpace })
}

export async function getShelfBook(bookUrl: string, userNameSpace?: string) {
  return get('/getShelfBook', { bookUrl, userNameSpace })
}

export async function saveBook(book: Book, userNameSpace?: string) {
  return post('/saveBook', { ...book, userNameSpace })
}

export async function deleteBook(bookUrl: string, userNameSpace?: string) {
  return post('/deleteBook', { bookUrl, userNameSpace })
}

export async function deleteBooks(bookUrls: string[], userNameSpace?: string) {
  return post('/deleteBooks', { bookUrls, userNameSpace })
}

export async function getBookInfo(bookUrl: string, userNameSpace?: string) {
  return get('/getBookInfo', { url: bookUrl, userNameSpace })
}

export async function getChapterList(bookUrl: string, userNameSpace?: string, refresh?: number) {
  return get('/getChapterList', { url: bookUrl, userNameSpace, refresh })
}

export async function getChapterListByRule(tocRule: string, bookUrl: string, userNameSpace?: string) {
  return post('/getChapterListByRule', { tocRule, url: bookUrl, userNameSpace })
}

export async function getBookContent(
  bookUrl: string,
  chapterUrl?: string,
  index?: number,
  cache?: number,
  refresh?: number,
  epubContent?: number,
  userNameSpace?: string
) {
  return get('/getBookContent', {
    url: bookUrl,
    chapterUrl,
    index,
    cache,
    refresh,
    epubContent,
    userNameSpace,
  })
}

export async function saveBookProgress(bookUrl: string, chapterIndex: number, userNameSpace?: string) {
  return post('/saveBookProgress', { url: bookUrl, index: chapterIndex, userNameSpace })
}

export async function saveBookContent(
  bookUrl: string,
  chapterUrl: string,
  content: string,
  userNameSpace?: string
) {
  return post('/saveBookContent', { url: bookUrl, chapterUrl, content, userNameSpace })
}

export async function searchBook(key: string, page: number, userNameSpace?: string) {
  return get('/searchBook', { key, page, userNameSpace })
}

export async function searchBookMulti(
  key: string,
  bookSourceGroup: string,
  lastIndex: number,
  searchSize: number,
  concurrentCount: number,
  userNameSpace?: string
) {
  return get('/searchBookMulti', {
    key,
    bookSourceGroup,
    lastIndex,
    searchSize,
    concurrentCount,
    userNameSpace,
  })
}

export async function getAvailableBookSource(bookUrl: string, userNameSpace?: string) {
  return get('/getAvailableBookSource', { url: bookUrl, userNameSpace })
}

export async function exploreBook(ruleFindUrl: string, page: number, userNameSpace?: string) {
  return get('/exploreBook', { ruleFindUrl, page, userNameSpace })
}

export async function searchBookSource(
  bookUrl: string,
  lastIndex: number,
  searchSize: number,
  bookSourceGroup: string,
  userNameSpace?: string
) {
  return get('/searchBookSource', {
    url: bookUrl,
    lastIndex,
    searchSize,
    bookSourceGroup,
    userNameSpace,
  })
}

export async function setBookSource(bookUrl: string, bookSource: string, userNameSpace?: string) {
  return post('/setBookSource', { url: bookUrl, bookSource, userNameSpace })
}

export async function getInvalidBookSources(userNameSpace?: string) {
  return get('/getInvalidBookSources', { userNameSpace })
}

export async function getBookCover(path: string) {
  return get('/cover', { path })
}

export async function importBookPreview(bookFiles: File[]) {
  const formData = new FormData()
  bookFiles.forEach((f) => formData.append('files', f))
  return post('/importBookPreview', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
}

export async function refreshLocalBook(userNameSpace?: string) {
  return post('/refreshLocalBook', { userNameSpace })
}

export async function getTxtTocRules(userNameSpace?: string) {
  return get('/getTxtTocRules', { userNameSpace })
}

export async function saveBookConfig(
  bookUrl: string,
  config: ReadConfig,
  userNameSpace?: string
) {
  return post('/saveBookConfig', { url: bookUrl, config, userNameSpace })
}

export async function getBookConfig(bookUrl: string, userNameSpace?: string) {
  return get('/getBookConfig', { url: bookUrl, userNameSpace })
}

export async function searchBookContent(
  key: string,
  bookUrl: string,
  userNameSpace?: string
) {
  return get('/searchBookContent', { key, url: bookUrl, userNameSpace })
}

export async function exportBook(bookUrl: string, fileName?: string, userNameSpace?: string) {
  return post('/exportBook', { bookUrl, fileName, userNameSpace })
}

export async function cacheBookOnServer(bookUrl: string, userNameSpace?: string) {
  return post('/cacheBookOnServer', { bookUrl, userNameSpace })
}

export async function cacheBookSSE(bookUrl: string, userNameSpace?: string) {
  return get('/cacheBookSSE', { url: bookUrl, userNameSpace })
}

export async function getShelfBookWithCacheInfo(userNameSpace?: string) {
  return get('/getShelfBookWithCacheInfo', { userNameSpace })
}

export async function deleteBookCache(bookUrl: string, userNameSpace?: string) {
  return post('/deleteBookCache', { url: bookUrl, userNameSpace })
}

export async function saveBookGroupId(bookUrl: string, groupId: number, userNameSpace?: string) {
  return post('/saveBookGroupId', { url: bookUrl, groupId, userNameSpace })
}

export async function addBookGroupMulti(bookUrls: string[], groupId: number, userNameSpace?: string) {
  return post('/addBookGroupMulti', { bookUrls, groupId, userNameSpace })
}

export async function removeBookGroupMulti(bookUrls: string[], groupId: number, userNameSpace?: string) {
  return post('/removeBookGroupMulti', { bookUrls, groupId, userNameSpace })
}
