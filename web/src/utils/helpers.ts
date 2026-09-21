import { ref, computed } from 'vue'
import { ElMessage } from 'element-plus'
import { getCache, setCache } from '@/utils/cache'
import { simplifed, traditionalized } from '@/utils/chinese'
import { applyReplaceRules } from '@/utils/replaceRules'
import { animate, Timings, Utils, Presets, PageFlipAnimator, FlipDirection, createPageFlipAnimator } from '@/utils/animate'

export { 
  simplifed, 
  traditionalized, 
  applyReplaceRules,
  animate,
  Timings,
  Utils,
  Presets,
  PageFlipAnimator,
  FlipDirection,
  createPageFlipAnimator
}

export function useNotify() {
  function success(message: string) {
    ElMessage.success({ message, duration: 3000 })
  }

  function error(message: string) {
    ElMessage.error({ message, duration: 5000 })
  }

  function warning(message: string) {
    ElMessage.warning({ message, duration: 3000 })
  }

  function info(message: string) {
    ElMessage.info({ message, duration: 3000 })
  }

  return { success, error, warning, info }
}

export function usePagination(pageSize = 20) {
  const currentPage = ref(1)
  const total = ref(0)
  const pageSizeRef = ref(pageSize)
  const loading = ref(false)

  const offset = computed(() => (currentPage.value - 1) * pageSizeRef.value)

  function goToPage(page: number) {
    currentPage.value = page
  }

  function nextPage() {
    currentPage.value++
  }

  function prevPage() {
    currentPage.value = Math.max(1, currentPage.value - 1)
  }

  return {
    currentPage,
    total,
    pageSize: pageSizeRef,
    loading,
    offset,
    goToPage,
    nextPage,
    prevPage,
  }
}

/**
 * Network-first request with cache fallback.
 * If network fails, returns cached data.
 */
export async function networkFirstRequest(requestFunc: () => Promise<any>, cacheKey: string) {
  cacheKey = 'localCache@' + cacheKey
  const res = await requestFunc().catch(async () => {
    const cacheResponse = getCache(cacheKey)
    if (cacheResponse) {
      return { data: cacheResponse }
    }
    throw new Error('No cache available')
  })
  if (res.data && res.data.isSuccess) {
    setCache(cacheKey, res.data)
  }
  return res
}

/**
 * Cache-first request with optional validation.
 * If cache exists and validates, returns cache. Otherwise requests network.
 */
export async function cacheFirstRequest(
  requestFunc: () => Promise<any>,
  cacheKey: string,
  validateCache?: ((cache: any) => boolean) | boolean
) {
  cacheKey = 'localCache@' + cacheKey
  if (validateCache !== true) {
    const cacheResponse = getCache(cacheKey)
    if (cacheResponse) {
      if (!validateCache || (validateCache && validateCache(cacheResponse))) {
        if (typeof cacheResponse === 'object') {
          cacheResponse.isCache = true
        }
        return { data: cacheResponse }
      }
    }
  }
  const res = await requestFunc()
  if (res.data && res.data.isSuccess) {
    setCache(cacheKey, res.data)
  }
  return res
}

/**
 * Request limiter - limits concurrent requests.
 */
export function limitRequest(limit: number, process?: (handler: any, result: any, err: any) => void) {
  let currentSum = 0
  let requests: Array<() => Promise<any>> = []

  async function run() {
    let err, result
    try {
      ++currentSum
      const fn = requests.shift()!
      result = await fn()
    } catch (error) {
      err = error
    } finally {
      --currentSum
      process && process(handler, result, err)
      if (requests.length > 0) {
        run()
      }
    }
  }

  const handler: any = (reqFn: () => Promise<any>) => {
    if (!reqFn || !(reqFn instanceof Function)) {
      return
    }
    requests.push(reqFn)
    if (currentSum < limit) {
      run()
    }
  }

  handler.requestCount = 0
  handler.leftCount = 0
  handler.errorCount = 0
  handler.cancel = () => {
    requests = []
  }
  handler.isEnd = () => {
    return !handler.leftCount && !currentSum
  }

  return handler
}

/**
 * Format file size to human-readable string.
 */
export function formatSize(value: number | null | undefined, scale = 2): string {
  if (value == null || value === 0) return '0 Bytes'
  const unitArr = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB']
  const index = Math.floor(Math.log(value) / Math.log(1024))
  const size = (value / Math.pow(1024, index)).toFixed(scale)
  return size + ' ' + unitArr[index]
}

/**
 * Compute Levenshtein edit distance similarity (0-1).
 */
export function editDistance(strA: string, strB: string): number {
  if (strA === strB) return 1.0
  if (!strA || !strB) return 0.0
  const lenA = strA.length
  const lenB = strB.length
  const arr: number[][] = []
  for (let i = 0; i <= lenA; i++) arr[i] = new Array(lenB + 1)
  for (let i1 = 0; i1 <= lenA; i1++) {
    for (let i2 = 0; i2 <= lenB; i2++) {
      if (i1 === 0) arr[i1][i2] = i2
      else if (i2 === 0) arr[i1][i2] = i1
      else if (strA.charAt(i1 - 1) === strB.charAt(i2 - 1)) arr[i1][i2] = arr[i1 - 1][i2 - 1]
      else arr[i1][i2] = 1 + Math.min(arr[i1 - 1][i2 - 1], Math.min(arr[i1][i2 - 1], arr[i1 - 1][i2]))
    }
  }
  return 1 - arr[lenA][lenB] / Math.max(lenA, lenB)
}

/**
 * Dynamically load a custom @font-face.
 */
export function loadFont(fontName: string, fontUrl: string) {
  ;(window as any).customFonts = (window as any).customFonts || {}
  if (!(window as any).customFonts[fontName] || (window as any).customFonts[fontName] !== fontUrl) {
    const style = document.createElement('style')
    style.textContent = `
      @font-face {
        font-family: "${fontName}";
        src: url("${fontUrl}");
      }
    `
    style.id = 'custom-font-' + fontName
    document.head.appendChild(style)
    ;(window as any).customFonts[fontName] = fontUrl
  }
}

export function removeFont(fontName: string) {
  ;(window as any).customFonts = (window as any).customFonts || {}
  delete (window as any).customFonts[fontName]
  const nodeList = document.querySelectorAll('#custom-font-' + fontName)
  nodeList.forEach((node) => node.remove())
}

/**
 * Check if interface is mini (mobile).
 */
export const isMiniInterface = () => window.innerWidth <= 750

/**
 * Get image path with proxy support.
 */
export function getImagePath(url: string | undefined, useSW = false, apiRoot?: string): string | false {
  if (!url) return false
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('//')) {
    if (useSW && (window as any).serviceWorkerReady) return url
    return (apiRoot || '') + '/cover?path=' + url
  }
  return (apiRoot || '') + url
}

/**
 * Get cover image URL.
 */
export function getCover(coverUrl: string | undefined, useSW = false, apiRoot?: string) {
  const url = getImagePath(coverUrl, useSW, apiRoot)
  if (url) {
    return useSW ? url : { src: url, error: '/noCover.jpeg' }
  }
  return '/noCover.jpeg'
}

/**
 * Debounce a function.
 */
export function debounce<T extends (...args: any[]) => any>(fn: T, delay: number): T {
  let timer: ReturnType<typeof setTimeout>
  return ((...args: any[]) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), delay)
  }) as T
}

/**
 * Throttle a function.
 */
export function throttle<T extends (...args: any[]) => any>(fn: T, delay: number): T {
  let last = 0
  return ((...args: any[]) => {
    const now = Date.now()
    if (now - last >= delay) {
      last = now
      fn(...args)
    }
  }) as T
}

/**
 * Check if a URL is a remote URL.
 */
export function isRemoteUrl(url: string): boolean {
  return url.startsWith('http://') || url.startsWith('https://') || url.startsWith('//')
}

/**
 * Copy text to clipboard.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
    const el = document.createElement('textarea')
    el.value = text
    el.style.position = 'fixed'
    el.style.opacity = '0'
    document.body.appendChild(el)
    el.select()
    document.execCommand('copy')
    document.body.removeChild(el)
    return true
  } catch {
    return false
  }
}

/**
 * Format timestamp to relative time.
 */
export function timeAgo(timestamp: number): string {
  const now = Date.now()
  const diff = now - timestamp
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)
  const months = Math.floor(days / 30)
  const years = Math.floor(months / 12)
  if (years > 0) return `${years}年前`
  if (months > 0) return `${months}月前`
  if (days > 0) return `${days}天前`
  if (hours > 0) return `${hours}小时前`
  if (minutes > 0) return `${minutes}分钟前`
  return `${seconds}秒前`
}
