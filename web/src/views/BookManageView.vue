<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { getBookshelf as apiGetBookshelf, deleteBook as apiDeleteBook } from '@/api/book'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useNotify } from '@/utils/helpers'

const { success, error } = useNotify()
const books = ref<any[]>([])
const loading = ref(false)

async function loadBooks() {
  loading.value = true
  try {
    const res = await apiGetBookshelf()
    if (res.isSuccess) books.value = res.data || []
  } finally {
    loading.value = false
  }
}

async function deleteBook(bookUrl: string) {
  try {
    await ElMessageBox.confirm('确定要删除这本书吗？', '提示', { type: 'warning' })
    const res = await apiDeleteBook(bookUrl)
    if (res.isSuccess) {
      success('已删除')
      loadBooks()
    }
  } catch { /* cancelled */ }
}

onMounted(() => { loadBooks() })
</script>

<template>
  <div>
    <h2>书籍管理</h2>
    <el-table :data="books" stripe v-loading="loading">
      <el-table-column prop="name" label="书名" min-width="200" />
      <el-table-column prop="author" label="作者" width="150" />
      <el-table-column prop="bookSource" label="书源" width="150" />
      <el-table-column prop="chapterCount" label="章节" width="100" />
      <el-table-column label="操作" width="120" fixed="right">
        <template #default="{ row }">
          <el-button text size="small" type="danger" @click="deleteBook(row.bookUrl)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>
