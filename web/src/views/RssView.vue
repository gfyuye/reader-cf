<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { Plus, Delete } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { getRssSources as apiGetSources, saveRssSource as apiSave, deleteRssSource as apiDelete } from '@/api/rss'
import { getRssArticles as apiGetArticles } from '@/api/rss'
import { getBookSources as apiGetBookSources } from '@/api/bookSource'
import { useNotify } from '@/utils/helpers'

const { success, error } = useNotify()
const sources = ref<any[]>([])
const articles = ref<any[]>([])
const showAdd = ref(false)
const sourceForm = ref<any>({})
const activeTab = ref('sources')
const loading = ref(false)

onMounted(() => { loadSources() })

async function loadSources() {
  loading.value = true
  try {
    const res = await apiGetSources()
    if (res.isSuccess) sources.value = res.data || []
  } finally {
    loading.value = false
  }
}

async function loadArticles(sourceName: string) {
  loading.value = true
  try {
    const res = await apiGetArticles(sourceName)
    if (res.isSuccess) articles.value = res.data || []
  } finally {
    loading.value = false
  }
}

async function addSource() {
  const res = await apiSave(sourceForm.value)
  if (res.isSuccess) {
    success('添加成功')
    showAdd.value = false
    sourceForm.value = {}
    loadSources()
  } else {
      if (res.errorMsg) { error(res.errorMsg) }
  }
}

async function removeSource(name: string) {
  try {
    await ElMessageBox.confirm('确定删除？', '提示', { type: 'warning' })
    const res = await apiDelete(name)
    if (res.isSuccess) {
      success('删除成功')
      loadSources()
    }
  } catch { /* cancelled */ }
}

async function refreshSource(sourceName: string) {
  const bookSources = await apiGetBookSources()
  if (bookSources.isSuccess) {
    // Update cache logic here
    success('刷新完成')
  }
}
</script>

<template>
  <div>
    <el-tabs v-model="activeTab" type="border-card">
      <el-tab-pane label="RSS源" name="sources">
        <el-row :gutter="20" style="margin-bottom: 16px;">
          <el-col :span="18"><h3>RSS源管理</h3></el-col>
          <el-col :span="6" style="text-align: right;">
            <el-button type="primary" :icon="Plus" @click="showAdd = true">添加</el-button>
          </el-col>
        </el-row>
        <el-table :data="sources" stripe v-loading="loading">
          <el-table-column prop="rssSrcName" label="名称" min-width="150" />
          <el-table-column prop="rssSrcUrl" label="URL" min-width="250" />
          <el-table-column prop="rssSrcGroup" label="分组" width="120" />
          <el-table-column label="操作" width="150" fixed="right">
            <template #default="{ row }">
              <el-button text size="small" @click="refreshSource(row.rssSrcName)">刷新</el-button>
              <el-button :icon="Delete" type="danger" text size="small" @click="removeSource(row.rssSrcName)" />
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>
      <el-tab-pane label="文章" name="articles">
        <el-empty v-if="articles.length === 0" description="选择源后查看文章" />
        <el-table v-else :data="articles" stripe>
          <el-table-column prop="articleTitle" label="标题" min-width="300" />
          <el-table-column prop="author" label="作者" width="120" />
          <el-table-column prop="pubDate" label="发布日期" width="160" />
        </el-table>
      </el-tab-pane>
    </el-tabs>
    <el-dialog v-model="showAdd" title="添加RSS源" width="500px">
      <el-form :model="sourceForm" label-width="100px">
        <el-form-item label="名称">
          <el-input v-model="sourceForm.rssSrcName" />
        </el-form-item>
        <el-form-item label="URL">
          <el-input v-model="sourceForm.rssSrcUrl" />
        </el-form-item>
        <el-form-item label="分组">
          <el-input v-model="sourceForm.rssSrcGroup" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showAdd = false">取消</el-button>
        <el-button type="primary" @click="addSource">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>
