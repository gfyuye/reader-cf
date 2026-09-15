import { get, post } from './http'
import type { BookSource, BookGroup, Book } from './types'

export async function getBookSources(userNameSpace?: string) {
  return get('/getBookSources', { userNameSpace })
}

export async function saveBookSource(bookSource: Partial<BookSource>, userNameSpace?: string) {
  return post('/saveBookSource', { bookSource, userNameSpace })
}

export async function saveBookSources(sources: BookSource[], userNameSpace?: string) {
  return post('/saveBookSources', { sources, userNameSpace })
}

export async function deleteBookSource(sourceUrl: string, userNameSpace?: string) {
  return post('/deleteBookSource', { sourceUrl, userNameSpace })
}

export async function deleteAllBookSources(userNameSpace?: string) {
  return post('/deleteAllBookSources', { userNameSpace })
}

export async function readSourceFile(file: File) {
  const formData = new FormData()
  formData.append('file', file)
  return post('/readSourceFile', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
}

export async function saveFromRemoteSource(sourceUrl: string, userNameSpace?: string) {
  return post('/saveFromRemoteSource', { sourceUrl, userNameSpace })
}

export async function setAsDefaultBookSources(sourceUrls: string[], userNameSpace?: string) {
  return post('/setAsDefaultBookSources', { sourceUrls, userNameSpace })
}

export async function deleteUserBookSource(sourceUrl: string, userNameSpace?: string) {
  return post('/deleteUserBookSource', { sourceUrl, userNameSpace })
}

export async function bookSourceDebug(
  bookUrl: string,
  bookSource: string,
  userNameSpace?: string
) {
  return get('/bookSourceDebugSSE', { url: bookUrl, bookSource, userNameSpace })
}

export async function getBookSourceMap(userNameSpace?: string) {
  return get('/getBookSources', { userNameSpace })
}

export async function getBookSourceString(sourceUrl: string): Promise<string | null> {
  const res = await getBookSources()
  if (!res?.isSuccess) return null
  const sources = res.data as BookSource[]
  const source = sources.find((s: BookSource) => s.bookSourceUrl === sourceUrl)
  return source ? JSON.stringify(source) : null
}

export async function updateRemoteSourceSub(userNameSpace?: string) {
  return post('/saveFromRemoteSource', { userNameSpace })
}
