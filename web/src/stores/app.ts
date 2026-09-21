import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import axios from 'axios'
import dayjs from 'dayjs'

export interface AppConfig {
  showUI: boolean
  debug: boolean
  packaged: boolean
  secure: boolean
  inviteCode: string
  secureKey: string
  cacheChapterContent: boolean
  userLimit: number
  userBookLimit: number
  debugLog: boolean
  autoClearInactiveUser: number
  mongoUri: string
  mongoDbName: string
  shelfUpdateInteval: number
  remoteWebviewApi: string
  defaultUserEnableWebdav: boolean
  defaultUserEnableLocalStore: boolean
  defaultUserEnableBookSource: boolean
  defaultUserEnableRssSource: boolean
  defaultUserBookSourceLimit: number
  defaultUserBookLimit: number
  autoBackupUserData: boolean
  minUserPasswordLength: number
  remoteBookSourceUpdateInterval: number
  serverPort: number
  serverContextPath: string
  webUrl: string
}

export interface SystemInfo {
  fonts: string
  freeMemory: string
  totalMemory: string
  maxMemory: string
  dayRegisterUser: number
  dayLoginUser: number
  sevenDayRegisterUser: number
  sevenDayLoginUser: number
  monthRegisterUser: number
  monthLoginUser: number
  keepUser: number
}

export const useAppStore = defineStore('app', () => {
  const appConfig = ref<Partial<AppConfig>>({})
  const systemInfo = ref<SystemInfo | null>(null)
  const appReady = ref(false)
  const workDir = ref('')
  const isSecureMode = ref(false)
  const showUI = ref(false)

  const baseURL = computed(() => {
    const ctxPath = appConfig.value.serverContextPath || ''
    return `/reader3`
  })

  async function initApp() {
    try {
      const configRes = await axios.get(`${baseURL.value}/getSystemInfo`)
      if (configRes.data?.isSuccess) {
        systemInfo.value = configRes.data.data
      }
      appReady.value = true
    } catch {
      appReady.value = true
    }
  }

  async function loadConfig() {
    try {
      const res = await axios.get(`${baseURL.value}/getSystemInfo`)
      if (res.data?.isSuccess) {
        systemInfo.value = res.data.data
      }
    } catch {
      /* ignore */
    }
  }

  function setConfig(config: Partial<AppConfig>) {
    appConfig.value = { ...appConfig.value, ...config }
  }

  return { appConfig, systemInfo, appReady, workDir, isSecureMode, showUI, baseURL, initApp, loadConfig, setConfig }
})
