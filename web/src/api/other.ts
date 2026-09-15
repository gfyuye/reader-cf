import { get, post } from './http'
import type { Bookmark, BookGroup, ReplaceRule, HttpTTS } from './types'

export async function getBookmarks() {
  return get('/getBookmarks')
}

export async function saveBookmark(bookmark: Partial<Bookmark>) {
  return post('/saveBookmark', bookmark)
}

export async function saveBookmarks(bookmarks: Bookmark[]) {
  return post('/saveBookmarks', { bookmarks })
}

export async function deleteBookmark(bookmark: Partial<Bookmark>) {
  return post('/deleteBookmark', bookmark)
}

export async function deleteBookmarks(bookmarks: Bookmark[]) {
  return post('/deleteBookmarks', { bookmarks })
}

export async function getBookGroups() {
  return get('/getBookGroups')
}

export async function saveBookGroup(group: Partial<BookGroup>) {
  return post('/saveBookGroup', group)
}

export async function deleteBookGroup(groupId: number) {
  return post('/deleteBookGroup', { groupId })
}

export async function saveBookGroupOrder(groups: BookGroup[]) {
  return post('/saveBookGroupOrder', { groups })
}

export async function getReplaceRules() {
  return get('/getReplaceRules')
}

export async function saveReplaceRule(rule: Partial<ReplaceRule>) {
  return post('/saveReplaceRule', rule)
}

export async function saveReplaceRules(rules: ReplaceRule[]) {
  return post('/saveReplaceRules', { rules })
}

export async function deleteReplaceRule(name: string) {
  return post('/deleteReplaceRule', { name })
}

export async function deleteReplaceRules(names: string[]) {
  return post('/deleteReplaceRules', { names })
}

export async function getHttpTTSList() {
  return get('/httpTTS/list')
}

export async function saveHttpTTS(tts: Partial<HttpTTS>) {
  return post('/httpTTS/save', tts)
}

export async function saveHttpTTSList(ttsList: HttpTTS[]) {
  return post('/httpTTS/saveMulti', { ttsList })
}

export async function deleteHttpTTS(id: string) {
  return post('/httpTTS/delete', { id })
}

export async function deleteHttpTTSMulti(ids: string[]) {
  return post('/httpTTS/deleteMulti', { ids })
}
