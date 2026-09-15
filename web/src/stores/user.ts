import { defineStore } from 'pinia'
import { ref } from 'vue'
import { login as apiLogin, logout as apiLogout, getUserInfo } from '@/api/user'
import { useAuthStore } from './auth'

interface UserState {
  currentUser: Record<string, any> | null
  loading: boolean
}

export const useUserStore = defineStore('user', () => {
  const currentUser = ref<Record<string, any> | null>(null)
  const loading = ref(false)
  const authStore = useAuthStore()

  async function handleLogin(username: string, password: string, isLogin = true) {
    loading.value = true
    try {
      const res = await apiLogin(username, password, isLogin)
      if (res.isSuccess) {
        const user = res.data
        authStore.setAuthData(
          user.accessToken?.split(':')[1] || '',
          username,
          '',
          user
        )
        currentUser.value = user
      }
      return res
    } finally {
      loading.value = false
    }
  }

  async function handleLogout() {
    try {
      await apiLogout()
    } finally {
      authStore.clearAuth()
      currentUser.value = null
    }
  }

  async function fetchUserInfo() {
    const res = await getUserInfo()
    if (res.isSuccess) {
      currentUser.value = res.data?.userInfo
    }
    return res
  }

  return { currentUser, loading, handleLogin, handleLogout, fetchUserInfo }
})
