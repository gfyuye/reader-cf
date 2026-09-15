<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { Plus, Delete, Edit, Search } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { getBookSources, saveBookSource, deleteBookSource as apiDeleteBookSource } from '@/api/bookSource'
import { useNotify } from '@/utils/helpers'

const { success, error } = useNotify()
const sources = ref<any[]>([])
const searchQuery = ref('')
const showAdd = ref(false)
const editingSource = ref<any>(null)
const sourceForm = ref<any>({})
const loading = ref(false)

async function loadSources() {
  loading.value = true
  try {
    const res = await getBookSources()
    if (res.isSuccess) {
      sources.value = res.data || []
    }
  } finally {
    loading.value = false
  }
}

async function addSource() {
  const res = await saveBookSource(sourceForm.value)
  if (res.isSuccess) {
    success('添加成功')
    showAdd.value = false
    sourceForm.value = {}
    loadSources()
  } else {
    if (res.errorMsg) { error(res.errorMsg) }
  }
}

async function removeSource(sourceUrl: string) {
  try {
    await ElMessageBox.confirm('确定要删除这个书源吗？', '提示', { type: 'warning' })
    const res = await apiDeleteBookSource(sourceUrl)
    if (res.isSuccess) {
      success('删除成功')
      loadSources()
    } else {
      if (res.errorMsg) { error(res.errorMsg) }
    }
  } catch {
    /* cancelled */
  }
}

onMounted(() => {
  loadSources()
})
</script>

<template>
  <div class="book-source-container">
    <el-row :gutter="20">
      <el-col :span="8">
        <el-input v-model="searchQuery" placeholder="搜索书源" :prefix-icon="Search" />
      </el-col>
      <el-col :span="16" style="text-align: right;">
        <el-button type="primary" :icon="Plus" @click="showAdd = true">添加书源</el-button>
      </el-col>
    </el-row>
    <el-table :data="sources" stripe style="margin-top: 16px;" v-loading="loading">
      <el-table-column prop="bookSourceName" label="名称" min-width="180" />
      <el-table-column prop="bookSourceUrl" label="URL" min-width="250" />
      <el-table-column prop="bookSourceGroup" label="分组" width="120" />
      <el-table-column label="操作" width="150" fixed="right">
        <template #default="{ row }">
          <el-button :icon="Edit" size="small" text @click="editingSource = row" />
          <el-button :icon="Delete" size="small" type="danger" text @click="removeSource(row.bookSourceUrl)" />
        </template>
      </el-table-column>
    </el-table>
  </div>

  <el-dialog v-model="showAdd" :title="editingSource ? '编辑书源' : '添加书源'" width="600px">
    <el-form :model="sourceForm" label-width="100px">
      <el-form-item label="名称">
        <el-input v-model="sourceForm.bookSourceName" />
      </el-form-item>
      <el-form-item label="URL">
        <el-input v-model="sourceForm.bookSourceUrl" />
      </el-form-item>
      <el-form-item label="分组">
        <el-input v-model="sourceForm.bookSourceGroup" />
      </el-form-item>
      <el-form-item label="搜索URL">
        <el-input v-model="sourceForm.searchUrl" />
      </el-form-item>
      <el-form-item label="搜索规则">
        <el-input v-model="sourceForm.searchRule" type="textarea" :rows="3" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="showAdd = false">取消</el-button>
      <el-button type="primary" @click="addSource">确定</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.book-source-container {
  padding: 0;
}
</style>
