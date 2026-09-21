<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  ArrowLeft,
  ArrowRight,
  Menu,
  Setting as SettingIcon,
  Share,
  Loading,
  Microphone,
  Star as Bookmark,
  CaretTop,
  CaretBottom,
  Expand,
  Fold,
  Download,
  Delete,
  Cpu,
  Link,
  Headset,
  FolderOpened,
} from '@element-plus/icons-vue'
import { ElMessage, ElTooltip } from 'element-plus'
import {
  getShelfBook,
  getChapterList,
  getBookContent,
  saveBookProgress,
  setBookSource,
  getAvailableBookSource,
  saveBookConfig,
  getBookConfig,
} from '@/api/book'
import { useSettingsStore, fonts } from '@/stores/settings'
import { useAuthStore } from '@/stores/auth'
import { useBookmarkStore } from '@/stores/bookmark'
import { cacheFirstRequest, isMiniInterface } from '@/utils/helpers'
import ChapterCatalog from '@/components/Reader/ChapterCatalog.vue'
import ReadSettings from '@/components/Reader/ReadSettings.vue'
import BookSourceSwitch from '@/components/Reader/BookSourceSwitch.vue'
import TextSelectMenu from '@/components/Reader/TextSelectMenu.vue'
import Content from '@/components/Reader/Content.vue'
import type { Book, BookChapter } from '@/api/types'
import { ttsVoiceList } from '@/plugins/ttsVoices'

const route = useRoute()
const router = useRouter()
const settingsStore = useSettingsStore()
const authStore = useAuthStore()
const bookmarkStore = useBookmarkStore()

const bookUrl = computed(() => route.params.bookUrl as string)
const currentBook = ref<Book | null>(null)
const chapters = ref<BookChapter[]>([])
const currentChapterIndex = ref(0)
const content = ref('')
const loading = ref(false)
const tocVisible = ref(false)
const settingsVisible = ref(false)
const sourceSwitchVisible = ref(false)
const showTextMenu = ref(false)
const textSelectData = ref<{
  text: string
  x: number
  y: number
  chapterIndex: number
  chapterPos: number
} | null>(null)

const showCacheMenu = ref(false)

const isChapterLoading = ref(false)
const showToolbar = ref(true)
const isFullScreen = ref(false)
const speechSynthesisAvailable = ref(false)
const speechVoices: any[] = []
const speaking = ref(false)

// TTS 下拉菜单状态
const ttsType = ref<'local' | 'edge' | 'httpTTS'>('local')
const selectedDialect = ref('全部')
const localVoices = ref<SpeechSynthesisVoice[]>([])
const ttsList = ref<any[]>([])

const ttsTypes = [
  { label: '本地浏览器', value: 'local' },
  { label: 'Edge TTS', value: 'edge' },
  { label: 'HttpTTS', value: 'httpTTS' },
]

const quickKeyModes = [
  { label: '默认', value: '默认' },
  { label: '自定义', value: '自定义' },
]

const quickKeyConfig = ref({
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
})

const edgeDialects = computed(() => {
  const ds = new Set<string>()
  ttsVoiceList.forEach(v => ds.add(v.dialect))
  return ['全部', ...Array.from(ds).sort()]
})

const filteredVoices = computed(() => {
  if (ttsType.value === 'local') {
    return localVoices.value
  }
  if (ttsType.value === 'edge') {
    if (!selectedDialect.value || selectedDialect.value === '全部') return ttsVoiceList
    return ttsVoiceList.filter(v => v.dialect === selectedDialect.value)
  }
  return []
})

const voiceOptions = computed(() => {
  return filteredVoices.value.map(v => ({
    label: ttsType.value === 'edge' ? `${(v as any).LocalName} (${(v as any).name})` : `${(v as any).name}`,
    value: (v as any).name,
  }))
})

function fetchLocalVoices() {
  if (!('speechSynthesis' in window)) return
  try {
    localVoices.value = window.speechSynthesis.getVoices()
  } catch { /* ignore */ }
  if ('onvoiceschanged' in window.speechSynthesis) {
    ;(window.speechSynthesis as any).onvoiceschanged = () => {
      try {
        localVoices.value = window.speechSynthesis.getVoices()
      } catch { /* ignore */ }
    }
  }
}

function selectVoice(name: string) {
  settingsStore.setSpeechVoiceConfig({ voiceName: name })
}

async function loadTTSList() {
  try {
    const { getHttpTTSList } = await import('@/api/other')
    const res = await getHttpTTSList()
    if (res.isSuccess) {
      ttsList.value = res.data || []
    }
  } catch { /* ignore */ }
}

function handleTTSCommand(cmd: string) {
  if (cmd === 'play') {
    handleTTS(content.value)
    return
  }
  if (cmd === 'pause') {
    window.speechSynthesis.cancel()
    speaking.value = false
    return
  }
  if (cmd.startsWith('tts-')) {
    const type = cmd.replace('tts-', '') as 'local' | 'edge' | 'httpTTS'
    ttsType.value = type
    settingsStore.setSpeechVoiceConfig({ ttsType: type })
    if (type === 'httpTTS') loadTTSList()
    return
  }
  if (cmd.startsWith('dialect-')) {
    selectedDialect.value = cmd.replace('dialect-', '')
    return
  }
  if (cmd.startsWith('voice-')) {
    const name = cmd.replace('voice-', '')
    selectVoice(name)
    return
  }
}

function handleKeyDown(e: KeyboardEvent) {
  const target = e.target as HTMLElement
  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
    return
  }

  const key = e.key
  const action = quickKeyConfig.value[key as keyof typeof quickKeyConfig.value]
  
  if (!action) return

  switch (action) {
    case '上一页':
      e.preventDefault()
      prevChapter()
      break
    case '下一页':
      e.preventDefault()
      nextChapter()
      break
    case '上一章':
      e.preventDefault()
      prevChapter()
      break
    case '下一章':
      e.preventDefault()
      nextChapter()
      break
    case '返回':
      e.preventDefault()
      router.push('/bookshelf')
      break
    case '下半页':
      e.preventDefault()
      const contentEl = document.querySelector('.reader-content')
      if (contentEl) {
        contentEl.scrollBy({ top: contentEl.clientHeight / 2, behavior: 'smooth' })
      }
      break
    case '首页':
      e.preventDefault()
      loadChapter(0)
      break
    case '尾页':
      e.preventDefault()
      loadChapter(chapters.value.length - 1)
      break
  }
}

const progressSaveTimer = ref<ReturnType<typeof setTimeout> | null>(null)
const chapterContentCache = ref<Map<number, string>>(new Map())
const preloadingChapters = ref<Set<number>>(new Set())
const isCachingContent = ref(false)
const cachingContentTip = ref('')
const cacheContentCount = ref(0)
const targetCacheCount = ref(0)

// ============ 计算属性 ============
const readerTheme = computed(() => ({
  '--reader-bg': isNight.value ? '#121212' : '#f5f7fa',
  '--reader-content-bg': isNight.value ? '#171717' : '#fff',
  '--reader-text-color': isNight.value ? '#ccc' : '#303133',
  '--border-light': isNight.value ? '#2a2a2a' : '#e4e7ed',
}))

const isNight = computed(() => settingsStore.isNight)

const chapterClass = computed(() => {
  if (isSlideRead.value) return 'slide-mode'
  if (isScrollRead.value) return 'scroll-mode'
  if (isPageMode.value) return 'page-mode'
  return 'auto-mode'
})

const isSlideRead = computed(() => settingsStore.config?.readMethod === '左右滑动')
const isScrollRead = computed(() => 
  settingsStore.config?.readMethod === '上下滚动' || settingsStore.config?.readMethod === '上下滚动2'
)
const isPageMode = computed(() => !isSlideRead.value && !isScrollRead.value)
const isAutoReading = computed(() => settingsStore.config?.readMethod === '自动阅读')
const isEpubIframe = computed(() => settingsStore.config?.epubMode === 'iframe')

const currentChapter = computed(() => chapters.value[currentChapterIndex.value] || null)

const readConfig = computed(() => ({
  fontSize: settingsStore.config?.fontSize || 16,
  lineHeight: settingsStore.config?.lineHeight || 1.8,
  fontFamily: settingsStore.config?.fontFamily || 'custom-system',
  fontColor: settingsStore.config?.fontColor,
  themeType: isNight.value ? 'night' : 'day',
  readWidth: settingsStore.config?.readWidth || 800,
  topPadding: settingsStore.config?.topPadding || 0,
  bottomPadding: settingsStore.config?.bottomPadding || 0,
  horizontalPadding: settingsStore.config?.horizontalPadding || 20,
  paragraphSpace: settingsStore.config?.paragraphSpace || 0.2,
  animateMSTime: settingsStore.config?.animateMSTime || 300,
}))

// ============ 核心方法 ============
function checkSpeechSynthesis() {
  speechSynthesisAvailable.value = typeof window !== 'undefined' && !!window.speechSynthesis
  if (speechSynthesisAvailable.value) {
    speechVoices.push(...window.speechSynthesis.getVoices())
    if ('onvoiceschanged' in window.speechSynthesis) {
      ;(window.speechSynthesis as any).onvoiceschanged = () => {
        speechVoices.length = 0
        speechVoices.push(...window.speechSynthesis!.getVoices())
      }
    }
  }
}

function handleScroll() {
  // 滚动处理逻辑
}

function updateClickZones() {
  // 更新点击区域
}

async function loadBook() {
  if (!bookUrl.value) return
  loading.value = true
  try {
    const bookRes = await cacheFirstRequest(
      () => getShelfBook(bookUrl.value, userNameSpace.value),
      'book_' + bookUrl.value
    )
    if (bookRes.data?.isSuccess && bookRes.data.data) {
      currentBook.value = bookRes.data.data
      if (currentBook.value) {
        await saveBookProgress(bookUrl.value, currentBook.value.durChapterIndex || 0, userNameSpace.value)
      }

      const chapterRes = await cacheFirstRequest(
        () => getChapterList(bookUrl.value, userNameSpace.value),
        'chapters_' + bookUrl.value
      )
      if (chapterRes.data?.isSuccess) {
        chapters.value = (chapterRes.data.data as BookChapter[]) || []
        const startIdx = currentBook.value?.durChapterIndex || 0
        if (chapters.value.length > 0) {
          await loadChapter(startIdx)
        }
      }
    }
  } catch (e) {
    console.error(e)
    ElMessage.error('加载书籍失败')
  } finally {
    loading.value = false
  }
}

async function loadChapter(index: number) {
  if (index < 0 || index >= chapters.value.length) return
  currentChapterIndex.value = index
  const chapter = chapters.value[index]
  if (!chapter) return

  isChapterLoading.value = true
  try {
    // 检查缓存
    if (chapterContentCache.value.has(index)) {
      content.value = chapterContentCache.value.get(index)!
      isChapterLoading.value = false
      return
    }

    const res = await getBookContent(chapter.chapterUrl || chapter.link || '', userNameSpace.value)
    if (res.isSuccess) {
      content.value = res.data
      chapterContentCache.value.set(index, res.data)
      preloadingChapters.value.add(index)
    } else {
      content.value = res.errorMsg || '加载失败'
    }
  } catch (e) {
    content.value = '加载失败: ' + (e as Error).message
  } finally {
    isChapterLoading.value = false
  }
}

function saveProgress() {
  if (currentBook.value && chapters.value.length > 0) {
    if (progressSaveTimer.value) {
      clearTimeout(progressSaveTimer.value)
    }
    progressSaveTimer.value = setTimeout(() => {
      saveBookProgress(bookUrl.value, currentChapterIndex.value, userNameSpace.value)
        .then(() => {
          if (currentBook.value) {
            currentBook.value.durChapterIndex = currentChapterIndex.value
            const chapter = chapters.value[currentChapterIndex.value]
            if (chapter) {
              currentBook.value.durChapterTitle = chapter.name
              currentBook.value.durChapterTime = Date.now()
            }
          }
        })
        .catch(console.error)
    }, 1000)
  }
}

function prevChapter() {
  if (currentChapterIndex.value > 0) {
    loadChapter(currentChapterIndex.value - 1)
  } else {
    ElMessage.info('已经是第一章')
  }
}

function nextChapter() {
  if (currentChapterIndex.value < chapters.value.length - 1) {
    loadChapter(currentChapterIndex.value + 1)
  } else {
    ElMessage.info('已经是最后一章')
  }
}

function goToTop() {
  const contentEl = document.querySelector('.reader-content')
  if (contentEl) {
    contentEl.scrollTo({ top: 0, behavior: 'smooth' })
  }
}

function goToBottom() {
  const contentEl = document.querySelector('.reader-content')
  if (contentEl) {
    contentEl.scrollTo({ top: contentEl.scrollHeight, behavior: 'smooth' })
  }
}

function handleTTS(text: string) {
  if (!speechSynthesisAvailable.value) {
    ElMessage.warning('浏览器不支持语音合成')
    return
  }
  if (speaking.value) {
    window.speechSynthesis.cancel()
    speaking.value = false
  } else {
    const utter = new SpeechSynthesisUtterance(text)
    const voiceConfig = settingsStore.speechVoiceConfig
    if (voiceConfig.speechRate) utter.rate = voiceConfig.speechRate
    if (voiceConfig.speechPitch) utter.pitch = voiceConfig.speechPitch
    if (voiceConfig.voiceName) {
      const voice = window.speechSynthesis.getVoices().find(v => v.name === voiceConfig.voiceName)
      if (voice) utter.voice = voice
    }
    utter.onend = () => {
      speaking.value = false
    }
    window.speechSynthesis.speak(utter)
    speaking.value = true
  }
}

function handleTextSelection(e: MouseEvent) {
  const selection = window.getSelection()
  if (selection && selection.toString().trim()) {
    const range = selection.getRangeAt(0)
    const rect = range.getBoundingClientRect()
    const chapter = chapters.value[currentChapterIndex.value]
    textSelectData.value = {
      text: selection.toString(),
      x: e.clientX,
      y: e.clientY,
      chapterIndex: currentChapterIndex.value,
      chapterPos: 0,
    }
    showTextMenu.value = true
  }
}

function closeTextMenu() {
  showTextMenu.value = false
  textSelectData.value = null
}

function handleTouchStart(e: TouchEvent) {
  // 触摸开始
}

function handleTouchMove(e: TouchEvent) {
  // 触摸移动
}

function handleTouchEnd() {
  // 触摸结束
}

function handleClick(e: MouseEvent) {
  // 点击处理
}

function handleCacheCommand(cmd: string) {
  if (cmd === 'cache50') {
    cacheChapters(50)
  } else if (cmd === 'cache100') {
    cacheChapters(100)
  } else if (cmd === 'cacheAll') {
    cacheChapters(chapters.value.length)
  } else if (cmd === 'clearCache') {
    chapterContentCache.value.clear()
    ElMessage.success('缓存已清空')
  }
}

async function cacheChapters(count: number) {
  isCachingContent.value = true
  targetCacheCount.value = Math.min(count, chapters.value.length - currentChapterIndex.value - 1)
  cacheContentCount.value = 0
  cachingContentTip.value = '开始缓存...'

  for (let i = 1; i <= targetCacheCount.value; i++) {
    const idx = currentChapterIndex.value + i
    if (idx >= chapters.value.length) break
    
    cachingContentTip.value = `正在缓存第 ${idx + 1} 章...`
    const chapter = chapters.value[idx]
    if (chapter && !chapterContentCache.value.has(idx)) {
      try {
        const res = await getBookContent(chapter.chapterUrl || chapter.link || '', userNameSpace.value)
        if (res.isSuccess) {
          chapterContentCache.value.set(idx, res.data)
        }
      } catch (e) {
        console.error('缓存失败', e)
      }
    }
    cacheContentCount.value++
  }
  isCachingContent.value = false
  cachingContentTip.value = '缓存完成'
}

function cancelCaching() {
  isCachingContent.value = false
}

function handleChapterJump(index: number) {
  loadChapter(index)
  tocVisible.value = isMiniInterface() ? false : tocVisible.value
}

function toggleToc() {
  tocVisible.value = !tocVisible.value
}

function toggleSettings() {
  settingsVisible.value = !settingsVisible.value
}

function toggleSourceSwitch() {
  sourceSwitchVisible.value = !sourceSwitchVisible.value
}

function toggleFullScreen() {
  isFullScreen.value = !isFullScreen.value
}

function handleSaveConfig(config: any) {
  // 保存阅读配置
  ElMessage.success('配置已保存')
}

function handleSettingsClose() {
  settingsVisible.value = false
}

function getChapterIframeSrc(chapter: any) {
  return chapter.chapterUrl || chapter.link
}

function onIframeLoad() {
  isChapterLoading.value = false
}

// 预加载后续章节
function preloadNextChapters() {
  const maxPreload = 3
  for (let i = 1; i <= maxPreload; i++) {
    const idx = currentChapterIndex.value + i
    if (idx < chapters.value.length && !preloadingChapters.value.has(idx)) {
      preloadingChapters.value.add(idx)
      getBookContent(chapters.value[idx].chapterUrl || chapters.value[idx].link || '', userNameSpace.value)
        .then(res => {
          if (res.isSuccess) {
            chapterContentCache.value.set(idx, res.data)
          }
        })
        .catch(() => {})
    }
  }
}

const userNameSpace = computed(() => authStore.currentUserNS)

onMounted(() => {
  settingsStore.syncFromLocalStorage()
  checkSpeechSynthesis()
  fetchLocalVoices()
  loadTTSList()
  window.addEventListener('scroll', handleScroll)
  window.addEventListener('keydown', handleKeyDown)
  loadBook()
})

onBeforeUnmount(() => {
  window.removeEventListener('scroll', handleScroll)
  window.removeEventListener('keydown', handleKeyDown)
  window.removeEventListener('resize', updateClickZones)
  if (progressSaveTimer.value) {
    clearTimeout(progressSaveTimer.value)
  }
  saveProgress()
})
</script>

<template>
  <div
    v-if="currentBook"
    class="reader-page"
    :style="readerTheme"
    :class="{ night: isNight, [chapterClass]: true }"
  >
    <!-- Top toolbar -->
    <div class="reader-toolbar" :class="{ hidden: !showToolbar }">
      <div class="toolbar-left">
        <el-button type="text" :icon="ArrowLeft" @click="$router.push('/bookshelf')">
          返回书架
        </el-button>
      </div>
      <div class="toolbar-center">
        <span class="book-title">{{ currentBook.name }}</span>
        <span class="book-author"> / {{ currentBook.author }}</span>
      </div>
      <div class="toolbar-right">
        <ElTooltip content="目录" placement="top">
          <el-button type="text" :icon="Menu" @click="toggleToc" />
        </ElTooltip>
        <ElTooltip content="换源" placement="top">
          <el-button type="text" :icon="Share" @click="toggleSourceSwitch" />
        </ElTooltip>
        <ElTooltip content="缓存章节" placement="top">
          <el-dropdown @command="handleCacheCommand" trigger="click">
            <el-button type="text" :icon="Download" />
            <template #dropdown>
              <el-menu>
                <el-menu-item command="cache50" :disabled="chapters.length - currentChapterIndex - 1 <= 0">
                  <el-icon><Download /></el-icon>
                  缓存后 50 章
                </el-menu-item>
                <el-menu-item command="cache100" :disabled="chapters.length - currentChapterIndex - 1 <= 0">
                  <el-icon><Download /></el-icon>
                  缓存后 100 章
                </el-menu-item>
                <el-menu-item command="cacheAll" :disabled="chapters.length - currentChapterIndex - 1 <= 0">
                  <el-icon><Download /></el-icon>
                  缓存后续全部
                </el-menu-item>
                <el-menu-item command="clearCache" divided>
                  <el-icon><Delete /></el-icon>
                  清空本地缓存
                </el-menu-item>
              </el-menu>
            </template>
          </el-dropdown>
        </ElTooltip>
        <ElTooltip content="朗读" placement="top">
          <el-dropdown @command="handleTTSCommand" trigger="click">
            <el-button type="text" :icon="Microphone" />
            <template #dropdown>
              <el-menu>
                <el-menu-item command="play" :disabled="speaking">
                  <el-icon><Microphone /></el-icon>
                  <span v-if="speaking">正在朗读...</span>
                  <span v-else>开始朗读</span>
                </el-menu-item>
                <el-menu-item command="pause" v-if="speaking">
                  <el-icon><Microphone /></el-icon>
                  暂停朗读
                </el-menu-item>
                <el-menu-item disabled divided>
                  <span class="menu-divider-title">语音设置</span>
                </el-menu-item>
                <el-sub-menu>
                  <template #title>
                    <el-icon><SettingIcon /></el-icon>
                    语音类型
                  </template>
                  <el-menu-item command="tts-local">
                    <el-icon><Cpu /></el-icon>
                    本地浏览器
                  </el-menu-item>
                  <el-menu-item command="tts-edge">
                    <el-icon><Cpu /></el-icon>
                    Edge TTS
                  </el-menu-item>
                  <el-menu-item command="tts-http" :disabled="!ttsList.length">
                    <el-icon><Link /></el-icon>
                    HttpTTS
                  </el-menu-item>
                </el-sub-menu>
                <el-sub-menu v-if="ttsType === 'edge'">
                  <template #title>
                    <el-icon><FolderOpened /></el-icon>
                    方言筛选
                  </template>
                  <el-menu-item
                    v-for="d in edgeDialects"
                    :key="d"
                    :command="'dialect-' + d"
                    :disabled="selectedDialect === d"
                  >
                    {{ d }}
                  </el-menu-item>
                </el-sub-menu>
                <el-sub-menu v-if="voiceOptions.length > 0">
                  <template #title>
                    <el-icon><Headset /></el-icon>
                    选择语音
                  </template>
                  <el-menu-item
                    v-for="voice in voiceOptions"
                    :key="voice.value"
                    :command="'voice-' + voice.value"
                    :disabled="settingsStore.speechVoiceConfig.voiceName === voice.value"
                  >
                    {{ voice.label }}
                  </el-menu-item>
                </el-sub-menu>
                <el-menu-item disabled divided>
                  <span class="menu-divider-title">语速/语调</span>
                </el-menu-item>
                <el-form-item label="语速" style="padding: 8px 12px;">
                  <el-slider
                    v-model="settingsStore.speechVoiceConfig.speechRate"
                    :min="0.5"
                    :max="2"
                    :step="0.1"
                    show-input
                  />
                </el-form-item>
                <el-form-item label="语调" style="padding: 8px 12px;">
                  <el-slider
                    v-model="settingsStore.speechVoiceConfig.speechPitch"
                    :min="0"
                    :max="2"
                    :step="0.1"
                    show-input
                  />
                </el-form-item>
              </el-menu>
            </template>
          </el-dropdown>
        </ElTooltip>
        <ElTooltip content="书签" placement="top">
          <el-button type="text" :icon="Bookmark" @click="bookmarkStore.loadBookmarks(userNameSpace)" />
        </ElTooltip>
        <ElTooltip content="阅读设置" placement="top">
          <el-button type="text" :icon="SettingIcon" @click="toggleSettings" />
        </ElTooltip>
        <ElTooltip content="全屏" placement="top">
          <el-button type="text" :icon="isFullScreen ? Fold : Expand" @click="toggleFullScreen" />
        </ElTooltip>
      </div>
    </div>

    <!-- Chapter navigation -->
    <div class="reader-nav-bar">
      <el-button type="text" :icon="ArrowLeft" @click="prevChapter" :disabled="currentChapterIndex === 0">
        上一章
      </el-button>
      <span class="chapter-title">
        {{ currentChapter?.name || '加载中...' }}
      </span>
      <el-button type="text" :icon="ArrowRight" @click="nextChapter" :disabled="currentChapterIndex === chapters.length - 1">
        下一章
      </el-button>
    </div>

    <!-- 缓存进度显示 -->
    <div v-if="isCachingContent" class="cache-progress-bar">
      <el-progress :percentage="(cacheContentCount / targetCacheCount) * 100" :stroke-width="16" :show-text="true" format="percentage" />
      <p class="cache-tip">{{ cachingContentTip }}</p>
      <el-button size="small" type="danger" @click="cancelCaching">取消缓存</el-button>
    </div>

    <!-- Content area -->
    <div class="reader-content-wrapper">
      <!-- TOC sidebar -->
      <div v-show="tocVisible && !isSlideRead && !isScrollRead" class="toc-sidebar">
        <ChapterCatalog
          :chapters="chapters"
          :current-index="currentChapterIndex"
          :visible="tocVisible"
          :read-chapter-index="currentBook?.durChapterIndex || 0"
          @jump-to="handleChapterJump"
        />
      </div>

      <!-- Main content -->
      <div
        class="reader-content"
        :class="[
          'text-selection',
          { 'slide-mode': isSlideRead, 'scroll-mode': isScrollRead, 'page-mode': isPageMode, 'auto-mode': isAutoReading }
        ]"
        @selectstart="handleTextSelection"
        @touchstart="handleTouchStart"
        @touchmove="handleTouchMove"
        @touchend="handleTouchEnd"
        @click="handleClick"
      >
        <div v-if="isChapterLoading" class="chapter-loading">
          <el-icon :size="40" class="loading-icon"><Loading /></el-icon>
          <p>加载章节中...</p>
        </div>
        
        <!-- EPUB iframe 模式 -->
        <div v-else-if="isEpubIframe && currentChapter" class="epub-iframe-container">
          <iframe
            :src="getChapterIframeSrc(currentChapter)"
            frameborder="0"
            class="epub-iframe"
            @load="onIframeLoad"
          ></iframe>
        </div>
        
        <!-- 滑动/翻页/滚动/自动阅读模式使用 Content 组件 -->
        <Content
          v-else-if="content && !isEpubIframe"
          :content="content"
          :config="readConfig"
          :book="currentBook"
          :chapter="currentChapter"
          :chapter-index="currentChapterIndex"
          :chapters="chapters"
          @prev-chapter="prevChapter"
          @next-chapter="nextChapter"
          @update-progress="saveProgress"
        />
        
        <el-empty v-else description="暂无内容" />
      </div>
    </div>

    <!-- Right scrollbar nav (仅滚动模式) -->
    <div v-if="isScrollRead" class="reader-scrollbar-nav">
      <el-button type="text" :icon="CaretTop" @click="goToTop" title="回顶部" />
      <el-button type="text" :icon="CaretBottom" @click="goToBottom" title="回底部" />
    </div>

    <!-- Text selection menu -->
    <TextSelectMenu
      v-if="showTextMenu && textSelectData"
      :book-url="bookUrl"
      :book-name="currentBook.name"
      :book-author="currentBook.author"
      :chapter-url="currentChapter?.chapterUrl || ''"
      :chapter-name="currentChapter?.name || ''"
      :chapter-index="textSelectData.chapterIndex"
      :chapter-pos="textSelectData.chapterPos"
      @close="closeTextMenu"
      @tts="handleTTS"
    />

    <!-- Reading settings -->
    <ReadSettings
      v-model:visible="settingsVisible"
      :current-book-name="currentBook?.name"
      :api-root="settingsStore.apiRoot"
      @save-config="handleSaveConfig"
      @close="handleSettingsClose"
    />

    <!-- Book source switch -->
    <BookSourceSwitch
      v-model:visible="sourceSwitchVisible"
      :book-url="bookUrl"
      :current-source="currentBook?.bookSource || ''"
      @switch-source="async (sourceUrl) => {
        const res = await setBookSource(bookUrl, sourceUrl, userNameSpace)
        if (res.isSuccess) {
          ElMessage.success('换源成功，正在刷新...')
          loadBook()
        }
      }"
    />
  </div>
  <div v-else class="reader-loading">
    <el-icon :size="48"><Loading /></el-icon>
    <p>加载书籍中...</p>
  </div>
</template>

<style scoped>
.reader-page {
  height: calc(100vh - var(--header-height, 60px));
  display: flex;
  flex-direction: column;
  background: var(--reader-bg, #f5f7fa);
  color: var(--reader-text-color, #303133);
  overflow: hidden;
}

.reader-toolbar {
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  background: var(--reader-content-bg, #fff);
  border-bottom: 1px solid var(--border-light, #e4e7ed);
  transition: transform 0.3s ease;
  flex-shrink: 0;
}

.reader-toolbar.hidden {
  transform: translateY(-100%);
}

.toolbar-center {
  flex: 1;
  text-align: center;
  font-size: 16px;
  font-weight: bold;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.book-title {
  color: var(--reader-text-color);
}

.book-author {
  color: var(--el-text-color-secondary);
  font-weight: normal;
}

.toolbar-right {
  display: flex;
  gap: 4px;
}

.toolbar-right .el-button {
  padding: 8px 12px;
}

.reader-nav-bar {
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  background: var(--reader-content-bg, #fff);
  border-bottom: 1px solid var(--border-light, #e4e7ed);
  flex-shrink: 0;
}

.chapter-title {
  flex: 1;
  text-align: center;
  font-size: 14px;
  color: var(--el-text-color-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.reader-content-wrapper {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.toc-sidebar {
  width: 260px;
  border-right: 1px solid var(--border-light, #e4e7ed);
  flex-shrink: 0;
  overflow: hidden;
}

.reader-content {
  flex: 1;
  overflow-y: auto;
  padding: var(--horizontal-padding, 20px);
  padding-top: var(--top-padding, 0);
  padding-bottom: var(--bottom-padding, 0);
  box-sizing: border-box;
}

.chapter-content {
  font-size: var(--reader-font-size, 16px);
  line-height: var(--reader-line-height, 1.8);
  color: var(--reader-text-color, #303133);
  max-width: 800px;
  margin: 0 auto;
}

.chapter-content :global(p) {
  text-indent: 2em;
  margin: 0 0 1em 0;
}

.chapter-content :global(img) {
  max-width: 100%;
  height: auto;
}

.chapter-content :global(h1),
.chapter-content :global(h2),
.chapter-content :global(h3) {
  margin: 1em 0 0.5em 0;
  font-weight: bold;
}

.chapter-loading {
  text-align: center;
  padding: 60px 0;
  color: var(--el-text-color-secondary);
}

.loading-icon {
  margin-bottom: 16px;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

.reader-scrollbar-nav {
  position: fixed;
  right: 16px;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.reader-loading {
  height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  color: var(--el-text-color-secondary);
}

.cache-progress-bar {
  padding: 8px 16px;
  background: var(--reader-content-bg, #fff);
  border-bottom: 1px solid var(--border-light, #e4e7ed);
  flex-shrink: 0;
}

.cache-progress-bar .el-progress {
  margin-bottom: 4px;
}

.cache-tip {
  margin: 4px 0 8px 0;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  text-align: center;
}
</style>