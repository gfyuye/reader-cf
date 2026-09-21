<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import { useSettingsStore } from '@/stores/settings'
import { useAuthStore } from '@/stores/auth'
import { simplifed, traditionalized, applyReplaceRules } from '@/utils/helpers'
import { animate, Timings, Presets } from '@/utils/animate'
import { ElMessage } from 'element-plus'
import type { CSSProperties } from 'vue'

interface Props {
  content: string
  config: any
  book: any
  chapter: any
  chapterIndex: number
  chapters: any[]
}

const props = withDefaults(defineProps<Props>(), {
  content: '',
  config: () => ({}),
  book: () => ({}),
  chapter: () => ({}),
  chapterIndex: 0,
  chapters: () => []
})

const emit = defineEmits<{
  (e: 'prev-chapter'): void
  (e: 'next-chapter'): void
  (e: 'update-progress'): void
  (e: 'click', event: MouseEvent): void
}>()

const settingsStore = useSettingsStore()
const authStore = useAuthStore()

const processedContent = ref('')
const imagesLoaded = ref(0)
const totalImages = ref(0)
const contentContainer = ref<HTMLElement | null>(null)
const observer = ref<IntersectionObserver | null>(null)
const currentPage = ref(1)
const totalPages = ref(1)
const isAnimating = ref(false)
const transformX = ref(0)

const userNameSpace = computed(() => authStore.currentUserNS)

// 阅读模式判断
const isSlideRead = computed(() => props.config?.readMethod === '左右滑动')
const isScrollRead = computed(() => 
  props.config?.readMethod === '上下滚动' || props.config?.readMethod === '上下滚动2'
)
const isPageMode = computed(() => !isSlideRead.value && !isScrollRead.value)

onMounted(() => {
  processContent()
  initLazyLoad()
  
  // 段落首行缩进
  const paragraphs = contentContainer.value?.querySelectorAll('p')
  paragraphs?.forEach(p => {
    p.style.textIndent = '2em'
    p.style.margin = '0 0 1em 0'
  })
  
  // 标题样式
  const headings = contentContainer.value?.querySelectorAll('h1, h2, h3, h4, h5, h6')
  headings?.forEach(h => {
    const el = h as HTMLElement
    el.style.margin = '1em 0 0.5em 0'
    el.style.fontWeight = 'bold'
  })
  
  // 计算页数
  computePages()
})

onBeforeUnmount(() => {
  observer.value?.disconnect()
})

watch(() => props.content, () => {
  processContent()
})

watch(() => props.chapterIndex, () => {
  currentPage.value = 1
  transformX.value = 0
  nextTick(() => computePages())
})

function processContent() {
  let content = props.content || ''
  
  // 1. 应用替换规则
  if (props.config?.filterRules?.length) {
    content = applyReplaceRules(content, props.config.filterRules)
  }
  
  // 2. 简繁转换
  const chineseFont = props.config?.chineseFont || '简体'
  if (chineseFont === '繁体') {
    content = traditionalized(content)
  } else if (chineseFont === '简体') {
    content = simplifed(content)
  }
  
  // 3. 处理图片懒加载
  content = processImages(content)
  
  processedContent.value = content
  
  nextTick(() => {
    computePages()
    emit('update-progress')
  })
}

function computePages() {
  if (!contentContainer.value) return
  
  const container = contentContainer.value
  const contentEl = container.querySelector('.chapter-content')
  if (!contentEl) return
  
  if (isSlideRead.value) {
    // 滑动模式：每页一个屏幕宽度
    const pageWidth = container.clientWidth
    const contentWidth = contentEl.scrollWidth
    totalPages.value = Math.max(1, Math.ceil(contentWidth / pageWidth))
  } else if (isPageMode.value) {
    // 翻页模式：每页一个屏幕高度
    const pageHeight = container.clientHeight
    const contentHeight = contentEl.scrollHeight
    totalPages.value = Math.max(1, Math.ceil(contentHeight / pageHeight))
  } else {
    totalPages.value = 1
  }
}

function processImages(html: string): string {
  return html.replace(/<img([^>]*)src=["']([^"']+)["']([^>]*)>/gi, (match, before, src, after) => {
    totalImages.value++
    return `<img${before}data-src="${src}" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" class="lazy-image"${after}>`
  })
}

function handleImageLoad() {
  imagesLoaded.value++
  computePages()
}

function handleImageError(e: Event | string) {
  const img = (e instanceof Event ? e.target : null) as HTMLImageElement | null
  if (img) {
    img.style.display = 'none'
  }
  imagesLoaded.value++
}

// 翻页动画
function showPage(page: number, animatePage = true) {
  if (page < 1 || page > totalPages.value || isAnimating.value) return
  
  const prevPage = currentPage.value
  currentPage.value = page
  
  if (isSlideRead.value) {
    // 左右滑动动画
    const container = contentContainer.value
    if (!container) return
    
    const pageWidth = container.clientWidth
    const targetX = -(page - 1) * pageWidth
    
    if (animatePage && props.config?.animateMSTime) {
      isAnimating.value = true
      const startX = transformX.value
      const distance = targetX - startX
      const duration = props.config.animateMSTime
      
      animate({
        duration,
        timing: Timings.power(2),
        draw: (progress: number) => {
          transformX.value = startX + distance * progress
        },
        onEnd: () => {
          isAnimating.value = false
        }
      })
    } else {
      transformX.value = targetX
    }
  } else if (isPageMode.value) {
    // 上下翻页动画 - 通过 scrollTop 实现
    const container = contentContainer.value
    if (!container) return
    
    const pageHeight = container.clientHeight
    const targetY = (page - 1) * pageHeight
    
    if (animatePage && props.config?.animateMSTime) {
      container.scrollTo({ top: targetY, behavior: 'smooth' })
    } else {
      container.scrollTop = targetY
    }
  }
}

function prevPage() {
  if (currentPage.value > 1) {
    showPage(currentPage.value - 1)
  } else {
    emit('prev-chapter')
  }
}

function nextPage() {
  if (currentPage.value < totalPages.value) {
    showPage(currentPage.value + 1)
  } else {
    emit('next-chapter')
  }
}

// 供父组件调用：获取当前阅读进度百分比
function getProgress(): number {
  if (isSlideRead.value) {
    return (currentPage.value - 1) / Math.max(1, totalPages.value - 1)
  }
  if (isPageMode.value) {
    return (currentPage.value - 1) / Math.max(1, totalPages.value - 1)
  }
  const el = contentContainer.value
  if (!el) return 0
  const scrollTop = el.scrollTop
  const scrollHeight = el.scrollHeight - el.clientHeight
  return scrollHeight > 0 ? scrollTop / scrollHeight : 0
}

// 供父组件调用：跳转到指定进度
function scrollToProgress(progress: number) {
  const targetPage = Math.round(progress * (totalPages.value - 1)) + 1
  showPage(targetPage)
}

function initLazyLoad() {
  if (!contentContainer.value) return
  
  observer.value = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const img = entry.target as HTMLImageElement
        if (img.dataset.src) {
          img.src = img.dataset.src
          img.removeAttribute('data-src')
          img.onload = handleImageLoad
          img.onerror = handleImageError
        }
        observer.value?.unobserve(img)
      }
    })
  }, {
    rootMargin: '100px 0px',
    threshold: 0.01
  })
  
  const lazyImages = contentContainer.value.querySelectorAll('img.lazy-image')
  lazyImages.forEach(img => observer.value?.observe(img))
  totalImages.value = lazyImages.length
}

const contentStyle = computed((): CSSProperties => {
  const cfg = props.config
  return {
    fontSize: cfg.fontSize + 'px',
    lineHeight: cfg.lineHeight,
    fontFamily: cfg.fontFamily || 'custom-system',
    color: cfg.fontColor || (cfg.themeType === 'night' ? '#666' : '#262626'),
    maxWidth: cfg.readWidth + 'px',
    margin: '0 auto',
    padding: `${cfg.topPadding}px ${cfg.horizontalPadding}px ${cfg.bottomPadding}px`,
    textAlign: 'justify',
    overflow: isSlideRead.value ? 'hidden' : (isScrollRead.value ? 'auto' : 'hidden'),
    position: 'relative',
  }
})

const chapterContentStyle = computed((): CSSProperties => {
  if (isSlideRead.value) {
    return {
      transform: `translateX(${transformX.value}px)`,
      transition: isAnimating.value ? `transform ${props.config?.animateMSTime || 300}ms cubic-bezier(0.25, 0.46, 0.45, 0.94)` : 'none',
      willChange: 'transform',
      display: 'flex',
      flexDirection: 'column' as const,
      minWidth: '100%',
    }
  }
  if (isPageMode.value) {
    return {
      display: 'flex',
      flexDirection: 'column' as const,
      minHeight: '100%',
    }
  }
  return {}
})

defineExpose({
  getProgress,
  scrollToProgress,
  showPage,
  prevPage,
  nextPage,
  currentPage,
  totalPages,
  transformX
})
</script>

<template>
  <div 
    class="content-container" 
    ref="contentContainer"
    :style="contentStyle"
    :class="[
      { 'slide-reader': isSlideRead },
      { 'scroll-reader': isScrollRead },
      { 'page-reader': isPageMode }
    ]"
  >
    <div 
      v-html="processedContent" 
      class="chapter-content"
      :style="chapterContentStyle"
      @click="$emit('click', $event)"
    >
    </div>
  </div>
</template>

<style scoped>
.content-container {
  overflow-y: auto;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
}

.chapter-content {
  word-wrap: break-word;
  word-break: break-all;
}

.chapter-content img {
  max-width: 100%;
  height: auto;
  display: block;
  margin: 1em auto;
  border-radius: 4px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
}

.chapter-content img.lazy-image {
  opacity: 0;
  transition: opacity 0.3s ease;
  min-height: 100px;
  background: #f5f5f5;
}

.chapter-content img.lazy-image[src*="data:image"] {
  opacity: 0;
}

.chapter-content img:not(.lazy-image) {
  opacity: 1;
}

.chapter-content p {
  text-indent: 2em;
  margin: 0 0 1em 0;
  line-height: inherit;
}

.chapter-content h1,
.chapter-content h2,
.chapter-content h3,
.chapter-content h4,
.chapter-content h5,
.chapter-content h6 {
  margin: 1.5em 0 0.5em 0;
  font-weight: bold;
  line-height: 1.4;
  text-indent: 0;
}

.chapter-content h1 { font-size: 1.5em; }
.chapter-content h2 { font-size: 1.35em; }
.chapter-content h3 { font-size: 1.2em; }
.chapter-content h4 { font-size: 1.1em; }

.chapter-content blockquote {
  border-left: 4px solid var(--el-color-primary);
  padding-left: 1em;
  margin: 1em 0;
  color: var(--el-text-color-secondary);
  font-style: italic;
}

.chapter-content pre {
  background: #f5f5f5;
  padding: 1em;
  overflow-x: auto;
  border-radius: 4px;
  margin: 1em 0;
}

.chapter-content code {
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
  font-size: 0.9em;
}

.chapter-content a {
  color: var(--el-color-primary);
  text-decoration: underline;
}

.chapter-content hr {
  border: none;
  border-top: 1px solid var(--el-border-color);
  margin: 2em 0;
}

/* 滑动模式特殊样式 */
.slide-reader .content-container {
  overflow-x: hidden;
  overflow-y: hidden;
  display: flex;
  flex-direction: column;
}

.slide-reader .chapter-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
}

/* 滚动模式 */
.scroll-reader .content-container {
  overflow-y: auto;
  overflow-x: hidden;
}

/* 翻页模式 */
.page-reader .content-container {
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.page-reader .chapter-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
}
</style>