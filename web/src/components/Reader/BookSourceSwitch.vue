<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { ElMessage, ElTag } from 'element-plus'
import {
  getAvailableBookSource,
  searchBookSource,
  setBookSource,
} from '@/api/book'
import type { BookSource } from '@/api/types'

interface Props {
  bookUrl: string
  currentSource: string
  visible: boolean
}

const props = withDefaults(defineProps<Props>(), {
  bookUrl: '',
  currentSource: '',
  visible: false,
})

const emit = defineEmits<{
  (e: 'update:visible', v: boolean): void
  (e: 'switch-source', sourceUrl: string): void
}>()

const sources = ref<BookSource[]>([])
const searchResults = ref<BookSource[]>([])
const loading = ref(false)
const searching = ref(false)
const searchKey = ref('')
const lastIndex = ref(-1)
const hasMore = ref(true)

onMounted(() => {
  if (props.visible && props.bookUrl) {
    loadSources()
  }
})

async function loadSources() {
  if (!props.bookUrl) return
  loading.value = true
  try {
    const res = await getAvailableBookSource(props.bookUrl)
    if (res.isSuccess) {
      sources.value = (res.data as BookSource[]) || []
    }
  } finally {
    loading.value = false
  }
}

async function searchMore() {
  if (!searchKey.value.trim() || !props.bookUrl || !hasMore.value) return
  searching.value = true
  try {
    const res = await searchBookSource(
      props.bookUrl,
      lastIndex.value,
      20,
      '',
      ''
    )
    if (res.isSuccess) {
      const newSources = (res.data as BookSource[]) || []
      searchResults.value.push(...newSources)
      lastIndex.value = res.data?.lastIndex || lastIndex.value
      hasMore.value = newSources.length > 0 && newSources.length === 20
    }
  } finally {
    searching.value = false
  }
}

function switchSource(source: BookSource) {
  emit('switch-source', source.bookSourceUrl)
  emit('update:visible', false)
}

function getSourceType(source: BookSource): string {
  const types: Record<string, string> = {
    '0': '小说',
    '1': '漫画',
    '2': '音频',
    '3': '视频',
    '4': '小说',
  }
  return types[source.bookSourceType || '0'] || '其他'
}

function isCurrent(source: BookSource): boolean {
  return source.bookSourceUrl === props.currentSource
}
</script>

<template>
  <el-dialog
    v-model="props.visible"
    title="换源"
    width="700px"
    :append-to-body="false"
  >
    <div class="source-tabs">
      <el-tabs type="border-card">
        <el-tab-pane label="可用书源">
          <el-table
            :data="sources"
            stripe
            v-loading="loading"
            style="width: 100%"
          >
            <el-table-column prop="bookSourceName" label="名称" min-width="150" />
            <el-table-column prop="bookSourceUrl" label="URL" min-width="200" />
            <el-table-column prop="bookSourceGroup" label="分组" width="120" />
            <el-table-column label="类型" width="80">
              <template #default="{ row }">
                <el-tag size="small">{{ getSourceType(row) }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="120" fixed="right">
              <template #default="{ row }">
                <el-button
                  type="primary"
                  size="small"
                  text
                  :disabled="isCurrent(row)"
                  @click="switchSource(row)"
                >
                  {{ isCurrent(row) ? '当前' : '切换' }}
                </el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>
        <el-tab-pane label="搜索书源">
          <div class="search-bar">
            <el-input
              v-model="searchKey"
              placeholder="搜索书源名称或URL"
              size="small"
            >
              <template #append>
                <el-button type="primary" @click="searchKey && searchMore()" :loading="searching">
                  搜索
                </el-button>
              </template>
            </el-input>
          </div>
          <el-table
            :data="searchResults"
            stripe
            v-loading="searching"
            style="width: 100%; margin-top: 12px"
          >
            <el-table-column prop="bookSourceName" label="名称" min-width="150" />
            <el-table-column prop="bookSourceUrl" label="URL" min-width="200" />
            <el-table-column prop="bookSourceGroup" label="分组" width="120" />
            <el-table-column label="操作" width="100" fixed="right">
              <template #default="{ row }">
                <el-button type="primary" size="small" text @click="switchSource(row)">
                  切换
                </el-button>
              </template>
            </el-table-column>
          </el-table>
          <div v-if="hasMore && searchResults.length > 0" class="load-more">
            <el-button type="primary" plain @click="searchMore" :loading="searching">
              加载更多
            </el-button>
          </div>
        </el-tab-pane>
      </el-tabs>
    </div>
    <template #footer>
      <el-button @click="emit('update:visible', false)">关闭</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.source-tabs .search-bar {
  display: flex;
}
.load-more {
  display: flex;
  justify-content: center;
  margin-top: 16px;
}
</style>
