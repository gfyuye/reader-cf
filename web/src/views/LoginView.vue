<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useAuthStore } from '@/stores/auth'
import { login as apiLogin } from '@/api/user'
import { useUserStore } from '@/stores/user'

const router = useRouter()
const authStore = useAuthStore()
const userStore = useUserStore()

const loginForm = reactive({
  username: '',
  password: '',
})
const loginLoading = ref(false)
const loginError = ref('')

async function handleLogin() {
  if (!loginForm.username) {
    loginError.value = '请输入用户名'
    return
  }
  if (!loginForm.password) {
    loginError.value = '请输入密码'
    return
  }

  loginLoading.value = true
  loginError.value = ''
  try {
    const res = await apiLogin(loginForm.username, loginForm.password, true)
    if (res.isSuccess) {
      const user = res.data
      authStore.setAuthData(
        user.accessToken?.split(':')[1] || '',
        loginForm.username,
        ''
      )
      ElMessage.success('登录成功')
      router.push('/')
    } else {
      loginError.value = res.errorMsg || '登录失败'
    }
  } finally {
    loginLoading.value = false
  }
}
</script>

<template>
  <div class="login-container">
    <div class="login-box">
      <div class="login-title">阅读 Reader</div>
      <el-form :model="loginForm" label-position="top" @submit.prevent="handleLogin">
        <el-form-item label="用户名">
          <el-input v-model="loginForm.username" placeholder="请输入用户名" />
        </el-form-item>
        <el-form-item label="密码">
          <el-input v-model="loginForm.password" type="password" placeholder="请输入密码" show-password />
        </el-form-item>
        <div v-if="loginError" class="login-error">{{ loginError }}</div>
        <el-button type="primary" :loading="loginLoading" @click="handleLogin" class="login-btn">
          登录
        </el-button>
      </el-form>
    </div>
  </div>
</template>

<style scoped>
.login-container {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 100vh;
  background: #f0f2f5;
}
.login-box {
  background: #fff;
  padding: 40px;
  border-radius: 12px;
  width: 380px;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.08);
}
.login-title {
  text-align: center;
  font-size: 28px;
  font-weight: bold;
  margin-bottom: 30px;
  color: #303133;
}
.login-error {
  color: #f56c6c;
  font-size: 14px;
  margin-bottom: 12px;
}
.login-btn {
  width: 100%;
  margin-top: 8px;
}
</style>
