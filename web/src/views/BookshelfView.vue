<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { getBookshelf as apiGetBookshelf, saveBook as apiSaveBook, deleteBook as apiDeleteBook } from '@/api/book'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useNotify } from '@/utils/helpers'
import { Book } from '@/api/types'

const { success, error } = useNotify()
const books = ref<Book[]>([])
const loading = ref(false)
const showAdd = ref(false)
const newBook = ref<Partial<Book>>({})
const searchQuery = ref('')

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
    await ElMessageBox.confirm('确定要移除这本书吗？', '提示', { type: 'warning' })
    const res = await apiDeleteBook(bookUrl)
    if (res.isSuccess) {
      success('已移除')
      loadBooks()
    }
  } catch { /* cancelled */ }
}

onMounted(() => { loadBooks() })
</script>

<template>
  <div class="bookshelf-container">
    <el-row :gutter="20" style="margin-bottom: 16px;">
      <el-col :span="16">
        <el-input v-model="searchQuery" placeholder="搜索书架..." />
      </el-col>
      <el-col :span="8" style="text-align: right;">
        <el-button type="primary">添加书籍</el-button>
      </el-col>
    </el-row>
    <el-row :gutter="16">
      <el-col v-for="book in books" :key="book.bookUrl" :xs="12" :sm="8" :md="6" :lg="4">
        <el-card shadow="hover" class="book-card" @click="$router.push(`/reader/${book.bookUrl}`)">
          <el-image :src="book.coverUrl" fit="cover" class="book-cover">
            <template #error>
              <div class="cover-placeholder">无封面</div>
            </template>
          </el-image>
          <div class="book-info">
            <div class="book-name" :title="book.name">{{ book.name }}</div>
            <div class="book-author">{{ book.author }}</div>
          </div>
        </el-card>
      </el-col>
    </el-row>
    <el-empty v-if="!loading && books.length === 0" description="书架为空" />
  </div>
</template>

<style scoped>
.bookshelf-container {
  padding: 0;
}
.book-card {
  cursor: pointer;
  transition: transform 0.2s;
}
.book-card:hover {
  transform: translateY(-4px);
}
.book-cover {
  width: 100%;
  height: 180px;
}
.cover-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 180px;
  color: #c0c4cc;
  background: #f5f7fa;
  font-size: 12px;
}
.book-info {
  padding: 8px 0 0 0;
}
.book-name {
  font-size: 14px;
  font-weight: bold;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.book-author {
  font-size: 12px;
  color: #909399;
  margin-top: 4px;
}
</style>
