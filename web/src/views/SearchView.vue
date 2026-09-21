<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { Search, Download, Refresh, Loading } from '@element-plus/icons-vue'
import { ElMessage, ElTag, ElTooltip, ElDropdown, ElDropdownMenu, ElDropdownItem } from 'element-plus'
import { searchBook, searchBookMulti, searchBookSource } from '@/api/book'
import { useNotify } from '@/utils/helpers'
import { useAuthStore } from '@/stores/auth'
import { useSettingsStore } from '@/stores/settings'
import type { SearchBook, BookSource } from '@/api/types'
import { useRouter } from 'vue-router'

const { success, error } = useNotify()
const authStore = useAuthStore()
const settingsStore = useSettingsStore()
const router = useRouter()

const key = ref('')
const page = ref(1)
const results = ref<any[]>([])
const loading = ref(false)
const hasMore = ref(false)
const lastIndex = ref(-1)
const searchType = ref('multi')
const bookSourceUrl = ref('')
const showSourceSelect = ref(false)
const sourceList = ref<BookSource[]>([])
const sourceFilter = ref('')
const useSSE = ref(false)
const sseResults = ref<any[]>([])

const userNameSpace = computed(() => authStore.currentUserNS)
const searchConfig = computed(() => settingsStore.searchConfig)
const bookSourceGroupList = computed(() => {
  const groupsMap: Record<string, number> = {}
  sourceList.value.forEach((s) => {
    if (s.bookSourceGroup) {
      s.bookSourceGroup.split(',').forEach((g) => {
        groupsMap[g] = (groupsMap[g] || 0) + 1
      })
    }
  })
  const groups = [{ name: '全部分组', value: '', count: sourceList.value.length }]
  for (const name in groupsMap) {
    groups.push({ name, value: name, count: groupsMap[name] })
  }
  return groups
})

onMounted(() => {
  loadBookSources()
})

async function loadBookSources() {
  try {
    const { getBookSources } = await import('@/api/bookSource')
    const res = await getBookSources()
    if (res.isSuccess) {
      sourceList.value = (res.data as BookSource[]) || []
    }
  } catch {
    /* ignore */
  }
}

async function doSearch() {
  if (!key.value.trim()) {
    ElMessage.warning('请输入搜索关键字')
    return
  }
  page.value = 1
  results.value = []
  hasMore.value = false
  lastIndex.value = -1
  sseResults.value = []

  if (searchType.value === 'single') {
    if (!searchConfig.value.bookSourceUrl) {
      ElMessage.warning('请先选择搜索书源')
      showSourceSelect.value = true
      return
    }
    loading.value = true
    try {
      const res = await searchBook(key.value, page.value, userNameSpace.value)
      if (res.isSuccess) {
        results.value = (res.data as any[]) || []
        hasMore.value = results.value.length >= 20
      }
    } finally {
      loading.value = false
    }
  } else {
    if (useSSE.value) {
      searchBookMultiSSE(key.value)
    } else {
      loading.value = true
      try {
        const res = await searchBookMulti(
          key.value,
          searchConfig.value.bookSourceGroup || '',
          lastIndex.value,
          20,
          searchConfig.value.concurrentCount || 24,
          userNameSpace.value
        )
        if (res.isSuccess) {
          const list = (res.data as any)?.list || []
          results.value = list
          lastIndex.value = (res.data as any)?.lastIndex || lastIndex.value
          hasMore.value = list.length > 0 && list.length === 20
        }
      } finally {
        loading.value = false
      }
    }
  }
}

function searchBookMultiSSE(searchKey: string) {
  const baseURL = settingsStore.currentFontFamily
  const apiRoot = window.location.origin + '/reader3'
  const params = new URLSearchParams({
    key: searchKey,
    bookSourceGroup: searchConfig.value.bookSourceGroup || '',
    lastIndex: '-1',
    searchSize: '20',
    concurrentCount: String(searchConfig.value.concurrentCount || 24),
    accessToken: '',
    userNameSpace: userNameSpace.value,
  })

  const token = localStorage.getItem('accessToken') || ''
  if (token) {
    const uname = localStorage.getItem('username') || ''
    params.set('accessToken', uname ? `${uname}:${token}` : token)
  }

  const evtSource = new EventSource(`${apiRoot}/searchBookMultiSSE?${params.toString()}`)
  loading.value = true
  sseResults.value = []

  evtSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data)
      if (data.isSuccess) {
        const list = data.data?.list || []
        sseResults.value.push(...list)
        results.value = [...sseResults.value]
      }
    } catch {
      /* ignore */
    }
  }

  evtSource.onerror = () => {
    loading.value = false
    evtSource.close()
  }
}

async function loadMore() {
  if (!hasMore.value || loading.value) return
  loading.value = true
  try {
    const res = await searchBookMulti(
      key.value,
      searchConfig.value.bookSourceGroup || '',
      lastIndex.value,
      20,
      searchConfig.value.concurrentCount || 24,
      userNameSpace.value
    )
    if (res.isSuccess) {
      const list = (res.data as any)?.list || []
      results.value.push(...list)
      lastIndex.value = (res.data as any)?.lastIndex || lastIndex.value
      hasMore.value = list.length > 0 && list.length === 20
    }
  } finally {
    loading.value = false
  }
}

function toBook(book: any) {
  router.push(`/book-info/${book.bookUrl}`)
}

function toReader(book: any) {
  router.push(`/reader/${book.bookUrl}`)
}
</script>

<template>
  <div class="search-container">
    <div class="search-toolbar">
      <el-input
        v-model="key"
        placeholder="输入书名/作者/关键词搜索..."
        :prefix-icon="Search"
        @keyup.enter="doSearch"
        style="max-width: 320px;"
      />
      <el-button type="primary" :loading="loading" @click="doSearch" style="margin-left: 8px;">
        搜索
      </el-button>

      <el-radio-group v-model="searchType" style="margin-left: 16px;">
        <el-radio-button value="single">单书源</el-radio-button>
        <el-radio-button value="multi">多书源</el-radio-button>
      </el-radio-group>

      <el-checkbox v-if="searchType === 'multi'" v-model="useSSE" style="margin-left: 16px;">
        使用 SSE 流式
      </el-checkbox>

      <el-dropdown v-if="searchType === 'single'" placement="bottom-end">
        <el-button :icon="Search">
          选择书源
          <el-icon class="el-icon--right"><ArrowDown /></el-icon>
        </el-button>
        <template #dropdown>
          <div style="padding: 8px; width: 300px;">
            <el-input v-model="sourceFilter" placeholder="筛选书源" size="small" />
            <el-select
              v-model="searchConfig.bookSourceUrl"
              placeholder="选择搜索书源"
              size="small"
              style="width: 100%; margin-top: 8px;"
              filterable
            >
              <el-option
                v-for="source in sourceList.filter(s =>
                  !sourceFilter ||
                  s.bookSourceName?.includes(sourceFilter) ||
                  s.bookSourceUrl?.includes(sourceFilter)
                )"
                :key="source.bookSourceUrl"
                :label="source.bookSourceName"
                :value="source.bookSourceUrl"
              />
            </el-select>
          </div>
        </template>
      </el-dropdown>
    </div>

    <div v-if="searchConfig.bookSourceGroup" class="search-active-group">
      当前搜索分组: {{ bookSourceGroupList.find(g => g.value === searchConfig.bookSourceGroup)?.name || searchConfig.bookSourceGroup }}
    </div>

    <div class="search-results">
      <template v-if="loading && results.length === 0">
        <div v-for="i in 6" :key="i" class="book-card-skeleton">
          <el-skeleton :rows="4" animated />
        </div>
      </template>

      <el-card
        v-for="book in results"
        :key="book.bookUrl + (book.bookSource || '')"
        class="book-card"
        shadow="hover"
        @click="toBook(book)"
      >
        <div class="book-card-inner">
          <el-image
            :src="book.coverUrl"
            fit="cover"
            class="book-card-cover"
            lazy
          >
            <template #error>
              <div class="cover-fallback">无封面</div>
            </template>
          </el-image>
          <div class="book-card-info">
            <h3 class="book-card-title" :title="book.name">{{ book.name }}</h3>
            <p class="book-card-author">{{ book.author }}</p>
            <p class="book-card-source">{{ book.bookSource }}</p>
            <el-tag type="info" size="small">{{ book.chapterCount || 0 }}话</el-tag>
          </div>
          <el-button
            type="primary"
            size="small"
            :icon="Download"
            @click.stop="toReader(book)"
          >
            阅读
          </el-button>
        </div>
      </el-card>

      <el-button
        v-if="hasMore && !useSSE"
        :loading="loading"
        type="primary"
        plain
        @click="loadMore"
      >
        加载更多
      </el-button>

      <el-empty v-if="!loading && results.length === 0" description="搜索结果为空" />
    </div>
  </div>
</template>

<style scoped>
.search-container {
  padding: 0;
}

.search-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 20px;
  flex-wrap: wrap;
}

.search-toolbar .el-input-group {
  flex: 1;
  min-width: 280px;
}

.search-active-group {
  font-size: 13px;
  color: var(--el-text-color-secondary);
  margin-bottom: 12px;
}

.search-results {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 16px;
}

.book-card {
  cursor: pointer;
  height: 100%;
}

.book-card:hover {
  transform: translateY(-2px);
}

.book-card-inner {
  display: flex;
  gap: 12px;
}

.book-card-cover {
  width: 80px;
  height: 110px;
  flex-shrink: 0;
  border-radius: 4px;
  overflow: hidden;
}

.cover-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 80px;
  height: 110px;
  color: #c0c4cc;
  background: #f5f7fa;
  font-size: 12px;
}

.book-card-info {
  flex: 1;
  min-width: 0;
}

.book-card-title {
  font-size: 14px;
  margin: 0 0 4px 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.book-card-author {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin: 2px 0;
}

.book-card-source {
  font-size: 11px;
  color: var(--el-text-color-placeholder);
  margin: 2px 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.book-card-skeleton {
  margin-bottom: 12px;
}
</style>
