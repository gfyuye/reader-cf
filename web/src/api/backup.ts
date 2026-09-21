import { post, get } from './http'

export async function backupToWebdav(userNameSpace?: string) {
  return post('/backupToWebdav', { userNameSpace })
}

export async function backupToMongodb(userNameSpace?: string) {
  return post('/backupToMongodb', { userNameSpace })
}

export async function restoreFromMongodb(userNameSpace?: string) {
  return post('/restoreFromMongodb', { userNameSpace })
}

export async function exportBook(bookUrl: string, fileName?: string, userNameSpace?: string) {
  return post('/exportBook', { bookUrl, fileName, userNameSpace })
}

export async function cacheBookOnServer(bookUrl: string, userNameSpace?: string) {
  return post('/cacheBookOnServer', { bookUrl, userNameSpace })
}

export async function textToSpeech(params: Record<string, any>) {
  return post('/book/tts', params)
}
