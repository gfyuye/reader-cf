<script setup lang="ts">
import { ref } from 'vue'
import { Search } from '@element-plus/icons-vue'
import type { SearchBook } from '@/api/types'
import { get } from '@/api/http'

const key = ref('')
const results = ref<SearchBook[]>([])
const loading = ref(false)

async function search() {
  if (!key.value.trim()) return
  loading.value = true
  try {
    const res = await get<SearchBook[]>('/searchBook', { key: key.value, page: 1 })
    if (res.isSuccess) results.value = res.data || []
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div>
    <el-input v-model="key" placeholder="搜索书籍..." :prefix-icon="Search" @keyup.enter="search">
      <template #append>
        <el-button type="primary" @click="search" :loading="loading">搜索</el-button>
      </template>
    </el-input>
    <el-card v-for="book in results" :key="book.bookUrl" shadow="hover" style="margin-top: 12px;">
      <div class="search-result">
        <el-image :src="book.coverUrl" fit="cover" style="width: 80px; height: 110px;">
          <template #error>
            <div style="width: 80px; height: 110px; display: flex; align-items: center; justify-content: center; background: #f5f7fa; color: #c0c4cc; font-size: 12px;">无封面</div>
          </template>
        </el-image>
        <div class="result-info">
          <h4>{{ book.name }}</h4>
          <p>{{ book.author }}</p>
          <p>{{ book.bookSource }}</p>
        </div>
      </div>
    </el-card>
  </div>
</template>

<style scoped>
.search-result {
  display: flex;
  gap: 16px;
}
.result-info {
  flex: 1;
}
.result-info h4 {
  margin: 0 0 4px 0;
}
.result-info p {
  margin: 2px 0;
  color: #909399;
  font-size: 13px;
}
</style>