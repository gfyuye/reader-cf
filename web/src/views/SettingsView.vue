<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue'
import { Setting, Lock, Cloudy, Refresh, Warning, Download, Delete } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useAppStore } from '@/stores/app'
import { useAuthStore } from '@/stores/auth'
import { useSettingsStore } from '@/stores/settings'
import { clearInactiveUsers } from '@/api/user'
import { backupToWebdav, backupToMongodb, restoreFromMongodb } from '@/api/backup'

const appStore = useAppStore()
const authStore = useAuthStore()
const settingsStore = useSettingsStore()

const activeSection = ref('general')

const generalSettings = ref({
  showUI: false,
  debug: false,
  cacheChapterContent: true,
  proxy: false,
  proxyType: 'HTTP',
  proxyHost: '',
  proxyPort: '',
})

const securitySettings = ref({
  secure: false,
  secureKey: '',
  inviteCode: '',
  userLimit: 15,
  minUserPasswordLength: 8,
})

const backupSettings = ref({
  autoBackupUserData: false,
  autoClearInactiveUser: 0,
  mongoUri: '',
  mongoDbName: 'reader',
  shelfUpdateInterval: 30,
  remoteBookSourceUpdateInterval: 720,
})

const cacheStats = ref({
  bookSourceList: 0,
  rssSources: 0,
  chapterList: 0,
  chapterContent: 0,
  ttsData: 0,
  total: 0,
})

const loading = ref(false)
const restoring = ref(false)

const appConfig = computed(() => appStore.appConfig)

onMounted(() => {
  loadCacheStats()
})

async function loadCacheStats() {
  // In a real implementation, this would query the backend
  // For now, we read from localStorage
  try {
    const configStr = localStorage.getItem('config')
    const customConfigStr = localStorage.getItem('customConfigList')
    const shelfConfigStr = localStorage.getItem('shelfConfig')
    const searchConfigStr = localStorage.getItem('searchConfig')

    cacheStats.value.total =
      (configStr ? configStr.length : 0) +
      (customConfigStr ? customConfigStr.length : 0) + +
      (shelfConfigStr ? shelfConfigStr.length : 0) +
      (searchConfigStr ? searchConfigStr.length : 0)

    cacheStats.value.total = Math.round(cacheStats.value.total / 1024)
  } catch {
    /* ignore */
  }
}

function clearCache() {
  try {
    localStorage.removeItem('config')
    localStorage.removeItem('customConfigList')
    localStorage.removeItem('shelfConfig')
    localStorage.removeItem('searchConfig')
    localStorage.removeItem('speechVoiceConfig')
    localStorage.removeItem('notAutoSync')
    // Clear bookSourceList, rssSources, chapterList, chapterContent from localforage
    ;(window as any).$cacheStorage?.clear?.()
    cacheStats.value = { bookSourceList: 0, rssSources: 0, chapterList: 0, chapterContent: 0, ttsData: 0, total: 0 }
    ElMessage.success('缓存已清空')
  } catch {
    ElMessage.error('清空失败')
  }
}

async function backupData() {
  loading.value = true
  try {
    await backupToWebdav(authStore.currentUserNS)
    ElMessage.success('WebDAV 备份完成')
  } catch (e: any) {
    ElMessage.error(e.message || '备份失败')
  } finally {
    loading.value = false
  }
}

async function restoreData() {
  restoring.value = true
  try {
    const res = await restoreFromMongodb(authStore.currentUserNS)
    if (res.isSuccess) {
      ElMessage.success('恢复完成')
    } else if (res.errorMsg) {
      ElMessage.error(res.errorMsg)
    }
  } catch {
    ElMessage.error('恢复失败')
  } finally {
    restoring.value = false
  }
}

function syncConfigToStore() {
  settingsStore.setConfig({
    ...generalSettings.value,
    ...securitySettings.value,
  })
}

watch(activeSection, syncConfigToStore)
</script>

<template>
  <div class="settings-container">
    <h2>设置</h2>
    <el-row :gutter="20">
      <el-col :span="8">
        <el-menu :default-active="activeSection" @select="(key: string) => activeSection = key">
          <el-menu-item index="general">
            <el-icon><Setting /></el-icon>
            常规设置
          </el-menu-item>
          <el-menu-item index="security">
            <el-icon><Lock /></el-icon>
            安全设置
          </el-menu-item>
          <el-menu-item index="database">
            <el-icon><Cloudy /></el-icon>
            数据管理
          </el-menu-item>
          <el-menu-item index="cache">
            <el-icon><Refresh /></el-icon>
            缓存管理
          </el-menu-item>
        </el-menu>
      </el-col>
      <el-col :span="16">
        <el-card>
          <template v-if="activeSection === 'general'">
            <h3>常规设置</h3>
            <el-form :model="generalSettings" label-width="140px">
              <el-form-item label="显示界面">
                <el-switch v-model="generalSettings.showUI" />
              </el-form-item>
              <el-form-item label="调试日志">
                <el-switch v-model="generalSettings.debug" />
              </el-form-item>
              <el-form-item label="缓存章节内容">
                <el-switch v-model="generalSettings.cacheChapterContent" />
              </el-form-item>
              <el-form-item label="使用代理">
                <el-switch v-model="generalSettings.proxy" />
              </el-form-item>
              <el-form-item v-if="generalSettings.proxy" label="代理类型">
                <el-select v-model="generalSettings.proxyType" style="width: 200px;">
                  <el-option label="HTTP" value="HTTP" />
                  <el-option label="SOCKS5" value="SOCKS5" />
                </el-select>
              </el-form-item>
              <el-form-item v-if="generalSettings.proxy" label="代理主机">
                <el-input v-model="generalSettings.proxyHost" placeholder="输入代理主机" />
              </el-form-item>
              <el-form-item v-if="generalSettings.proxy" label="代理端口">
                <el-input-number v-model.number="generalSettings.proxyPort" :min="1" :max="65535" />
              </el-form-item>
              <el-form-item label="书架更新间隔(分钟)">
                <el-input-number v-model.number="backupSettings.shelfUpdateInterval" :min="1" :max="1440" />
              </el-form-item>
              <el-form-item label="远程书源订阅间隔(分钟)">
                <el-input-number v-model.number="backupSettings.remoteBookSourceUpdateInterval" :min="0" :max="14400" />
              </el-form-item>
              <el-form-item>
                <el-button type="primary" @click="syncConfigToStore">保存设置</el-button>
              </el-form-item>
            </el-form>
          </template>

          <template v-else-if="activeSection === 'security'">
            <h3>安全设置</h3>
            <el-form :model="securitySettings" label-width="140px">
              <el-form-item label="启用安全模式">
                <el-switch v-model="securitySettings.secure" />
              </el-form-item>
              <el-form-item label="管理密码">
                <el-input v-model="securitySettings.secureKey" type="password" placeholder="设置管理密码" show-password />
              </el-form-item>
              <el-form-item label="注册邀请码">
                <el-input v-model="securitySettings.inviteCode" placeholder="设置邀请码(可选)" />
              </el-form-item>
              <el-form-item label="最大用户数">
                <el-input-number v-model.number="securitySettings.userLimit" :min="1" :max="500000" />
              </el-form-item>
              <el-form-item label="最小密码长度">
                <el-input-number v-model.number="securitySettings.minUserPasswordLength" :min="6" :max="32" />
              </el-form-item>
              <el-form-item>
                <el-button type="primary" @click="syncConfigToStore">保存设置</el-button>
              </el-form-item>
            </el-form>
          </template>

          <template v-else-if="activeSection === 'database'">
            <h3>数据管理</h3>
            <el-form :model="backupSettings" label-width="140px">
              <el-form-item label="自动备份用户数据">
                <el-switch v-model="backupSettings.autoBackupUserData" />
              </el-form-item>
              <el-form-item label="MongoDB URI">
                <el-input v-model="backupSettings.mongoUri" placeholder="MongoDB连接字符串(可选)" />
              </el-form-item>
              <el-form-item label="数据库名称">
                <el-input v-model="backupSettings.mongoDbName" />
              </el-form-item>
              <el-divider>本地备份</el-divider>
              <el-button type="primary" :icon="Download" :loading="loading" @click="backupData">
                立即备份到WebDAV
              </el-button>
              <el-button :icon="Cloudy" :loading="loading" @click="backupToMongodb">
                备份到MongoDB
              </el-button>
              <el-divider>恢复数据</el-divider>
              <el-button type="warning" :icon="Refresh" :loading="restoring" @click="restoreData">
                从MongoDB恢复
              </el-button>
            </el-form>
          </template>

          <template v-else-if="activeSection === 'cache'">
            <h3>缓存管理</h3>
            <el-descriptions :column="2" border>
              <el-descriptions-item label="书源缓存">{{ cacheStats.bookSourceList }}</el-descriptions-item>
              <el-descriptions-item label="RSS缓存">{{ cacheStats.rssSources }}</el-descriptions-item>
              <el-descriptions-item label="章节列表缓存">{{ cacheStats.chapterList }}</el-descriptions-item>
              <el-descriptions-item label="章节内容缓存">{{ cacheStats.chapterContent }}</el-descriptions-item>
              <el-descriptions-item label="TTS缓存">{{ cacheStats.ttsData }}</el-descriptions-item>
              <el-descriptions-item label="总计">{{ cacheStats.total }} KB</el-descriptions-item>
            </el-descriptions>
            <el-divider>
              <el-icon><Warning /></el-icon>
              操作不可逆，请谨慎
            </el-divider>
            <el-button type="danger" :icon="Delete" @click="clearCache">
              清空所有缓存
            </el-button>
          </template>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<style scoped>
.settings-container h2 {
  margin: 0 0 20px 0;
}
.settings-container h3 {
  margin: 0 0 16px 0;
}
</style>

