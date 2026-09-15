<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { Search } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { searchBook, searchBookMulti, searchBookSource } from '@/api/book'
import { useNotify } from '@/utils/helpers'
import { usePagination } from '@/utils/helpers'

const key = ref('')
const page = ref(1)
const results = ref<any[]>([])
const loading = ref(false)
const hasMore = ref(true)
const lastIndex = ref(-1)
const { success, error } = useNotify()
const { total } = usePagination(20)

const searchType = ref('single')

async function doSearch() {
  if (!key.value.trim()) {
    ElMessage.warning('请输入搜索关键字')
    return
  }
  loading.value = true
  try {
    if (searchType.value === 'single') {
      const res = await searchBook(key.value, page.value)
      if (res.isSuccess) {
        results.value = res.data || []
      }
    } else {
      const res = await searchBookMulti(key.value, '', -1, 20, 36)
      if (res.isSuccess) {
        results.value = res.data?.list || []
      }
    }
  } finally {
    loading.value = false
  }
}

async function loadMore() {
  if (!hasMore.value || loading.value) return
  loading.value = true
  try {
    const res = await searchBookMulti(key.value, '', lastIndex.value, 20, 36)
    if (res.isSuccess) {
      const newList = res.data?.list || []
      results.value.push(...newList)
      lastIndex.value = res.data?.lastIndex || lastIndex.value
      hasMore.value = newList.length > 0
    }
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="search-container">
    <el-input v-model="key" placeholder="输入书名/作者搜索..." class="search-input" :prefix-icon="Search" @keyup.enter="doSearch" />
    <el-radio-group v-model="searchType" style="margin: 16px 0;">
      <el-radio-button value="single">单书源</el-radio-button>
      <el-radio-button value="multi">多书源</el-radio-button>
    </el-radio-group>
    <el-button type="primary" :loading="loading" @click="doSearch">搜索</el-button>
    <div class="search-results">
      <el-card v-for="(book, idx) in results" :key="idx" class="book-card" shadow="hover">
        <div class="book-card-inner">
          <el-image :src="book.coverUrl" fit="cover" class="book-card-cover">
            <template #error>
              <div class="cover-fallback">无封面</div>
            </template>
          </el-image>
          <div class="book-card-info">
            <h3 class="book-card-title">{{ book.name }}</h3>
            <p class="book-card-author">{{ book.author }}</p>
            <p class="book-card-source">{{ book.bookSource }}</p>
          </div>
        </div>
      </el-card>
      <el-button v-if="hasMore" :loading="loading" @click="loadMore" type="primary" plain>加载更多</el-button>
    </div>
  </div>
</template>

<style scoped>
.search-input {
  max-width: 500px;
}
.search-results {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 16px;
  margin-top: 16px;
}
.book-card {
  cursor: pointer;
}
.book-card-inner {
  display: flex;
  gap: 12px;
}
.book-card-cover {
  width: 80px;
  height: 110px;
  flex-shrink: 0;
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
.book-card-title {
  font-size: 14px;
  margin: 0 0 4px 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.book-card-author {
  font-size: 12px;
  color: #909399;
  margin: 0;
}
.book-card-source {
  font-size: 12px;
  color: #c0c4cc;
  margin: 4px 0 0 0;
}
</style>
