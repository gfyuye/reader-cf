import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import axios from 'axios'
import dayjs from 'dayjs'

interface User {
  username: string
  password: string
  salt: string
  token: string
  last_login_at: number
  created_at: number
  enable_webdav: boolean
  token_map: Record<string, number> | null
  enable_local_store: boolean
  enable_book_source: boolean
  enable_rss_source: boolean
  book_source_limit: number
  book_limit: number
}

export const useAuthStore = defineStore('auth', () => {
  const token = ref<string>(localStorage.getItem('accessToken') || '')
  const username = ref<string>(localStorage.getItem('username') || '')
  const userInfo = ref<User | null>(null)
  const secureKey = ref<string>('')

  const isLoggedIn = computed(() => !!token.value)

  function setAuthData(accessToken: string, userName: string, secureKeyVal: string, user?: User) {
    token.value = accessToken
    username.value = userName
    secureKey.value = secureKeyVal
    userInfo.value = user || null
    if (accessToken) {
      localStorage.setItem('accessToken', accessToken)
      localStorage.setItem('username', userName)
    } else {
      localStorage.removeItem('accessToken')
      localStorage.removeItem('username')
    }
  }

  function clearAuth() {
    token.value = ''
    username.value = ''
    secureKey.value = ''
    userInfo.value = null
    localStorage.removeItem('accessToken')
    localStorage.removeItem('username')
  }

  function getToken(username: string): string {
    return username ? `${username}:${token.value}` : token.value
  }

  return { token, username, userInfo, secureKey, isLoggedIn, setAuthData, clearAuth, getToken }
})
