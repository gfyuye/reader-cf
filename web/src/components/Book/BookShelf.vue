<script setup lang="ts">
import { ref, onMounted, defineProps } from 'vue'
import { getBookshelf } from '@/api/book'
import { useAuthStore } from '@/stores/auth'
import { ElMessage } from 'element-plus'
import { CollectionTag, Edit, Delete } from '@element-plus/icons-vue'

const props = defineProps<{ bookUrl?: string }>()
const authStore = useAuthStore()
const books = ref<any[]>([])
const loading = ref(false)
const showAdd = ref(false)
const showContent = ref(false)
const currentChapter = ref(0)
const chapterList = ref<any[]>([])
const content = ref('')

async function loadBookshelf() {
  if (!authStore.isLoggedIn) return
  loading.value = true
  try {
    const res = await getBookshelf()
    if (res.isSuccess) books.value = res.data || []
  } finally {
    loading.value = false
  }
}

async function openBook(bookUrl: string) {
  // Navigate to reader
}

onMounted(() => { loadBookshelf() })
</script>

<template>
  <div class="bookshelf">
    <div v-if="loading" class="loading">加载中...</div>
    <div v-else-if="books.length === 0" class="empty">书架为空，添加一本吧</div>
    <div v-else class="books-grid">
      <div v-for="book in books" :key="book.bookUrl" class="book-item" @click="openBook(book.bookUrl)">
        <div class="book-cover">
          <el-image :src="book.coverUrl" fit="cover">
            <template #error>
              <div class="placeholder">无封面</div>
            </template>
          </el-image>
        </div>
        <div class="book-meta">
          <div class="book-name">{{ book.name }}</div>
          <div class="book-author">{{ book.author }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.bookshelf {
  padding: 16px;
}
.loading, .empty {
  text-align: center;
  padding: 60px 0;
  color: #909399;
}
.books-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 16px;
}
.book-item {
  cursor: pointer;
  transition: transform 0.2s;
}
.book-item:hover {
  transform: translateY(-4px);
}
.book-cover {
  width: 100%;
  height: 200px;
  border-radius: 4px;
  overflow: hidden;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
}
.book-cover .placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f5f7fa;
  color: #c0c4cc;
  font-size: 12px;
}
.book-meta {
  margin-top: 8px;
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
  margin-top: 2px;
}
</style>
