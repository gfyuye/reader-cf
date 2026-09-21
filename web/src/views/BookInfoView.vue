<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  getBookInfo,
  getChapterList,
  searchBookSource,
  saveBook,
  setBookSource,
} from '@/api/book'
import { getBookSources } from '@/api/bookSource'
import { useAuthStore } from '@/stores/auth'
import { useSettingsStore } from '@/stores/settings'
import { ElMessage, ElTag, ElButton, ElCard, ElTabs, ElTabPane, ElImage } from 'element-plus'
import { Collection, Search, Share, Download, Loading } from '@element-plus/icons-vue'
import type { Book, BookSource } from '@/api/types'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const settingsStore = useSettingsStore()

const bookUrl = route.params.bookUrl as string
const bookInfo = ref<any>(null)
const chapters = ref<any[]>([])
const sources = ref<BookSource[]>([])
const availableSources = ref<BookSource[]>([])
const loading = ref(false)
const selectedSource = ref('')
const searching = ref(false)

const userNameSpace = computed(() => authStore.currentUserNS)
const readConfig = computed(() => settingsStore.config)

onMounted(() => {
  loadBookInfo()
})

async function loadBookInfo() {
  if (!bookUrl) return
  loading.value = true
  try {
    const [infoRes, srcRes, chRes] = await Promise.all([
      getBookInfo(bookUrl, userNameSpace.value),
      getBookSources(),
      getChapterList(bookUrl, userNameSpace.value),
    ])

    if (infoRes.isSuccess) {
      bookInfo.value = infoRes.data
    }
    if (srcRes.isSuccess) {
      sources.value = (srcRes.data as BookSource[]) || []
    }
    if (chRes.isSuccess) {
      chapters.value = (chRes.data as any[]) || []
    }
  } finally {
    loading.value = false
  }
}

async function searchForSources() {
  if (!bookUrl) return
  searching.value = true
  try {
    const res = await searchBookSource(bookUrl, 0, 20, '', '')
    if (res.isSuccess) {
      availableSources.value = (res.data as BookSource[]) || []
    }
  } catch {
    /* ignore */
  } finally {
    searching.value = false
  }
}

async function switchSource(source: BookSource) {
  const res = await setBookSource(bookUrl, source.bookSourceUrl, userNameSpace.value)
  if (res.isSuccess) {
    ElMessage.success('换源成功，正在刷新...')
    await loadBookInfo()
  }
}

function addToShelf() {
  if (!bookInfo.value) return
  saveBook({
    ...bookInfo.value,
    userNameSpace: userNameSpace.value,
  })
  ElMessage.success('已添加到书架')
}

function startReading() {
  router.push(`/reader/${bookUrl}`)
}

function getCoverUrl(url: string | undefined): string {
  if (!url) return '/noCover.jpeg'
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('//')) {
    return url
  }
  return url
}

function formatChapterCount(count: number): string {
  return count > 0 ? `${count} 话` : '未知'
}

function getLastUpdate(time: number | undefined): string {
  if (!time) return '未知'
  return new Date(time).toLocaleString()
}
</script>

<template>
  <div v-if="bookInfo && !loading" class="book-info-container">
    <el-row :gutter="30">
      <el-col :xs="24" :md="8">
        <el-card shadow="hover">
          <el-image
            :src="bookInfo.coverUrl"
            fit="contain"
            class="book-cover"
            lazy
          >
            <template #error>
              <div class="cover-placeholder">无封面</div>
            </template>
          </el-image>
        </el-card>
      </el-col>

      <el-col :xs="24" :md="16">
        <el-card shadow="hover">
          <h2>{{ bookInfo.name }}</h2>
          <p class="book-author">
            作者：{{ bookInfo.author || '未知' }} |
            书源：{{ bookInfo.bookSource || '未知' }}
          </p>

          <el-descriptions :column="2" border size="small" style="margin: 16px 0;">
            <el-descriptions-item label="最新章节">
              {{ bookInfo.latestChapterTitle || '未知' }}
            </el-descriptions-item>
            <el-descriptions-item label="章节数量">
              {{ formatChapterCount(bookInfo.chapterCount || chapters.length) }}
            </el-descriptions-item>
            <el-descriptions-item label="阅读进度">
              {{ bookInfo.durChapterTitle || '未阅读' }}
            </el-descriptions-item>
            <el-descriptions-item label="最后更新">
              {{ getLastUpdate(bookInfo.lastUpdateTime) }}
            </el-descriptions-item>
          </el-descriptions>

          <el-row :gutter="12" style="margin-top: 20px;">
            <el-col>
              <el-button type="primary" :icon="Collection" size="large" @click="startReading">
                立即阅读
              </el-button>
            </el-col>
            <el-col>
              <el-button :icon="Collection" size="large" @click="addToShelf">
                添加到书架
              </el-button>
            </el-col>
            <el-col>
              <el-button :icon="Search" size="large" @click="searchForSources">
                搜索其他来源
              </el-button>
            </el-col>
          </el-row>
        </el-card>
      </el-col>
    </el-row>

    <el-card style="margin-top: 20px;">
      <el-tabs>
        <el-tab-pane label="简介">
          <p class="book-intro">{{ bookInfo.intro || '暂无简介' }}</p>
        </el-tab-pane>
        <el-tab-pane label="目录">
          <el-scrollbar style="max-height: 400px;">
            <el-menu class="chapter-list" :default-active="String(bookInfo.durChapterIndex || 0)">
              <el-menu-item
                v-for="(ch, idx) in chapters"
                :key="idx"
                :index="String(idx)"
              >
                {{ idx + 1 }}. {{ ch.name }}
              </el-menu-item>
            </el-menu>
          </el-scrollbar>
        </el-tab-pane>
        <el-tab-pane label="可用书源" v-if="availableSources.length > 0">
          <el-table :data="availableSources" size="small">
            <el-table-column prop="bookSourceName" label="名称" min-width="150" />
            <el-table-column prop="bookSourceUrl" label="URL" min-width="200" />
            <el-table-column prop="bookSourceGroup" label="分组" width="120" />
            <el-table-column label="操作" width="100" fixed="right">
              <template #default="{ row }">
                <el-button
                  type="primary"
                  size="small"
                  text
                  @click="switchSource(row)"
                >
                  切换
                </el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>
      </el-tabs>
    </el-card>
  </div>
</template>

<style scoped>
.book-info-container {
  padding: 0;
}
.book-cover {
  width: 100%;
  height: 300px;
  border-radius: 4px;
}
.book-author {
  color: var(--el-text-color-secondary);
  margin: 8px 0;
}
.book-intro {
  line-height: 1.8;
  color: var(--el-text-color-regular);
}
.chapter-list .el-menu-item {
  font-size: 13px;
  padding: 4px 16px;
}
.cover-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 300px;
  color: #c0c4cc;
  background: #f5f7fa;
  font-size: 12px;
}
</style>
