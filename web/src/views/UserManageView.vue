<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { Plus, Delete, Lock, Edit, Download } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox, ElTag, ElSwitch } from 'element-plus'
import {
  getUserInfo,
  saveUserConfig as apiSaveUserConfig,
  getUserConfig,
  getUserList,
  addUser,
  deleteUsers,
  updateUser,
  resetPassword,
  downloadBackupFile,
  clearInactiveUsers,
} from '@/api/user'
import { backupToWebdav as apiBackupToWebdav, backupToMongodb as apiBackupToMongodb, restoreFromMongodb as apiRestoreFromMongodb } from '@/api/backup'
import { useNotify } from '@/utils/helpers'
import { useAuthStore } from '@/stores/auth'

const { success, error } = useNotify()
const authStore = useAuthStore()

const userInfo = ref<any>(null)
const userConfig = ref<Record<string, any>>({})
const userList = ref<any[]>([])
const activeTab = ref('profile')
const showAddUser = ref(false)
const newUserForm = ref<Record<string, any>>({})
const loading = ref(false)
const autoClearDays = ref(0)

onMounted(() => {
  loadData()
})

async function loadData() {
  if (authStore.isLoggedIn) {
    const res = await getUserInfo()
    if (res.isSuccess) {
      userInfo.value = res.data?.userInfo
    }
  }
  if (authStore.isManagerMode) {
    loadUserList()
  }
}

async function loadUserList() {
  loading.value = true
  try {
    const res = await getUserList()
    if (res.isSuccess) {
      userList.value = res.data || []
    }
  } finally {
    loading.value = false
  }
}

async function handleAddUser() {
  if (!newUserForm.value.username || !newUserForm.value.password) {
    ElMessage.warning('请填写完整信息')
    return
  }
  const res = await addUser(
    newUserForm.value.username,
    newUserForm.value.password,
    {
      enableWebdav: newUserForm.value.enableWebdav,
      enableLocalStore: newUserForm.value.enableLocalStore,
      enableBookSource: newUserForm.value.enableBookSource,
      enableRssSource: newUserForm.value.enableRssSource,
      bookSourceLimit: newUserForm.value.bookSourceLimit,
      bookLimit: newUserForm.value.bookLimit,
    }
  )
  if (res.isSuccess) {
    ElMessage.success('用户添加成功')
    showAddUser.value = false
    newUserForm.value = {}
    loadUserList()
  } else if (res.errorMsg) {
    error(res.errorMsg)
  }
}

async function handleDeleteUser(usernameVal: string) {
  try {
    await ElMessageBox.confirm(`确定删除用户 ${usernameVal} 吗？`, '提示', { type: 'warning' })
    const res = await deleteUsers([usernameVal])
    if (res.isSuccess) {
      success('删除成功')
      loadUserList()
    }
  } catch { /* cancelled */ }
}

async function handleResetPwd(usernameVal: string) {
  try {
    const { value } = await ElMessageBox.prompt('请输入新密码', '重置密码', {
      inputType: 'password',
      inputValue: '',
    })
    if (value) {
      const res = await resetPassword(usernameVal, value)
      if (res.isSuccess) {
        success('密码重置成功')
      }
    }
  } catch { /* cancelled */ }
}

async function handleUpdateUser(user: any) {
  try {
    const res = await updateUser(user.username, user)
    if (res.isSuccess) {
      success('更新成功')
    }
  } catch { /* cancelled */ }
}

function saveConfig() {
  apiSaveUserConfig(userConfig.value)
  ElMessage.success('已保存')
}

async function downloadBackup() {
  try {
    const res = await downloadBackupFile()
    if (res.isSuccess) {
      const data = res.data as any
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `reader_backup_${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
    }
  } catch {
    error('下载备份失败')
  }
}

async function backupToWebdav() {
  const res = await apiBackupToWebdav(authStore.currentUserNS)
  if (res.isSuccess) {
    success('WebDAV备份完成')
  } else if (res.errorMsg) {
    error(res.errorMsg)
  }
}

async function restoreFromMongoDB() {
  try {
    await ElMessageBox.confirm('确定从MongoDB恢复数据吗？这将覆盖当前数据', '提示', { type: 'warning' })
    const res = await apiRestoreFromMongodb(authStore.currentUserNS)
    if (res.isSuccess) {
      success('恢复完成')
    }
  } catch { /* cancelled */ }
}

async function backupToMongoDB() {
  const res = await apiBackupToMongodb(authStore.currentUserNS)
  if (res.isSuccess) {
    success('MongoDB备份完成')
  }
}

async function handleClearInactiveUsers() {
  if (autoClearDays.value <= 0) {
    ElMessage.warning('请输入清理天数')
    return
  }
  try {
    await ElMessageBox.confirm(
      `确定清理 ${autoClearDays.value} 天未登录的用户吗？`,
      '提示',
      { type: 'warning' }
    )
    const res = await clearInactiveUsers(autoClearDays.value)
    if (res.isSuccess) {
      success('清理完成')
      loadUserList()
    }
  } catch { /* cancelled */ }
}
</script>

<template>
  <div class="user-manage-container">
    <el-tabs v-model="activeTab" type="border-card">
      <el-tab-pane label="个人信息" name="profile">
        <el-descriptions :column="2" border v-if="userInfo">
          <el-descriptions-item label="用户名">{{ userInfo.username }}</el-descriptions-item>
          <el-descriptions-item label="最后登录">{{ userInfo.last_login_at ? new Date(userInfo.last_login_at).toLocaleString() : '-' }}</el-descriptions-item>
          <el-descriptions-item label="WebDAV">{{ userInfo.enable_webdav ? '已开启' : '未开启' }}</el-descriptions-item>
          <el-descriptions-item label="本地书仓">{{ userInfo.enable_local_store ? '已开启' : '未开启' }}</el-descriptions-item>
          <el-descriptions-item label="书源限制">{{ userInfo.book_source_limit || '默认' }}</el-descriptions-item>
          <el-descriptions-item label="书籍限制">{{ userInfo.book_limit || '默认' }}</el-descriptions-item>
          <el-descriptions-item label="创建时间">{{ userInfo.created_at ? new Date(userInfo.created_at).toLocaleString() : '-' }}</el-descriptions-item>
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
          <el-form-item label="自定义规则">
            <el-input v-model="userConfig.replaceRule" type="textarea" />
          </el-form-item>
          <el-form-item>
            <el-button type="primary" @click="saveConfig">保存配置</el-button>
          </el-form-item>
        </el-form>
      </el-tab-pane>

      <el-tab-pane label="用户管理" name="manage" v-if="authStore.isManagerMode">
        <el-row :gutter="20" style="margin-bottom: 16px;">
          <el-col :span="18"><h3>用户列表 ({{ userList.length }} 位)</h3></el-col>
          <el-col :span="6" style="text-align: right;">
            <el-button type="primary" :icon="Plus" @click="showAddUser = true">
              添加用户
            </el-button>
          </el-col>
        </el-row>
        <el-table :data="userList" stripe v-loading="loading">
          <el-table-column prop="username" label="用户名" width="150" />
          <el-table-column prop="created_at" label="创建时间" width="180">
            <template #default="{ row }">
              {{ row.created_at ? new Date(row.created_at).toLocaleString() : '-' }}
            </template>
          </el-table-column>
          <el-table-column prop="last_login_at" label="最后登录" width="180">
            <template #default="{ row }">
              {{ row.last_login_at ? new Date(row.last_login_at).toLocaleString() : '从未登录' }}
            </template>
          </el-table-column>
          <el-table-column label="权限" width="120">
            <template #default="{ row }">
              <el-switch
                v-model="row.enabled"
                :active-value="true"
                :inactive-value="false"
                @change="handleUpdateUser(row)"
              />
            </template>
          </el-table-column>
          <el-table-column label="操作" width="140">
            <template #default="{ row }">
              <el-button text size="small" @click="handleResetPwd(row.username)">
                重置密码
              </el-button>
              <el-button :icon="Delete" type="danger" text size="small" @click="handleDeleteUser(row.username)" />
            </template>
          </el-table-column>
        </el-table>

        <el-divider style="margin: 20px 0;">定期清理不活跃用户</el-divider>
        <el-row :gutter="20">
          <el-col :span="12">
            <el-input-number v-model="autoClearDays" :min="0" :max="365" placeholder="请输入清理天数" />
          </el-col>
          <el-col :span="12">
            <el-button type="danger" @click="handleClearInactiveUsers">
              开始清理
            </el-button>
          </el-col>
        </el-row>
      </el-tab-pane>

      <el-tab-pane label="数据管理" name="data">
        <h3>备份</h3>
        <div style="display: flex; gap: 12px; margin-bottom: 20px;">
          <el-button type="primary" :icon="Download" @click="downloadBackup">
            下载本地备份
          </el-button>
          <el-button :icon="Download" @click="backupToWebdav">
            WebDAV备份
          </el-button>
          <el-button :icon="Download" @click="backupToMongoDB">
            MongoDB备份
          </el-button>
        </div>
        <h3>恢复</h3>
        <div style="display: flex; gap: 12px;">
          <el-button type="warning" :icon="Download" @click="restoreFromMongoDB">
            从MongoDB恢复
          </el-button>
        </div>
      </el-tab-pane>
    </el-tabs>

    <el-dialog v-model="showAddUser" title="添加用户" width="500px" :append-to-body="false">
      <el-form :model="newUserForm" label-width="100px">
        <el-form-item label="用户名">
          <el-input v-model="newUserForm.username" />
        </el-form-item>
        <el-form-item label="密码">
          <el-input v-model="newUserForm.password" type="password" show-password />
        </el-form-item>
        <el-form-item label="书籍限制">
          <el-input-number v-model.number="newUserForm.bookLimit" :min="0" :max="9999" />
        </el-form-item>
        <el-form-item label="书源限制">
          <el-input-number v-model.number="newUserForm.bookSourceLimit" :min="0" :max="99999" />
        </el-form-item>
        <el-form-item label="启用WebDAV">
          <el-switch v-model="newUserForm.enableWebdav" />
        </el-form-item>
        <el-form-item label="启用书源">
          <el-switch v-model="newUserForm.enableBookSource" />
        </el-form-item>
        <el-form-item label="启用本地书仓">
          <el-switch v-model="newUserForm.enableLocalStore" />
        </el-form-item>
        <el-form-item label="启用RSS">
          <el-switch v-model="newUserForm.enableRssSource" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showAddUser = false">取消</el-button>
        <el-button type="primary" @click="handleAddUser">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.user-manage-container {
  padding: 0;
}
</style>
