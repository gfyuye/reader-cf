<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { Collection, ArrowLeft, ArrowRight } from '@element-plus/icons-vue'
import { getShelfBook, getChapterList, getBookContent } from '@/api/book'

const route = useRoute()
const bookUrl = route.params.bookUrl as string
const currentBook = ref<any>(null)
const chapters = ref<any[]>([])
const currentChapterIndex = ref(0)
const content = ref('')
const loading = ref(false)

async function loadBook() {
  if (!bookUrl) return
  loading.value = true
  try {
    const bookRes = await getShelfBook(bookUrl)
    if (bookRes.isSuccess && bookRes.data) {
      currentBook.value = bookRes.data
    }
    const chapterRes = await getChapterList(bookUrl)
    if (chapterRes.isSuccess) {
      chapters.value = chapterRes.data || []
    }
    if (chapters.value.length > 0) {
      loadChapter(0)
    }
  } finally {
    loading.value = false
  }
}

async function loadChapter(index: number) {
  if (index < 0 || index >= chapters.value.length) return
  currentChapterIndex.value = index
  const chapter = chapters.value[index]
  const res = await getBookContent(currentBook.value.bookUrl, chapter.chapterUrl, index)
  if (res.isSuccess) {
    content.value = res.data
  }
}

function prevChapter() {
  if (currentChapterIndex.value > 0) loadChapter(currentChapterIndex.value - 1)
}

function nextChapter() {
  if (currentChapterIndex.value < chapters.value.length - 1) loadChapter(currentChapterIndex.value + 1)
}

onMounted(() => { loadBook() })
</script>

<template>
  <div class="reader-container" v-if="currentBook">
    <div class="reader-sidebar">
      <el-icon :size="22"><Collection /></el-icon>
      <span>目录</span>
    </div>
    <div class="reader-content">
      <div class="reader-header">
        <h2>{{ currentBook.name }}</h2>
        <span class="reader-author">{{ currentBook.author }}</span>
      </div>
      <div class="reader-chapter-bar">
        <el-button :icon="ArrowLeft" size="small" @click="prevChapter" :disabled="currentChapterIndex === 0">上一章</el-button>
        <span class="chapter-name">{{ chapters[currentChapterIndex]?.name || '' }}</span>
        <el-button :icon="ArrowRight" size="small" @click="nextChapter" :disabled="currentChapterIndex === chapters.length - 1">下一章</el-button>
      </div>
      <div class="reader-text">
        <div v-if="loading" class="loading">加载中...</div>
        <div v-else class="chapter-content" v-html="content"></div>
      </div>
    </div>
    <div class="reader-toc">
      <el-tree
        :data="[{ label: '章节', children: chapters.map((c, i) => ({ label: c.name, chapterIndex: i })) }]"
        :default-expanded-keys="[0]"
        highlight-current
        node-key="chapterIndex"
        @node-click="(data: any) => loadChapter(data.chapterIndex)"
      />
    </div>
  </div>
  <div v-else class="loading">加载中...</div>
</template>
