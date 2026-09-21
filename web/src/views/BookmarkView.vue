<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { Plus, Delete, Edit, Search, Download } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox, ElTag } from 'element-plus'
import { useBookmarkStore } from '@/stores/bookmark'
import { useNotify, timeAgo } from '@/utils/helpers'
import type { Bookmark } from '@/api/types'

const { success, error } = useNotify()
const bookmarkStore = useBookmarkStore()

const searchQuery = ref('')
const showAdd = ref(false)
const bookmarkForm = ref<Partial<Bookmark>>({})
const selected = ref<Set<number>>(new Set())

onMounted(() => {
  bookmarkStore.loadBookmarks()
})

const filteredBookmarks = computed(() => {
  if (!searchQuery.value.trim()) return bookmarkStore.bookmarks
  const kw = searchQuery.value.toLowerCase()
  return bookmarkStore.bookmarks.filter(
    (b) =>
      b.bookName?.toLowerCase().includes(kw) ||
      b.chapterName?.toLowerCase().includes(kw) ||
      b.bookmarkText?.toLowerCase().includes(kw)
  )
})

const sortedBookmarks = computed(() => {
  return [...filteredBookmarks.value].sort((a, b) => (b.time || 0) - (a.time || 0))
})

async function addBookmark() {
  if (!bookmarkForm.value.bookName || !bookmarkForm.value.chapterUrl) {
    error('请填写完整')
    return
  }
  const res = await bookmarkStore.addBookmark(
    bookmarkForm.value.bookUrl || '',
    bookmarkForm.value.bookName || '',
    bookmarkForm.value.bookAuthor || '',
    bookmarkForm.value.chapterUrl || '',
    bookmarkForm.value.chapterName || '',
    bookmarkForm.value.bookmarkText || '',
    bookmarkForm.value.chapterIndex || 0,
    bookmarkForm.value.chapterPos || 0
  )
  if (res.isSuccess) {
    showAdd.value = false
    bookmarkForm.value = {}
  }
}

async function removeBookmark(time: number) {
  try {
    await ElMessageBox.confirm('确定删除？', '提示', { type: 'warning' })
    await bookmarkStore.removeBookmark(time)
  } catch { /* cancelled */ }
}

async function batchDelete() {
  if (selected.value.size === 0) return
  try {
    await ElMessageBox.confirm(`确定删除选中的 ${selected.value.size} 个书签吗？`, '提示', { type: 'warning' })
    const times = Array.from(selected.value)
    await bookmarkStore.removeBookmarks(times as number[])
    selected.value.clear()
  } catch { /* cancelled */ }
}

function toggleSelect(time: number) {
  if (selected.value.has(time)) {
    selected.value.delete(time)
  } else {
    selected.value.add(time)
  }
}

function selectAll() {
  if (selected.value.size === sortedBookmarks.value.length) {
    selected.value.clear()
  } else {
    sortedBookmarks.value.forEach((b) => selected.value.add(b.time))
  }
}
</script>

<template>
  <div class="bookmark-container">
    <el-row :gutter="20" style="margin-bottom: 16px;">
      <el-col :span="18">
        <el-input v-model="searchQuery" placeholder="搜索书签" :prefix-icon="Search" />
      </el-col>
      <el-col :span="6" style="text-align: right;">
        <el-button type="primary" :icon="Plus" @click="showAdd = true" v-if="selected.size === 0">
          添加
        </el-button>
        <el-button type="danger" :icon="Delete" @click="batchDelete" v-if="selected.size > 0">
          删除选中
        </el-button>
      </el-col>
    </el-row>

    <el-table
      :data="sortedBookmarks"
      stripe
      v-loading="bookmarkStore.loading"
      @selection-change=""
      style="width: 100%"
    >
      <el-table-column type="selection" :reserve-selection="true" />
      <el-table-column prop="bookName" label="书名" min-width="140" />
      <el-table-column prop="chapterName" label="章节" min-width="140" />
      <el-table-column prop="bookmarkText" label="内容摘要" min-width="200" />
      <el-table-column prop="time" label="书签时间" width="180">
        <template #default="{ row }">
          {{ row.time ? timeAgo(row.time) : '' }}
        </template>
      </el-table-column>
      <el-table-column label="操作" width="120" fixed="right">
        <template #default="{ row }">
          <el-button :icon="Delete" size="small" type="danger" text @click="removeBookmark(row.time)" />
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="showAdd" title="添加书签" width="500px" :append-to-body="false">
      <el-form :model="bookmarkForm" label-width="100px">
        <el-form-item label="书名">
          <el-input v-model="bookmarkForm.bookName" />
        </el-form-item>
        <el-form-item label="章节">
          <el-input v-model="bookmarkForm.chapterName" />
        </el-form-item>
        <el-form-item label="书籍URL">
          <el-input v-model="bookmarkForm.bookUrl" placeholder="书籍URL" />
        </el-form-item>
        <el-form-item label="章节URL">
          <el-input v-model="bookmarkForm.chapterUrl" placeholder="章节URL" />
        </el-form-item>
        <el-form-item label="内容">
          <el-input v-model="bookmarkForm.bookmarkText" type="textarea" :rows="3" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showAdd = false">取消</el-button>
        <el-button type="primary" @click="addBookmark">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.bookmark-container {
  padding: 0;
}
</style>
