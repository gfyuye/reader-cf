<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useBookmarkStore } from '@/stores/bookmark'
import { ElMessage } from 'element-plus'

interface Props {
  bookUrl: string
  bookName: string
  bookAuthor: string
  chapterUrl: string
  chapterName: string
  chapterIndex: number
  chapterPos: number
}

const props = withDefaults(defineProps<Props>(), {})
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'tts', text: string): void
}>()

const visible = ref(true)
const position = ref({ x: 0, y: 0 })
const selectedText = ref('')

const bookmarkStore = useBookmarkStore()

function getSelectionText(): string {
  const sel = window.getSelection()
  if (sel && sel.rangeCount > 0) {
    return sel.toString()
  }
  return ''
}

function handleCopy() {
  navigator.clipboard.writeText(selectedText.value)
  ElMessage.success('已复制')
  emit('close')
}

async function handleBookmark() {
  await bookmarkStore.addBookmark(
    props.bookUrl,
    props.bookName,
    props.bookAuthor,
    props.chapterUrl,
    props.chapterName,
    selectedText.value,
    props.chapterIndex,
    props.chapterPos
  )
  emit('close')
}

function handleTTS() {
  emit('tts', selectedText.value)
}

function handleClose() {
  emit('close')
}

function handlePosition(e: MouseEvent) {
  const rect = {
    x: e.clientX,
    y: e.clientY,
  }
  position.value = rect
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    handleClose()
  }
}

onMounted(() => {
  selectedText.value = getSelectionText()
  document.addEventListener('selectionchange', handlePosition as EventListener)
  document.addEventListener('mousedown', handleClose)
  document.addEventListener('keydown', handleKeydown)
})

onBeforeUnmount(() => {
  document.removeEventListener('selectionchange', handlePosition as EventListener)
  document.removeEventListener('mousedown', handleClose)
  document.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <div
    v-if="visible"
    class="text-select-menu"
    :style="{ left: position.x + 'px', top: position.y + 'px' }"
  >
    <el-button type="text" size="small" @click="handleCopy">
      复制
    </el-button>
    <el-button type="text" size="small" @click="handleBookmark">
      加书签
    </el-button>
    <el-button type="text" size="small" @click="handleTTS">
      朗读
    </el-button>
    <el-button type="text" size="small" @click="handleClose">
      关闭
    </el-button>
  </div>
</template>

<style scoped>
.text-select-menu {
  position: fixed;
  z-index: 2000;
  background: var(--el-color-overlay-lighten-2);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  padding: 4px 8px;
  display: flex;
  gap: 4px;
  backdrop-filter: blur(4px);
}
.text-select-menu :global(.el-button) {
  padding: 4px 8px;
}
</style>
