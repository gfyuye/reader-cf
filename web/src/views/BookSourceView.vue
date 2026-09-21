<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { Plus, Delete, Edit, Search, Download, Folder, View, Tools, Refresh, Check } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox, ElTag, ElTooltip } from 'element-plus'
import {
  getBookSources,
  getBookSource,
  saveBookSource,
  deleteBookSource as apiDeleteBookSource,
  readSourceFile,
  saveFromRemoteSource,
  setAsDefaultBookSources,
  deleteBookSourcesFile,
  getBookSourceString,
} from '@/api/bookSource'
import { useNotify } from '@/utils/helpers'
import { useAuthStore } from '@/stores/auth'
import type { BookSource } from '@/api/types'

const { success, error } = useNotify()
const authStore = useAuthStore()

const sources = ref<BookSource[]>([])
const searchQuery = ref('')
const showEdit = ref(false)
const editingSource = ref<BookSource | null>(null)
const sourceForm = ref<Partial<BookSource>>({})
const loading = ref(false)
const showImport = ref(false)
const showSub = ref(false)
const showFileSub = ref(false)
const remoteSubUrl = ref('')
const fileSubFile = ref<File | null>(null)
const defaultSources = ref<string[]>([])
const sourceMap = ref<Record<string, BookSource>>({})

// 批量检测状态
const checkingBookSource = ref(false)
const checkBookSourceConfig = ref({
  keyword: '',
  timeout: 5000,
  concurrent: 5,
})
const checkBookSourceTip = ref('')
const manageSourceSelection = ref<BookSource[]>([])

const userNameSpace = ref('')
const apiBase = ref('')

onMounted(() => {
  loadSources()
  apiBase.value = '/reader3'
})

function debugBookSource() {
  window.open(
    window.location.origin +
      window.location.pathname.replace(/index.html$/, '') +
      'bookSourceDebug/#domain=' + apiBase.value,
    '_blank'
  )
}

async function checkBookSource() {
  if (checkingBookSource.value) return
  
  const targets = manageSourceSelection.value.length > 0 
    ? manageSourceSelection.value 
    : sources.value
  
  if (targets.length === 0) {
    ElMessage.warning('没有可检测的书源')
    return
  }

  checkingBookSource.value = true
  let successCount = 0
  let failCount = 0
  checkBookSourceTip.value = `正在检测... 0/${targets.length}`

  for (let i = 0; i < targets.length; i++) {
    if (!checkingBookSource.value) break
    
    const source = targets[i]
    checkBookSourceTip.value = `正在检测 (${i + 1}/${targets.length}): ${source.bookSourceName}`
    
    try {
      const res = await getBookSource(source.bookSourceUrl, userNameSpace.value || undefined)
      if (res.isSuccess) {
        successCount++
        // 更新源状态
        const idx = sources.value.findIndex(s => s.bookSourceUrl === source.bookSourceUrl)
        if (idx !== -1) {
          sources.value[idx].enabled = true
          sources.value[idx].lastCheckTime = Date.now()
        }
      } else {
        failCount++
      }
    } catch {
      failCount++
    }
    
    // 并发控制简化版 - 稍微延迟
    if (i % checkBookSourceConfig.value.concurrent === 0 && i > 0) {
      await new Promise(r => setTimeout(r, 100))
    }
  }

  checkingBookSource.value = false
  checkBookSourceTip.value = `完成: 成功 ${successCount}, 失败 ${failCount}`
  ElMessage.success(`检测完成: 成功 ${successCount}, 失败 ${failCount}`)
  loadSources()
}

async function loadSources() {
  loading.value = true
  try {
    const res = await getBookSources(userNameSpace.value || undefined)
    if (res.isSuccess) {
      sources.value = (res.data as BookSource[]) || []
      sourceMap.value = {}
      sources.value.forEach((s) => {
        sourceMap.value[s.bookSourceUrl] = s
      })
    }
  } finally {
    loading.value = false
  }
}

const filteredSources = computed(() => {
  if (!searchQuery.value.trim()) return sources.value
  const kw = searchQuery.value.toLowerCase()
  return sources.value.filter(
    (s) =>
      s.bookSourceName?.toLowerCase().includes(kw) ||
      s.bookSourceUrl?.toLowerCase().includes(kw) ||
      s.bookSourceGroup?.toLowerCase().includes(kw)
  )
})

async function saveSource() {
  if (!sourceForm.value.bookSourceUrl || !sourceForm.value.bookSourceName) {
    error('请填写书源URL和名称')
    return
  }
  const res = await saveBookSource({ ...sourceForm.value }, userNameSpace.value || undefined)
  if (res.isSuccess) {
    success(sourceForm.value.bookSourceUrl ? '保存成功' : '添加成功')
    showEdit.value = false
    sourceForm.value = {}
    editingSource.value = null
    loadSources()
  } else if (res.errorMsg) {
    error(res.errorMsg)
  }
}

async function editSource(source?: BookSource) {
  if (source) {
    editingSource.value = source
    sourceForm.value = { ...source }
  } else {
    editingSource.value = null
    sourceForm.value = {}
  }
  showEdit.value = true
}

async function removeSource(sourceUrl: string) {
  try {
    await ElMessageBox.confirm('确定要删除这个书源吗？', '提示', { type: 'warning' })
    const res = await apiDeleteBookSource(sourceUrl, userNameSpace.value || undefined)
    if (res.isSuccess) {
      success('删除成功')
      loadSources()
    }
  } catch {
    /* cancelled */
  }
}

async function importFromFile() {
  if (!fileSubFile.value) {
    error('请选择文件')
    return
  }
  const res = await readSourceFile(fileSubFile.value)
  if (res.isSuccess) {
    success('导入成功')
    showImport.value = false
    fileSubFile.value = null
    loadSources()
  } else if (res.errorMsg) {
    error(res.errorMsg)
  }
}

async function subscribeRemote() {
  if (!remoteSubUrl.value.trim()) {
    error('请输入订阅链接')
    return
  }
  const res = await saveFromRemoteSource(remoteSubUrl.value, userNameSpace.value || undefined)
  if (res.isSuccess) {
    success('订阅成功')
    showSub.value = false
    remoteSubUrl.value = ''
    loadSources()
  } else if (res.errorMsg) {
    error(res.errorMsg)
  }
}

async function copySource(sourceUrl: string) {
  const sourceStr = await getBookSourceString(sourceUrl)
  if (sourceStr) {
    navigator.clipboard.writeText(sourceStr)
    success('已复制到剪贴板')
  }
}

function getSourceType(source: BookSource): string {
  const types: Record<string, string> = {
    '0': '小说',
    '1': '漫画',
    '2': '音频',
    '3': '视频',
    '4': 'TXT',
  }
  return types[source.bookSourceType || '0'] || '其他'
}

function getSourceStatusType(source: BookSource): 'primary' | 'success' | 'warning' | 'info' | 'danger' {
  if (!source.enabled && source.enabled !== undefined) return 'info'
  return 'success'
}

const sourceTypeList = [
  { label: '小说', value: '0' },
  { label: '漫画', value: '1' },
  { label: '音频', value: '2' },
  { label: '视频', value: '3' },
  { label: 'TXT', value: '4' },
]
</script>

<template>
  <div class="book-source-container">
    <el-row :gutter="20" style="margin-bottom: 16px;">
      <el-col :span="8">
        <el-input
          v-model="searchQuery"
          placeholder="搜索书源名称/URL/分组"
          :prefix-icon="Search"
        />
      </el-col>
      <el-col :span="16" style="text-align: right;">
        <el-button type="primary" :icon="Plus" @click="editSource()">
          添加书源
        </el-button>
        <el-button :icon="Download" @click="showImport = true">
          导入书源
        </el-button>
        <el-button :icon="Folder" @click="showSub = true">
          订阅远程
        </el-button>
        <el-button :icon="Tools" @click="debugBookSource()">
          调试源
        </el-button>
        <el-button :icon="Check" @click="() => checkingBookSource = true">
          批量检测
        </el-button>
      </el-col>
    </el-row>

    <el-table :data="filteredSources" stripe v-loading="loading" style="width: 100%">
      <el-table-column prop="bookSourceName" label="名称" min-width="160">
        <template #default="{ row }">
          <div style="display: flex; align-items: center; gap: 6px;">
            <el-tag :type="getSourceStatusType(row)" size="small">{{ getSourceType(row) }}</el-tag>
            {{ row.bookSourceName }}
          </div>
        </template>
      </el-table-column>
      <el-table-column prop="bookSourceUrl" label="URL" min-width="220" />
      <el-table-column prop="bookSourceGroup" label="分组" width="140" />
      <el-table-column prop="weight" label="权重" width="60" />
      <el-table-column label="操作" width="140" fixed="right">
        <template #default="{ row }">
          <ElTooltip content="编辑" placement="top">
            <el-button :icon="Edit" size="small" text @click="editSource(row)" />
          </ElTooltip>
          <ElTooltip content="复制" placement="top">
            <el-button :icon="View" size="small" text @click="copySource(row.bookSourceUrl)" />
          </ElTooltip>
          <ElTooltip content="删除" placement="top">
            <el-button :icon="Delete" size="small" type="danger" text @click="removeSource(row.bookSourceUrl)" />
          </ElTooltip>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog
      v-model="showEdit"
      :title="editingSource ? '编辑书源' : '添加书源'"
      width="800px"
      :append-to-body="false"
    >
      <el-form :model="sourceForm" label-width="100px">
        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="名称">
              <el-input v-model="sourceForm.bookSourceName" />
            </el-form-item>
            <el-form-item label="URL">
              <el-input v-model="sourceForm.bookSourceUrl" />
            </el-form-item>
            <el-form-item label="分组">
              <el-input v-model="sourceForm.bookSourceGroup" />
            </el-form-item>
            <el-form-item label="类型">
              <el-select v-model="sourceForm.bookSourceType" placeholder="选择类型" style="width: 100%">
                <el-option
                  v-for="item in sourceTypeList"
                  :key="item.value"
                  :label="item.label"
                  :value="item.value"
                />
              </el-select>
            </el-form-item>
            <el-form-item label="权重">
              <el-input-number v-model.number="sourceForm.weight" :min="0" :max="100" />
            </el-form-item>
            <el-form-item label="启用">
              <el-switch v-model="sourceForm.enabled" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="搜索URL">
              <el-input v-model="sourceForm.searchUrl" type="textarea" :rows="2" />
            </el-form-item>
            <el-form-item label="搜索规则">
              <el-input v-model="sourceForm.searchRule" type="textarea" :rows="3" />
            </el-form-item>
            <el-form-item label="发现URL">
              <el-input v-model="sourceForm.exploreUrl" type="textarea" :rows="2" />
            </el-form-item>
            <el-form-item label="发现规则">
              <el-input v-model="sourceForm.exploreRule" type="textarea" :rows="3" />
            </el-form-item>
            <el-form-item label="书籍信息规则">
              <el-input v-model="sourceForm.bookInfoRule" type="textarea" :rows="3" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-form-item label="章节列表规则">
          <el-input v-model="sourceForm.chapterListRule" type="textarea" :rows="3" />
        </el-form-item>
        <el-form-item label="内容规则">
          <el-input v-model="sourceForm.contentRule" type="textarea" :rows="3" />
        </el-form-item>
        <el-form-item label="封面规则">
          <el-input v-model="sourceForm.coverUrlRule" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showEdit = false">取消</el-button>
        <el-button type="primary" @click="saveSource">确定</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="showImport" title="导入书源" width="500px" :append-to-body="false">
      <el-form>
        <el-form-item label="书源文件">
          <el-upload
            :auto-upload="false"
            :limit="1"
            @change="(file: File) => fileSubFile = file"
          >
            <el-button type="primary">选择文件</el-button>
          </el-upload>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showImport = false">取消</el-button>
        <el-button type="primary" @click="importFromFile">导入</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="showSub" title="订阅远程书源" width="500px" :append-to-body="false">
      <el-form :model="{ url: remoteSubUrl }">
        <el-form-item label="订阅链接">
          <el-input v-model="remoteSubUrl" placeholder="请输入订阅链接" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showSub = false">取消</el-button>
        <el-button type="primary" @click="subscribeRemote">确定</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="checkingBookSource" title="批量检测设置" width="400px" :append-to-body="false" :before-close="() => checkingBookSource = false">
      <el-form :model="checkBookSourceConfig" label-width="80px">
        <el-form-item label="搜索关键词">
          <el-input v-model="checkBookSourceConfig.keyword" placeholder="可选：仅检测包含关键词的书源" />
        </el-form-item>
        <el-form-item label="超时(ms)">
          <el-input-number v-model="checkBookSourceConfig.timeout" :min="1000" :max="30000" :step="1000" />
        </el-form-item>
        <el-form-item label="并发数">
          <el-input-number v-model="checkBookSourceConfig.concurrent" :min="1" :max="10" :step="1" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="checkingBookSource = false">取消</el-button>
        <el-button type="primary" @click="checkBookSource">开始检测</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.book-source-container {
  padding: 0;
}
</style>
