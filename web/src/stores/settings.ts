import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import { getCache, setCache } from '@/utils/cache'
import type { ReadConfig } from '@/api/types'

export const defaultDayConfig: ReadConfig = {
  configDefaultType: '白天默认',
  customConfig: '内置白天',
  theme: 0,
  font: 0,
  chineseFont: '简体',
  fontSize: 18,
  fontWeight: 400,
  fontColor: '#262626',
  bodyColor: '#eadfca',
  contentColor: '#fff',
  popupColor: '#ede7da',
  themeType: 'day',
  readMethod: '上下滑动',
  clickMethod: '自动',
  animateMSTime: 300,
  readWidth: 800,
  lineHeight: 1.8,
  paragraphSpace: 0.2,
  autoReadingMethod: '像素滚动',
  autoReadingPixel: 1,
  autoReadingLineTime: 1000,
  pageMode: '自适应',
  selectionAction: '操作弹窗',
  topPadding: 0,
  bottomPadding: 0,
  horizontalPadding: 0,
  epubMode: 'iframe',
  chapterRequestTimeout: 10,
  quickKeyMode: '默认',
  quickKey: {
    ArrowUp: '上一页',
    ArrowDown: '下一页',
    ArrowLeft: '上一章',
    ArrowRight: '下一章',
    Escape: '返回',
    Space: '下半页',
    PageUp: '下一页',
    PageDown: '上一页',
    Home: '首页',
    End: '尾页',
  },
  autoTheme: true,
  pageType: '正常',
  contentBGImg: '',
  isNormalPage: true,
  customFontsMap: {},
}

export const defaultNightConfig: ReadConfig = {
  configDefaultType: '黑夜默认',
  customConfig: '内置黑夜',
  theme: 6,
  font: 0,
  fontSize: 18,
  fontWeight: 400,
  fontColor: '#666666',
  bodyColor: '#121212',
  contentColor: '#171717',
  popupColor: '#121212',
  themeType: 'night',
  readMethod: '上下滑动',
  clickMethod: '自动',
  animateMSTime: 300,
  readWidth: 800,
  lineHeight: 1.8,
  paragraphSpace: 0.2,
  autoReadingMethod: '像素滚动',
  autoReadingPixel: 1,
  autoReadingLineTime: 1000,
  pageMode: '自适应',
  selectionAction: '操作弹窗',
  topPadding: 0,
  bottomPadding: 0,
  horizontalPadding: 0,
  epubMode: 'iframe',
  chapterRequestTimeout: 10,
  quickKeyMode: '默认',
  quickKey: {
    ArrowUp: '上一页',
    ArrowDown: '下一页',
    ArrowLeft: '上一章',
    ArrowRight: '下一章',
    Escape: '返回',
    Space: '下半页',
    PageUp: '下一页',
    PageDown: '上一页',
    Home: '首页',
    End: '尾页',
  },
  autoTheme: true,
  pageType: '正常',
  contentBGImg: '',
  isNormalPage: true,
  customFontsMap: {},
}

export const defaultShelfConfig = {
  showBookGroup: -1,
  viewCate: 'list',
  bookOrder: 'durChapterTime',
  imageProxy: 'noProxy',
  virtualOptimize: 'yes',
  miniInterface: false,
  isKindlePage: false,
}

export const defaultSearchConfig = {
  searchType: 'multi',
  bookSourceGroup: '',
  bookSourceUrl: '',
  concurrentCount: 24,
}

export const themes = [
  { body: '#eadfca', content: '#fff', popup: '#ede7da' },
  { body: '#f2e8e0', content: '#fff', popup: '#ede7da' },
  { body: '#e8f0e0', content: '#fff', popup: '#ede7da' },
  { body: '#e0eaff', content: '#fff', popup: '#ede7da' },
  { body: '#ebcece', content: '#f5e4e4', popup: '#faeceb' },
  { body: '#121212', content: '#171717', popup: '#121212' },
  { body: '#f7f7f7', content: '#fff', popup: '#f7f7f7' },
]

export const fonts = [
  { name: '跟随系统', fontFamily: 'custom-system' },
  { name: '黑体', fontFamily: 'custom-ht, reader-ht' },
  { name: '楷体', fontFamily: 'custom-kt, reader-kt' },
  { name: '宋体', fontFamily: 'custom-st, reader-st' },
  { name: '仿宋', fontFamily: 'custom-fs, reader-fs' },
]

export const customFonts = ['custom-system', 'custom-ht', 'custom-kt', 'custom-st', 'custom-fs']

export const syncConfigFiled = Object.keys(defaultDayConfig).concat(['contentBGImg'])

export const useSettingsStore = defineStore('settings', () => {
  const config = ref<ReadConfig>({ ...defaultDayConfig })
  const customConfigList = ref<ReadConfig[]>([
    { ...defaultDayConfig },
    { ...defaultNightConfig },
  ])
  const shelfConfig = ref({ ...defaultShelfConfig })
  const searchConfig = ref({ ...defaultSearchConfig })
  const speechVoiceConfig = ref({
    ttsType: 'local',
    cacheTTSAudio: false,
    voiceName: '',
    speechRate: 1,
    speechPitch: 1,
  })
  const loadedCustomFonts = ref<Record<string, string>>({})

  const currentTheme = computed(() => {
    const themeIndex = typeof config.value.theme === 'number' ? config.value.theme : 0
    return themes[themeIndex] || themes[0]
  })

  const isNight = computed(() => config.value.themeType === 'night')

  const bodyBg = computed(() => {
    if (config.value.theme === 'custom') {
      return config.value.bodyColor || currentTheme.value.body
    }
    const theme = currentTheme.value
    return config.value.themeType === 'night' ? theme.body : theme.body
  })

  const contentBg = computed(() => {
    if (config.value.theme === 'custom') {
      return config.value.contentColor || currentTheme.value.content
    }
    return currentTheme.value.content
  })

  const popupBg = computed(() => {
    if (config.value.theme === 'custom') {
      return config.value.popupColor || currentTheme.value.popup
    }
    return currentTheme.value.popup
  })

  const currentFontFamily = computed(() => {
    return fonts[config.value.font || 0]?.fontFamily || 'custom-system'
  })

  // API 根路径 - 用于加载自定义字体等资源
  const apiRoot = computed(() => {
    // 可以根据实际部署情况调整
    return ''
  })

  function setConfig(newConfig: Partial<ReadConfig>, save = true) {
    config.value = { ...config.value, ...newConfig }
    if (save) {
      setCache('config', JSON.stringify(config.value))
    }
  }

  function setNightTheme(isNight: boolean) {
    const themeConfig = customConfigList.value.find(
      (v) => v.configDefaultType === (isNight ? '黑夜默认' : '白天默认')
    )
    if (themeConfig) {
      setConfig({ ...themeConfig, customConfig: themeConfig.customConfig })
    }
  }

  function setCustomConfig(configName: string) {
    const found = customConfigList.value.find((v) => v.customConfig === configName || v.name === configName)
    if (found) {
      setConfig({ ...found, customConfig: found.customConfig || found.name })
    }
  }

  function addCustomConfig(customConfig: ReadConfig) {
    customConfigList.value = [...customConfigList.value, { ...customConfig }]
    setCache('customConfigList', JSON.stringify(customConfigList.value))
  }

  function setCustomConfigList(list: ReadConfig[]) {
    customConfigList.value = [...list]
    setCache('customConfigList', JSON.stringify(list))
  }

  function setShelfConfig(newConfig: Partial<typeof defaultShelfConfig>) {
    shelfConfig.value = { ...shelfConfig.value, ...newConfig }
    setCache('shelfConfig', JSON.stringify(shelfConfig.value))
  }

  function setSearchConfig(newConfig: Partial<typeof defaultSearchConfig>) {
    searchConfig.value = { ...searchConfig.value, ...newConfig }
    setCache('searchConfig', JSON.stringify(searchConfig.value))
  }

  function setSpeechVoiceConfig(newConfig: Partial<typeof speechVoiceConfig.value>) {
    speechVoiceConfig.value = { ...speechVoiceConfig.value, ...newConfig }
    setCache('speechVoiceConfig', JSON.stringify(speechVoiceConfig.value))
  }

  function syncFromLocalStorage() {
    try {
      const cachedConfig = getCache('config')
      if (cachedConfig && typeof cachedConfig === 'object') {
        setConfig({ ...defaultDayConfig, ...cachedConfig }, false)
      }
      const cachedCustomConfigList = getCache('customConfigList')
      if (cachedCustomConfigList && Array.isArray(cachedCustomConfigList)) {
        setCustomConfigList(cachedCustomConfigList)
      } else {
        setCustomConfigList([
          { ...defaultDayConfig },
          { ...defaultNightConfig },
        ])
      }
      const cachedShelfConfig = getCache('shelfConfig')
      if (cachedShelfConfig && typeof cachedShelfConfig === 'object') {
        setShelfConfig({ ...defaultShelfConfig, ...cachedShelfConfig })
      }
      const cachedSearchConfig = getCache('searchConfig')
      if (cachedSearchConfig && typeof cachedSearchConfig === 'object') {
        setSearchConfig({ ...defaultSearchConfig, ...cachedSearchConfig })
      }
      const cachedSpeechVoiceConfig = getCache('speechVoiceConfig')
      if (cachedSpeechVoiceConfig && typeof cachedSpeechVoiceConfig === 'object') {
        setSpeechVoiceConfig({ ...speechVoiceConfig.value, ...cachedSpeechVoiceConfig })
      }
    } catch {
      /* ignore */
    }
  }

  return {
    config,
    customConfigList,
    shelfConfig,
    searchConfig,
    speechVoiceConfig,
    currentTheme,
    isNight,
    bodyBg,
    contentBg,
    popupBg,
    currentFontFamily,
    apiRoot,
    defaultDayConfig,
    defaultNightConfig,
    themes,
    fonts,
    customFonts,
    setConfig,
    setNightTheme,
    setCustomConfig,
    addCustomConfig,
    setCustomConfigList,
    setShelfConfig,
    setSearchConfig,
    setSpeechVoiceConfig,
    syncFromLocalStorage,
  }
})
