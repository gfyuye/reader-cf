import { get, post } from './http'
import type { Book, BookSource, SearchBook, BookChapter, SystemInfo } from './types'

export async function getSystemInfo() {
  return get('/getSystemInfo')
}

export async function getBookshelf(userNameSpace?: string) {
  return get('/getBookshelf', { userNameSpace })
}

export async function getShelfBook(bookUrl: string, userNameSpace?: string) {
  return get('/getShelfBook', { bookUrl, userNameSpace })
}

export async function saveBook(book: Book) {
  return post('/saveBook', book)
}

export async function deleteBook(bookUrl: string) {
  return post('/deleteBook', { bookUrl })
}

export async function deleteBooks(bookUrls: string[]) {
  return post('/deleteBooks', { bookUrls })
}

export async function getBookInfo(bookUrl: string, userNameSpace?: string) {
  return get('/getBookInfo', { url: bookUrl, userNameSpace })
}

export async function getChapterList(bookUrl: string, userNameSpace?: string, refresh?: number) {
  return get('/getChapterList', { url: bookUrl, userNameSpace, refresh })
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

export async function saveBookProgress(bookUrl: string, chapterIndex: number, userNameSpace?: string) {
  return post('/saveBookProgress', { url: bookUrl, index: chapterIndex, userNameSpace })
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
