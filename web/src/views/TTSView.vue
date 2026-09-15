<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { Plus, Delete } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { getHttpTTSList, saveHttpTTS, deleteHttpTTS as apiDelete } from '@/api/other'
import { useNotify } from '@/utils/helpers'

const { success, error } = useNotify()
const ttsList = ref<any[]>([])
const showAdd = ref(false)
const ttsForm = ref<any>({})
const loading = ref(false)

onMounted(() => { loadList() })

async function loadList() {
  loading.value = true
  try {
    const res = await getHttpTTSList()
    if (res.isSuccess) ttsList.value = res.data || []
  } finally {
    loading.value = false
  }
}

async function addTTS() {
  if (!ttsForm.value.name || !ttsForm.value.url) {
    error('名称和链接不能为空')
    return
  }
  const res = await saveHttpTTS(ttsForm.value)
  if (res.isSuccess) {
    success('保存成功')
    showAdd.value = false
    ttsForm.value = {}
    loadList()
  } else {
      if (res.errorMsg) { error(res.errorMsg) }
  }
}

async function removeTTS(id: string) {
  try {
    await ElMessageBox.confirm('确定删除？', '提示', { type: 'warning' })
    const res = await apiDelete(id)
    if (res.isSuccess) {
      success('删除成功')
      loadList()
    }
  } catch { /* cancelled */ }
}
</script>

<template>
  <div>
    <el-row :gutter="20" style="margin-bottom: 16px;">
      <el-col :span="18"><h2>HttpTTS</h2></el-col>
      <el-col :span="6" style="text-align: right;">
        <el-button type="primary" :icon="Plus" @click="showAdd = true">添加</el-button>
      </el-col>
    </el-row>
    <el-table :data="ttsList" stripe v-loading="loading">
      <el-table-column prop="id" label="ID" width="80" />
      <el-table-column prop="name" label="名称" min-width="150" />
      <el-table-column prop="url" label="URL" min-width="300" />
      <el-table-column label="操作" width="120" fixed="right">
        <template #default="{ row }">
          <el-button :icon="Delete" type="danger" text size="small" @click="removeTTS(row.id)" />
        </template>
      </el-table-column>
    </el-table>
    <el-dialog v-model="showAdd" title="添加TTS" width="500px">
      <el-form :model="ttsForm" label-width="100px">
        <el-form-item label="名称">
          <el-input v-model="ttsForm.name" />
        </el-form-item>
        <el-form-item label="URL">
          <el-input v-model="ttsForm.url" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showAdd = false">取消</el-button>
        <el-button type="primary" @click="addTTS">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>
