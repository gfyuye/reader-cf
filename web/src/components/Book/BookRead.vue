<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { getBookInfo, getChapterList, getBookContent } from '@/api/book'

const props = defineProps<{ bookUrl: string }>()
const book = ref<any>(null)
const chapters = ref<any[]>([])
const currentChapter = ref(0)
const content = ref('')

async function load() {
  const infoRes = await getBookInfo(props.bookUrl)
  if (infoRes.isSuccess) book.value = infoRes.data
  const chRes = await getChapterList(props.bookUrl)
  if (chRes.isSuccess) chapters.value = chRes.data || []
  if (chapters.value.length) {
    await loadContent(0)
  }
}

async function loadContent(index: number) {
  if (!book.value) return
  currentChapter.value = index
  const c = chapters.value[index]
  const res = await getBookContent(book.value.bookUrl, c.chapterUrl, index)
  if (res.isSuccess) content.value = res.data
}

onMounted(() => { load() })
</script>

<template>
  <div v-if="book" class="reader-component">
    <div class="reader-header">
      <h3>{{ book.name }}</h3>
      <span>{{ book.author }}</span>
    </div>
    <div class="reader-nav">
      <button :disabled="currentChapter === 0" @click="loadContent(currentChapter - 1)">上一章</button>
      <span>{{ chapters[currentChapter]?.name }}</span>
      <button :disabled="currentChapter === chapters.length - 1" @click="loadContent(currentChapter + 1)">下一章</button>
    </div>
    <div class="reader-text" v-html="content"></div>
  </div>
</template>

<style scoped>
.reader-header {
  margin-bottom: 16px;
}
.reader-nav {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  padding: 8px 0;
  border-bottom: 1px solid #eee;
}
.reader-text {
  line-height: 2;
  font-size: 16px;
  max-width: 720px;
  margin: 0 auto;
  padding: 0 20px;
}
</style>
