<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { Plus } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { getUserInfo, saveUserConfig, getUserConfig, getUserList, addUser, deleteUsers, updateUser, resetPassword } from '@/api/user'
import { login as apiLogin } from '@/api/user'
import { useAuthStore } from '@/stores/auth'

const authStore = useAuthStore()
const userInfo = ref<any>(null)
const userConfig = ref<any>({})
const userList = ref<any[]>([])
const activeTab = ref('profile')
const showAddUser = ref(false)
const newUserForm = ref<any>({})
const loading = ref(false)

onMounted(() => { loadData() })

async function loadData() {
  if (authStore.isLoggedIn) {
    const res = await getUserInfo()
    if (res.isSuccess) userInfo.value = res.data?.userInfo
  }
  loadUserList()
}

async function loadUserList() {
  try {
    const res = await getUserList()
    if (res.isSuccess) userList.value = res.data || []
  } catch { /* ignore */ }
}

function saveConfig() {
  saveUserConfig(userConfig.value)
  ElMessage.success('已保存')
}

async function handleAddUser() {
  if (!newUserForm.value.username || !newUserForm.value.password) {
    ElMessage.warning('请填写完整信息')
    return
  }
  const res = await addUser(
    newUserForm.value.username,
    newUserForm.value.password,
    newUserForm.value
  )
  if (res.isSuccess) {
    ElMessage.success('用户添加成功')
    showAddUser.value = false
    newUserForm.value = {}
    loadUserList()
  }
}

async function handleDeleteUser(username: string) {
  // implementation
}

async function handleResetPwd(username: string) {
  // implementation
}
</script>

<template>
  <el-tabs v-model="activeTab" type="border-card">
    <el-tab-pane label="个人信息" name="profile">
      <el-descriptions :column="2" border v-if="userInfo">
        <el-descriptions-item label="用户名">{{ userInfo.username }}</el-descriptions-item>
        <el-descriptions-item label="最后登录">{{ userInfo.lastLoginAt }}</el-descriptions-item>
        <el-descriptions-item label="WebDAV">{{ userInfo.enable_webdav ? '已开启' : '未开启' }}</el-descriptions-item>
        <el-descriptions-item label="书源限制">{{ userInfo.book_source_limit }}</el-descriptions-item>
      </el-descriptions>
    </el-tab-pane>
    <el-tab-pane label="用户配置" name="config">
      <el-form :model="userConfig" label-width="120px">
        <el-form-item label="字体路径">
          <el-input v-model="userConfig.fontPath" />
        </el-form-item>
        <el-form-item label="阅读设置">
          <el-input v-model="userConfig.readSetting" type="textarea" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="saveConfig">保存配置</el-button>
        </el-form-item>
      </el-form>
    </el-tab-pane>
    <el-tab-pane label="用户管理" name="manage" v-if="authStore.secureKey">
      <el-table :data="userList" stripe>
        <el-table-column prop="username" label="用户名" width="150" />
        <el-table-column prop="created_at" label="创建时间" width="180" />
        <el-table-column label="操作">
          <template #default>
            <el-button text size="small" type="danger">删除</el-button>
            <el-button text size="small">重置密码</el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-button type="primary" :icon="Plus" @click="showAddUser = true" style="margin-top: 16px;">添加用户</el-button>
    </el-tab-pane>
  </el-tabs>

  <el-dialog v-model="showAddUser" title="添加用户" width="500px">
    <el-form :model="newUserForm" label-width="100px">
      <el-form-item label="用户名">
        <el-input v-model="newUserForm.username" />
      </el-form-item>
      <el-form-item label="密码">
        <el-input v-model="newUserForm.password" type="password" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="showAddUser = false">取消</el-button>
      <el-button type="primary" @click="handleAddUser">确定</el-button>
    </template>
  </el-dialog>
</template>
