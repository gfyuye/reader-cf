<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { getBookshelf as apiGetBookshelf, deleteBook as apiDeleteBook, cacheBookOnServer, deleteBookCache } from '@/api/book'
import { exportBook as apiExportBook } from '@/api/backup'
import { ElMessage, ElMessageBox, ElTag, ElTooltip } from 'element-plus'
import { Plus, Delete, Refresh, Download } from '@element-plus/icons-vue'
import { useNotify } from '@/utils/helpers'
import { useAuthStore } from '@/stores/auth'
import { useSettingsStore } from '@/stores/settings'
import type { Book } from '@/api/types'
import { useRouter } from 'vue-router'

const { success, error } = useNotify()
const authStore = useAuthStore()
const settingsStore = useSettingsStore()
const router = useRouter()

const books = ref<Book[]>([])
const loading = ref(false)
const searchQuery = ref('')
const cacheInfo = ref<any>(null)
const showCacheDialog = ref(false)
const selected = ref<Set<string>>(new Set())

const userNameSpace = computed(() => authStore.currentUserNS)

onMounted(() => {
  loadBooks()
})

async function loadBooks() {
  loading.value = true
  try {
    const res = await apiGetBookshelf(userNameSpace.value)
    if (res.isSuccess) {
      books.value = (res.data as Book[]) || []
    }
  } finally {
    loading.value = false
  }
}

const filteredBooks = computed(() => {
  if (!searchQuery.value.trim()) return books.value
  const kw = searchQuery.value.toLowerCase()
  return books.value.filter(
    (b) =>
      b.name?.toLowerCase().includes(kw) ||
      b.author?.toLowerCase().includes(kw) ||
      b.bookSource?.toLowerCase().includes(kw)
  )
})

async function deleteBook(bookUrl: string) {
  try {
    await ElMessageBox.confirm('确定要删除这本书吗？', '提示', { type: 'warning' })
    const res = await apiDeleteBook(bookUrl, userNameSpace.value)
    if (res.isSuccess) {
      success('已删除')
      loadBooks()
    }
  } catch { /* cancelled */ }
}

async function refreshBook(book: Book) {
  try {
    await ElMessageBox.confirm(`确定刷新《${book.name}》吗？`, '提示')
    const res = await apiGetBookshelf(userNameSpace.value)
    if (res.isSuccess) {
      success('刷新完成')
    }
  } catch { /* cancelled */ }
}

async function cacheBook(book: Book) {
  const res = await cacheBookOnServer(book.bookUrl, userNameSpace.value)
  if (res.isSuccess) {
    ElMessage.success('缓存任务已提交')
  }
}

async function clearCache(book: Book) {
  const res = await deleteBookCache(book.bookUrl, userNameSpace.value)
  if (res.isSuccess) {
    success('缓存已清除')
  }
}

async function exportBook(book: Book) {
  const res = await apiExportBook(book.bookUrl)
  if (res.isSuccess) {
    success('导出完成')
  }
}

async function batchDelete() {
  if (selected.value.size === 0) return
  try {
    await ElMessageBox.confirm(`确定删除选中的 ${selected.value.size} 本书吗？`, '提示', { type: 'warning' })
    const urls = books.value
      .filter((b) => selected.value.has(b.bookUrl))
      .map((b) => b.bookUrl)
    const res = await apiDeleteBook(urls[0], userNameSpace.value)
    if (res.isSuccess) {
      success('已删除')
      selected.value.clear()
      loadBooks()
    }
  } catch { /* cancelled */ }
}
</script>

<template>
  <div class="book-manage-container">
    <el-row :gutter="20" style="margin-bottom: 16px;">
      <el-col :span="8">
        <el-input v-model="searchQuery" placeholder="搜索书籍" :prefix-icon="Plus" />
      </el-col>
      <el-col :span="16" style="text-align: right;">
        <el-button :icon="Refresh" @click="loadBooks">
          刷新
        </el-button>
        <el-button type="danger" :icon="Delete" :disabled="selected.size === 0" @click="batchDelete">
          批量删除
        </el-button>
      </el-col>
    </el-row>

    <el-table :data="filteredBooks" stripe v-loading="loading" style="width: 100%">
      <el-table-column type="selection" />
      <el-table-column prop="name" label="书名" min-width="200" />
      <el-table-column prop="author" label="作者" width="150" />
      <el-table-column prop="bookSource" label="书源" min-width="150" />
      <el-table-column prop="chapterCount" label="章节" width="80" />
      <el-table-column prop="lastUpdateTime" label="更新时间" width="160">
        <template #default="{ row }">
          {{ row.lastUpdateTime ? new Date(row.lastUpdateTime).toLocaleString() : '-' }}
        </template>
      </el-table-column>
      <el-table-column prop="canUpdate" label="可更新" width="80">
        <template #default="{ row }">
          <el-tag :type="row.canUpdate ? 'danger' : 'success'" size="small">
            {{ row.canUpdate ? '是' : '否' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="200" fixed="right">
        <template #default="{ row }">
          <ElTooltip content="阅读" placement="top">
            <el-button type="primary" size="small" text @click="router.push(`/reader/${row.bookUrl}`)">
              阅读
            </el-button>
          </ElTooltip>
          <ElTooltip content="缓存" placement="top">
            <el-button size="small" text @click="cacheBook(row)">
              缓存
            </el-button>
          </ElTooltip>
          <ElTooltip content="导出" placement="top">
            <el-button :icon="Download" size="small" text @click="exportBook(row)" />
          </ElTooltip>
          <ElTooltip content="清除缓存" placement="top">
            <el-button :icon="Delete" size="small" type="danger" text @click="clearCache(row)" />
          </ElTooltip>
          <ElTooltip content="删除" placement="top">
            <el-button :icon="Delete" size="small" type="danger" text @click="deleteBook(row.bookUrl)" />
          </ElTooltip>
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>

<style scoped>
.book-manage-container {
  padding: 0;
}
</style>
