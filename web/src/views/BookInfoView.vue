<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { getBookInfo, searchBookSource } from '@/api/book'
import { getBookSources } from '@/api/bookSource'
import { useAuthStore } from '@/stores/auth'

const route = useRoute()
const authStore = useAuthStore()
const bookUrl = route.params.bookUrl as string
const bookInfo = ref<any>(null)
const sources = ref<any[]>([])
const selectedSource = ref('')
const loading = ref(false)

async function loadBookInfo() {
  if (!bookUrl) return
  loading.value = true
  try {
    const res = await getBookInfo(bookUrl)
    if (res.isSuccess) {
      bookInfo.value = res.data
    }
    const srcRes = await getBookSources()
    if (srcRes.isSuccess) {
      sources.value = srcRes.data || []
    }
  } finally {
    loading.value = false
  }
}

async function trySource(source: any) {
  selectedSource.value = source.bookSourceUrl
  loading.value = true
  try {
    const res = await searchBookSource(bookUrl, 0, 5, '', source.bookSourceUrl)
    if (res.isSuccess) {
      // Handle results
    }
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  loadBookInfo()
})
</script>

<template>
  <div class="book-info-container" v-if="bookInfo && !loading">
    <el-row :gutter="20">
      <el-col :span="8">
        <el-card>
          <el-image :src="bookInfo.coverUrl" fit="cover" class="book-cover">
            <template #error>
              <div class="cover-placeholder">无封面</div>
            </template>
          </el-image>
        </el-card>
      </el-col>
      <el-col :span="16">
        <el-card>
          <h2>{{ bookInfo.name }}</h2>
          <p class="book-author">作者: {{ bookInfo.author }}</p>
          <p class="book-intro">{{ bookInfo.intro }}</p>
          <el-descriptions :column="2" border size="small">
            <el-descriptions-item label="书源">{{ bookInfo.bookSource }}</el-descriptions-item>
            <el-descriptions-item label="章节数">{{ bookInfo.chapterCount }}</el-descriptions-item>
            <el-descriptions-item label="链接">{{ bookInfo.bookUrl }}</el-descriptions-item>
          </el-descriptions>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<style scoped>
.book-cover {
  width: 100%;
  height: 300px;
}
.cover-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 300px;
  color: #c0c4cc;
  background: #f5f7fa;
}
.book-author {
  color: #606266;
  margin: 8px 0;
}
.book-intro {
  color: #909399;
  font-size: 14px;
  line-height: 1.6;
  margin: 16px 0;
}
</style>
