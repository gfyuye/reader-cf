import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import axios from 'axios'
import { login as apiLogin, logout as apiLogout, getUserInfo, addUser as apiAddUser, deleteUsers as apiDeleteUsers, updateUser as apiUpdateUser, resetPassword as apiResetPassword, saveUserConfig, getUserConfig } from '@/api/user'
import { ElMessage } from 'element-plus'

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
  const isManagerMode = ref(false)
  const userList = ref<any[]>([])
  const userNS = ref<string>('default')
  const showManagerMode = ref(false)

  const isLoggedIn = computed(() => !!token.value)
  const isSecureMode = computed(() => !!secureKey.value)
  const currentUserNS = computed(() => {
    return isManagerMode.value ? userNS.value : (userInfo.value?.username || 'default')
  })

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
    isManagerMode.value = false
    localStorage.removeItem('accessToken')
    localStorage.removeItem('username')
  }

  function enterManagerMode(key: string) {
    secureKey.value = key
    isManagerMode.value = true
  }

  function exitManagerMode() {
    isManagerMode.value = false
    secureKey.value = ''
  }

  function switchUserNS(ns: string) {
    userNS.value = ns
  }

  function getToken(username: string): string {
    return username ? `${username}:${token.value}` : token.value
  }

  async function login(loginName: string, pwd: string, isLogin = true) {
    try {
      const res = await apiLogin(loginName, pwd, isLogin)
      if (res.isSuccess) {
        const user = res.data
        setAuthData(
          user.accessToken?.split(':')[1] || '',
          loginName,
          user.secureKey || '',
          user
        )
        secureKey.value = user.secureKey || ''
        showManagerMode.value = user.showManagerMode || false
        ElMessage.success('登录成功')
        return res
      } else {
        ElMessage.error(res.errorMsg || '登录失败')
        return res
      }
    } catch (e) {
      ElMessage.error('登录失败')
      throw e
    }
  }

  async function logout() {
    try {
      await apiLogout()
    } finally {
      clearAuth()
      window.location.reload()
    }
  }

  async function fetchUserInfo(userNameSpace?: string) {
    const res = await getUserInfo(userNameSpace)
    if (res.isSuccess) {
      userInfo.value = res.data?.userInfo || null
    }
    return res
  }

  async function fetchUserList() {
    const res = await getUserInfo()
    if (res.isSuccess) {
      userList.value = res.data?.userList || []
    }
    return res
  }

  async function addUser(usernameVal: string, password: string, options?: Record<string, any>) {
    const res = await apiAddUser(usernameVal, password, options)
    if (res.isSuccess) {
      ElMessage.success('用户添加成功')
    } else if (res.errorMsg) {
      ElMessage.error(res.errorMsg)
    }
    return res
  }

  async function deleteUsers(usernames: string[]) {
    const res = await apiDeleteUsers(usernames)
    if (res.isSuccess) {
      ElMessage.success('删除成功')
    }
    return res
  }

  async function updateUser(usernameVal: string, updates: Record<string, any>) {
    const res = await apiUpdateUser(usernameVal, updates)
    if (res.isSuccess) {
      ElMessage.success('更新成功')
    } else if (res.errorMsg) {
      ElMessage.error(res.errorMsg)
    }
    return res
  }

  async function resetPassword(usernameVal: string, password: string) {
    const res = await apiResetPassword(usernameVal, password)
    if (res.isSuccess) {
      ElMessage.success('密码重置成功')
    }
    return res
  }

  async function saveConfig(config: Record<string, any>, userNameSpace?: string) {
    const res = await saveUserConfig(config, userNameSpace)
    if (res.isSuccess) {
      ElMessage.success('保存成功')
    }
    return res
  }

  async function getConfig(userNameNamespace?: string) {
    const res = await getUserConfig(userNameNamespace)
    return res
  }

  return {
    token,
    username,
    userInfo,
    secureKey,
    isManagerMode,
    userList,
    userNS,
    showManagerMode,
    isLoggedIn,
    isSecureMode,
    currentUserNS,
    setAuthData,
    clearAuth,
    enterManagerMode,
    exitManagerMode,
    switchUserNS,
    getToken,
    login,
    logout,
    fetchUserInfo,
    fetchUserList,
    addUser,
    deleteUsers,
    updateUser,
    resetPassword,
    saveConfig,
    getConfig,
  }
})
