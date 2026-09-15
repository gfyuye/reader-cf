import { get, post } from './http'
import type { RssSource, RssArticle } from './types'

export async function getRssSources() {
  return get('/getRssSources')
}

export async function saveRssSource(source: Partial<RssSource>) {
  return post('/saveRssSource', source)
}

export async function saveRssSources(sources: RssSource[]) {
  return post('/saveRssSources', { sources })
}

export async function deleteRssSource(sourceName: string) {
  return post('/deleteRssSource', { sourceName })
}

export async function getRssArticles(sourceName: string, page?: number) {
  return get('/getRssArticles', { sourceName, page })
}

export async function getRssContent(articleUrl: string) {
  return get('/getRssContent', { url: articleUrl })
}

export async function getRssBookContent(articleUrl: string, chapterUrl?: string) {
  return get('/getRssContent', { url: articleUrl, chapterUrl })
}
