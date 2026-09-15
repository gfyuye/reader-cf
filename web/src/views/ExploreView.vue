<script setup lang="ts">
import { ref } from 'vue'
import { exploreBook } from '@/api/book'
import { ElMessage } from 'element-plus'

const ruleFindUrl = ref('')
const page = ref(1)
const results = ref<any[]>([])
const loading = ref(false)
const hasMore = ref(true)

async function doExplore() {
  if (!ruleFindUrl.value.trim()) return
  loading.value = true
  try {
    const res = await exploreBook(ruleFindUrl.value, page.value)
    if (res.isSuccess) {
      results.value = res.data || []
    }
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="explore-container">
    <h3>探索</h3>
    <el-input v-model="ruleFindUrl" placeholder="输入探索页面URL" />
    <el-button type="primary" :loading="loading" @click="doExplore" style="margin-left: 8px;">探索</el-button>
    <el-card v-for="(book, idx) in results" :key="idx" class="explore-card" shadow="hover">
      <div class="book-info">
        <h4>{{ book.name }}</h4>
        <p>{{ book.author }} | {{ book.bookSource }}</p>
      </div>
    </el-card>
  </div>
</template>
