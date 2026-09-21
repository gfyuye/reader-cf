<script setup lang="ts">
import { ref, onMounted, computed, shallowRef } from 'vue'
import { useRouter } from 'vue-router'
import { getBookshelf as apiGetBookshelf, saveBook as apiSaveBook, deleteBook as apiDeleteBook, deleteBooks as apiDeleteBooks, saveBookGroupId, addBookGroupMulti, removeBookGroupMulti, getShelfBookWithCacheInfo } from '@/api/book'
import { getBookGroups } from '@/api/other'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Delete, Folder, Sort, Search, Check } from '@element-plus/icons-vue'
import { useNotify } from '@/utils/helpers'
import { useSettingsStore } from '@/stores/settings'
import { useAuthStore } from '@/stores/auth'
import type { Book, BookGroup } from '@/api/types'
import { RecycleScroller } from 'vue-virtual-scroller'
import 'vue-virtual-scroller/dist/vue-virtual-scroller.css'

const { success, error } = useNotify()
const settingsStore = useSettingsStore()
const authStore = useAuthStore()
const router = useRouter()

const books = ref<Book[]>([])
const groups = ref<BookGroup[]>([])
const loading = ref(false)
const searchQuery = ref('')
const selectedGroup = ref(-1)
const selectedBooks = ref<Set<string>>(new Set())
const moveToGroupDialog = ref(false)
const targetGroupId = ref<number>(-1)
const showGroupSelect = ref(false)
const showAddGroup = ref(false)
const newGroupName = ref('')
const showCacheManager = ref(false)
const cacheInfo = ref<any>(null)

const userNameSpace = computed(() => authStore.currentUserNS)
const shelfConfig = computed(() => settingsStore.shelfConfig)

const builtInGroups = [
  { groupId: -1, groupName: '全部', order: -10, show: true },
  { groupId: -2, groupName: '本地', order: -9, show: true },
  { groupId: -3, groupName: '音频', order: -8, show: true },
  { groupId: -4, groupName: '未分组', order: -7, show: true },
  { groupId: -5, groupName: '更新错误', order: -6, show: true },
]

onMounted(() => {
  settingsStore.syncFromLocalStorage()
  loadBooks()
  loadGroups()
})

async function loadBooks() {
  loading.value = true
  try {
    const res = await apiGetBookshelf(userNameSpace.value)
    if (res.isSuccess) {
      books.value = (res.data as Book[]) || []
    }
  } finally {
    loading.value = false
  }
}

async function loadGroups() {
  try {
    const res = await getBookGroups()
    if (res.isSuccess) {
      const serverGroups = (res.data as BookGroup[]) || []
      groups.value = [
        ...builtInGroups,
        ...serverGroups.filter((g) => !builtInGroups.some((b) => b.groupId === g.groupId)),
      ].sort((a, b) => a.order - b.order)
    }
  } catch {
    groups.value = builtInGroups
  }
}

const filteredBooks = computed(() => {
  let result = [...books.value]
  if (selectedGroup.value !== -1) {
    const group = groups.value.find((g) => g.groupId === selectedGroup.value)
    if (group && group.groupName !== '全部') {
      const groupName = group.groupName
      if (groupName === '本地') {
        result = result.filter((b) => b.isLocal)
      } else if (groupName === '音频') {
        result = result.filter((b) => b.kind === 'audio')
      } else if (groupName === '更新错误') {
        result = result.filter((b) => b.lastCheckError)
      } else if (groupName === '未分组') {
        result = result.filter((b) => !b.group || b.group === '')
      } else {
        result = result.filter((b) => b.group === groupName || b.groupId === group.groupId)
      }
    }
  }
  if (searchQuery.value) {
    const kw = searchQuery.value.toLowerCase()
    result = result.filter((b) => b.name?.toLowerCase().includes(kw) || b.author?.toLowerCase().includes(kw))
  }
  return result
})

function getGroupName(groupId: number): string {
  return groups.value.find((g) => g.groupId === groupId)?.groupName || ''
}

const sortedBooks = computed(() => {
  const order = shelfConfig.value.bookOrder || 'durChapterTime'
  const sorted = [...filteredBooks.value].sort((a, b) => {
    const ta = a[order as keyof Book] || 0
    const tb = b[order as keyof Book] || 0
    if (order === 'durChapterTime') {
      return (tb as number) - (ta as number)
    }
    return 0
  })
  return sorted
})

async function deleteBook(bookUrl: string) {
  try {
    await ElMessageBox.confirm('确定要从书架移除这本书吗？', '提示', { type: 'warning' })
    const res = await apiDeleteBook(bookUrl, userNameSpace.value)
    if (res.isSuccess) {
      success('已移除')
      loadBooks()
    }
  } catch { /* cancelled */ }
}

function openBook(book: Book) {
  router.push(`/reader/${book.bookUrl}`)
}

async function moveToGroup(groupId: number) {
  if (selectedBooks.value.size === 0) {
    ElMessage.warning('请选择书籍')
    return
  }
  const bookUrls = Array.from(selectedBooks.value)
  try {
    const res = await addBookGroupMulti(bookUrls, groupId, userNameSpace.value)
    if (res.isSuccess) {
      success('移动成功')
      selectedBooks.value.clear()
      moveToGroupDialog.value = false
      loadBooks()
    }
  } catch (e) {
    error('移动失败')
  }
}

async function batchDelete() {
  if (selectedBooks.value.size === 0) return
  try {
    await ElMessageBox.confirm(`确定删除选中的 ${selectedBooks.value.size} 本书吗？`, '提示', { type: 'warning' })
    const bookUrls = Array.from(selectedBooks.value)
    const res = await apiDeleteBooks(bookUrls, userNameSpace.value)
    if (res.isSuccess) {
      success('已删除')
      selectedBooks.value.clear()
      loadBooks()
    }
  } catch { /* cancelled */ }
}

function toggleSelect(bookUrl: string) {
  if (selectedBooks.value.has(bookUrl)) {
    selectedBooks.value.delete(bookUrl)
  } else {
    selectedBooks.value.add(bookUrl)
  }
}

function selectAll() {
  if (selectedBooks.value.size === filteredBooks.value.length) {
    selectedBooks.value.clear()
  } else {
    filteredBooks.value.forEach((b) => selectedBooks.value.add(b.bookUrl))
  }
}

async function showCacheInfo(book: Book) {
  try {
    const res = await getShelfBookWithCacheInfo(userNameSpace.value)
    if (res.isSuccess) {
      cacheInfo.value = res.data
      showCacheManager.value = true
    }
  } catch {
    error('获取缓存信息失败')
  }
}
</script>

<template>
  <div class="bookshelf-container">
    <el-row :gutter="20" style="margin-bottom: 16px;">
      <el-col :span="8">
        <el-input v-model="searchQuery" placeholder="搜索书架..." :prefix-icon="Search" />
      </el-col>
      <el-col :span="16" style="text-align: right;">
        <el-button type="primary" :icon="Plus" @click="router.push('/search')">
          添加书籍
        </el-button>
        <el-button :icon="Delete" type="danger" :disabled="selectedBooks.size === 0" @click="batchDelete">
          批量删除
        </el-button>
      </el-col>
    </el-row>

    <el-row :gutter="20" style="margin-bottom: 16px;">
      <el-col :span="20">
        <el-menu :mode="'horizontal'" :default-active="String(selectedGroup)" @select="(key: string) => selectedGroup = parseInt(key)">
          <el-menu-item v-for="group in groups" :key="group.groupId" :index="String(group.groupId)">
            {{ group.groupName }}
            <el-tag v-if="group.groupName !== '全部'" size="small" type="info" style="margin-left: 4px;">
              {{ books.filter(b => b.groupId === group.groupId || (group.groupName === '本地' && b.isLocal)).length }}
            </el-tag>
          </el-menu-item>
        </el-menu>
      </el-col>
      <el-col :span="4" style="text-align: right;">
        <el-dropdown v-if="selectedBooks.size > 0" @command="(cmd: string) => cmd === 'move' ? moveToGroupDialog = true : batchDelete()" placement="top-end">
          <el-button>批量操作</el-button>
          <template #dropdown>
            <el-menu>
              <el-menu-item command="move">移动到分组</el-menu-item>
              <el-menu-item command="delete">批量删除</el-menu-item>
            </el-menu>
          </template>
        </el-dropdown>
      </el-col>
    </el-row>

    <el-row :gutter="16">
      <RecycleScroller
        class="virtual-list"
        :items="sortedBooks"
        :item-size="320"
        key-field="bookUrl"
        v-slot="{ item: book }"
      >
        <el-col :xs="12" :sm="8" :md="6" :lg="4">
          <el-card
            shadow="hover"
            class="book-card"
            @click="openBook(book)"
          >
            <template #header>
              <el-checkbox
                :value="selectedBooks.has(book.bookUrl)"
                @change.stop="toggleSelect(book.bookUrl)"
              />
            </template>
            <el-image :src="book.coverUrl" fit="cover" class="book-cover">
              <template #error>
                <div class="cover-placeholder">无封面</div>
              </template>
            </el-image>
            <div class="book-info">
              <div class="book-name" :title="book.name">{{ book.name }}</div>
              <div class="book-author">{{ book.author }}</div>
              <div v-if="book.latestChapterTitle" class="book-chapter" :title="book.latestChapterTitle">
                {{ book.latestChapterTitle }}
              </div>
              <el-tag
                v-if="book.canUpdate"
                type="danger"
                size="small"
                class="update-tag"
              >
                更新
              </el-tag>
            </div>
            <template #footer>
              <el-button type="text" size="small" :icon="Delete" @click.stop="deleteBook(book.bookUrl)" />
            </template>
          </el-card>
        </el-col>
      </RecycleScroller>
    </el-row>

    <el-empty v-if="!loading && books.length === 0" description="书架为空，点击右上角添加书籍" />

    <el-dialog v-model="moveToGroupDialog" title="移动到分组" width="400px" :append-to-body="false">
      <el-select v-model="targetGroupId" placeholder="选择目标分组" style="width: 100%">
        <el-option
          v-for="group in groups"
          :key="group.groupId"
          :label="group.groupName"
          :value="group.groupId"
        />
      </el-select>
      <template #footer>
        <el-button @click="moveToGroupDialog = false">取消</el-button>
        <el-button type="primary" @click="moveToGroup(targetGroupId)">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.bookshelf-container {
  padding: 0;
}

.book-card {
  cursor: pointer;
  transition: transform 0.2s;
  height: 100%;
}

.book-card:hover {
  transform: translateY(-4px);
}

:deep(.el-card__header) {
  padding: 4px 10px;
  border-bottom: 1px solid var(--border-light);
  display: flex;
  justify-content: flex-end;
}

.book-cover {
  width: 100%;
  height: 180px;
  border-radius: 4px;
  overflow: hidden;
}

.cover-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 180px;
  color: #c0c4cc;
  background: #f5f7fa;
  font-size: 12px;
}

.book-info {
  padding: 8px 0 0 0;
}

.book-name {
  font-size: 14px;
  font-weight: bold;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.book-author {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-top: 2px;
}

.book-chapter {
  font-size: 11px;
  color: var(--el-text-color-secondary);
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.update-tag {
  margin-top: 4px;
  float: right;
}

.virtual-list {
  height: calc(100vh - 220px);
  min-height: 500px;
}

:deep(.vue-recycle-scroller) {
  height: 100%;
}
</style>
