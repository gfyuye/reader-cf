<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import type { BookChapter } from '@/api/types'
import { ElInput, ElCollapse, ElCollapseItem, ElTag } from 'element-plus'

interface Props {
  chapters: BookChapter[]
  currentIndex: number
  visible: boolean
  searchKeyword?: string
  readChapterIndex?: number // 已读章节索引
}

const props = withDefaults(defineProps<Props>(), {
  chapters: () => [],
  currentIndex: 0,
  visible: true,
  searchKeyword: '',
  readChapterIndex: -1,
})

const emit = defineEmits<{
  (e: 'jump-to', index: number): void
  (e: 'update:visible', v: boolean): void
  (e: 'search', keyword: string): void
}>()

const searchQuery = ref('')
const activeNames = ref<string[]>(['all'])

const filteredChapters = computed(() => {
  let result = props.chapters
  if (searchQuery.value.trim()) {
    const kw = searchQuery.value.toLowerCase()
    result = result.filter(
      (c) =>
        c.name?.toLowerCase().includes(kw) || c.chapterUrl?.toLowerCase().includes(kw)
    )
  }
  return result
})

// 按卷分组
const volumeGroups = computed(() => {
  const groups: Record<string, BookChapter[]> = {}
  const noVolumeKey = '__no_volume__'
  
  filteredChapters.value.forEach((chapter, idx) => {
    const volume = chapter.volumeName || chapter.volume || noVolumeKey
    if (!groups[volume]) groups[volume] = []
    groups[volume].push({ ...chapter, originalIndex: idx })
  })
  
  return groups
})

const volumeNames = computed(() => {
  const names = Object.keys(volumeGroups.value)
  // 将无卷名的放到最后
  return names.sort((a, b) => {
    if (a === '__no_volume__') return 1
    if (b === '__no_volume__') return -1
    return a.localeCompare(b)
  })
})

function handleJump(index: number) {
  emit('jump-to', index)
}

function getVolumeDisplayName(volume: string): string {
  if (volume === '__no_volume__') return '正文'
  return volume
}

function isCurrentChapter(idx: number): boolean {
  return idx === props.currentIndex
}

function isReadChapter(idx: number): boolean {
  return props.readChapterIndex >= 0 && idx < props.readChapterIndex
}

function isVipChapter(chapter: BookChapter): boolean {
  return chapter.isVip === true || chapter.isVip === 1
}

watch(searchQuery, (val) => {
  emit('search', val)
})

watch(() => props.searchKeyword, (val) => {
  if (val !== undefined) {
    searchQuery.value = val
  }
}, { immediate: true })
</script>

<template>
  <div class="chapter-catalog">
    <div class="catalog-header">
      <el-input
        v-model="searchQuery"
        placeholder="搜索章节"
        size="small"
        clearable
      />
    </div>
    <el-scrollbar style="height: calc(100% - 50px)">
      <el-collapse v-model="activeNames" accordion>
        <el-collapse-item
          v-for="volume in volumeNames"
          :key="volume"
          :name="volume"
          :disabled="volumeGroups[volume].length === 0"
        >
          <template #title>
            <div class="volume-title">
              <span>{{ getVolumeDisplayName(volume) }}</span>
              <el-tag size="small" type="info">{{ volumeGroups[volume].length }} 章</el-tag>
            </div>
          </template>
          <el-menu class="chapter-menu" :default-active="String(props.currentIndex)" highlight-current>
            <el-menu-item
              v-for="(chapter, idx) in volumeGroups[volume]"
              :key="chapter.originalIndex"
              :index="String(chapter.originalIndex)"
              :title="chapter.name"
              @click="handleJump(chapter.originalIndex)"
              :class="{
                'current-chapter': chapter.originalIndex === props.currentIndex,
                'read-chapter': isReadChapter(chapter.originalIndex),
                'unread-chapter': !isReadChapter(chapter.originalIndex) && chapter.originalIndex !== props.currentIndex,
              }"
            >
              <span class="chapter-index">{{ chapter.originalIndex + 1 }}</span>
              <span class="chapter-name">{{ chapter.name }}</span>
              <el-tag v-if="isVipChapter(chapter)" size="small" type="warning" class="vip-tag">VIP</el-tag>
            </el-menu-item>
          </el-menu>
        </el-collapse-item>
      </el-collapse>
    </el-scrollbar>
  </div>
</template>

<style scoped>
.chapter-catalog {
  width: 260px;
  border-left: 1px solid var(--border-light);
  background: var(--bg-color);
  display: flex;
  flex-direction: column;
}
.catalog-header {
  padding: 12px;
  border-bottom: 1px solid var(--border-light);
}
.chapter-menu {
  flex: 1;
  overflow-y: auto;
}
.chapter-menu .el-menu-item {
  padding: 6px 16px 6px 12px;
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.chapter-index {
  display: inline-block;
  width: 24px;
  color: var(--el-text-color-secondary);
  text-align: right;
  margin-right: 8px;
  flex-shrink: 0;
}
.chapter-name {
  display: inline-block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}
.vip-tag {
  flex-shrink: 0;
  margin-left: auto;
}
.current-chapter {
  background-color: var(--el-color-primary-light-8) !important;
  font-weight: bold;
}
.read-chapter {
  opacity: 0.6;
}
.read-chapter .chapter-name {
  text-decoration: line-through;
  color: var(--el-text-color-secondary);
}
.unread-chapter .chapter-name {
  font-weight: 500;
}
.volume-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  font-weight: 500;
}
:deep(.el-collapse-item__header) {
  padding: 8px 12px !important;
  background: var(--bg-page, #f0f2f5);
}
:deep(.el-collapse-item__header:hover) {
  background: var(--el-color-primary-light-9) !important;
}
@media (max-width: 768px) {
  .chapter-catalog {
    position: absolute;
    z-index: 100;
    height: 100vh;
    width: 90vw;
    max-width: 320px;
  }
}
</style>
