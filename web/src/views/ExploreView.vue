<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { Compass, Search, Loading } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { exploreBook } from '@/api/book'
import { useNotify } from '@/utils/helpers'
import { useAuthStore } from '@/stores/auth'
import { useRouter } from 'vue-router'
import type { SearchBook } from '@/api/types'

const { error } = useNotify()
const authStore = useAuthStore()
const router = useRouter()

const discoverUrl = ref('')
const page = ref(1)
const results = ref<SearchBook[]>([])
const loading = ref(false)
const hasMore = ref(false)

const userNameSpace = computed(() => authStore.currentUserNS)

onMounted(() => {
  discoverUrl.value = 'https://www.ptjspz.com/modules/article/lastupdate.php?page='
})

async function doExplore() {
  if (!discoverUrl.value.trim()) {
    ElMessage.warning('请输入探索URL')
    return
  }
  page.value = 1
  results.value = []
  loading.value = true
  try {
    const res = await exploreBook(discoverUrl.value, page.value, userNameSpace.value)
    if (res.isSuccess) {
      const data = res.data as any
      const list = data?.list || data || []
      results.value = list
      hasMore.value = list.length >= 20
    }
  } finally {
    loading.value = false
  }
}

async function loadMore() {
  if (!hasMore.value || loading.value) return
  loading.value = true
  try {
    const nextPage = page.value + 1
    const res = await exploreBook(discoverUrl.value, nextPage, userNameSpace.value)
    if (res.isSuccess) {
      const data = res.data as any
      const list = data?.list || data || []
      results.value.push(...list)
      page.value = nextPage
      hasMore.value = list.length >= 20
    }
  } finally {
    loading.value = false
  }
}

function toBook(book: SearchBook) {
  router.push(`/book-info/${book.bookUrl}`)
}
</script>

<template>
  <div class="explore-container">
    <h3>发现</h3>
    <div class="explore-toolbar">
      <el-input
        v-model="discoverUrl"
        placeholder="请输入探索页面URL"
        :prefix-icon="Compass"
        @keyup.enter="doExplore"
      />
      <el-button type="primary" :loading="loading" @click="doExplore" :icon="Search">
        探索
      </el-button>
    </div>

    <el-card v-for="book in results" :key="book.bookUrl" shadow="hover" class="explore-card" @click="toBook(book)">
      <div class="book-info">
        <h4>{{ book.name }}</h4>
        <p>{{ book.author }} - {{ book.bookSource }}</p>
        <p v-if="book.intro" class="book-intro">{{ book.intro }}</p>
      </div>
    </el-card>

    <el-button v-if="hasMore" :loading="loading" type="primary" plain @click="loadMore">
      加载更多
    </el-button>

    <el-empty v-if="!loading && results.length === 0" description="输入URL后开始探索" />
  </div>
</template>

<style scoped>
.explore-container {
  padding: 0;
}
.explore-toolbar {
  display: flex;
  gap: 12px;
  margin-bottom: 20px;
}
.explore-card {
  cursor: pointer;
  transition: transform 0.2s;
  margin-bottom: 12px;
}
.explore-card:hover {
  transform: translateY(-2px);
}
.book-info h4 {
  margin: 0 0 4px 0;
  font-size: 14px;
  font-weight: bold;
}
.book-info p {
  margin: 2px 0;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
.book-intro {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
