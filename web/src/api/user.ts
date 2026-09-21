import { get, post } from './http'
import type { User, ReadConfig } from './types'

export async function login(username: string, password: string, isLogin = true) {
  return post('/login', { username, password, isLogin })
}

export async function logout() {
  return post('/logout')
}

export async function getUserInfo(userNameSpace?: string) {
  return get('/getUserInfo', { userNameSpace })
}

export async function getUserList() {
  return get('/getUserList')
}

export async function addUser(
  username: string,
  password: string,
  options?: {
    enableWebdav?: boolean
    enableLocalStore?: boolean
    enableBookSource?: boolean
    enableRssSource?: boolean
    bookSourceLimit?: number
    bookLimit?: number
  }
) {
  return post('/addUser', { username, password, ...options })
}

export async function updateUser(
  username: string,
  updates: Record<string, any>
) {
  return post('/updateUser', { username, ...updates })
}

export async function resetPassword(username: string, password: string) {
  return post('/resetPassword', { username, password })
}

export async function deleteUsers(usernames: string[]) {
  return post('/deleteUsers', { usernames })
}

export async function saveUserConfig(config: Record<string, any>, userNameSpace?: string) {
  return post('/saveUserConfig', { ...config, userNameSpace })
}

export async function getUserConfig(userNameSpace?: string) {
  return get('/getUserConfig', { userNameSpace })
}

export async function downloadBackupFile(userNameSpace?: string) {
  return get('/user/downloadBackupFile', { userNameSpace })
}

export async function clearInactiveUsers(inactiveDay: number) {
  return post('/clearInactiveUsers', { inactiveDay })
}
