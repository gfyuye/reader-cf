<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { Plus, Delete, Upload, Download } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  fileList as apiList,
  fileMkdir as apiMkdir,
  fileDelete as apiDelete,
  fileUpload as apiUpload,
  fileDownload as apiDownload,
  fileParse as apiParse,
} from '@/api/file'
import { useNotify } from '@/utils/helpers'

const { success, error } = useNotify()
const fileList = ref<any[]>([])
const currentPath = ref('/')
const showMkdir = ref(false)
const newDirName = ref('')
const loading = ref(false)

async function loadFiles(path = '/') {
  currentPath.value = path
  loading.value = true
  try {
    const res = await apiList(path)
    if (res.isSuccess) {
      fileList.value = res.data || []
    }
  } finally {
    loading.value = false
  }
}

async function createDir() {
  if (!newDirName.value.trim()) return
  const res = await apiMkdir(`${currentPath.value}${newDirName.value}/`)
  if (res.isSuccess) {
    success('创建成功')
    showMkdir.value = false
    newDirName.value = ''
    loadFiles(currentPath.value)
  } else {
      if (res.errorMsg) { error(res.errorMsg) }
  }
}

async function removeFile(path: string) {
  try {
    await ElMessageBox.confirm(`确定删除 ${path}?`, '提示', { type: 'warning' })
    const res = await apiDelete(path)
    if (res.isSuccess) {
      success('删除成功')
      loadFiles(currentPath.value)
    }
  } catch { /* cancelled */ }
}

function navigateUp() {
  const parts = currentPath.value.split('/').filter(Boolean)
  if (parts.length > 1) {
    loadFiles('/' + parts.slice(0, -1).join('/') + '/')
  } else {
    loadFiles('/')
  }
}

function navigateDir(name: string) {
  loadFiles(`${currentPath.value}${name}/`)
}

onMounted(() => { loadFiles('/') })
</script>

<template>
  <div>
    <el-row :gutter="20" style="margin-bottom: 16px;">
      <el-col :span="18">
        <el-breadcrumb separator="/">
          <el-breadcrumb-item>
            <el-icon @click="navigateUp" style="cursor: pointer;"><ArrowUp /></el-icon>
          </el-breadcrumb-item>
          <el-breadcrumb-item v-for="(part, idx) in currentPath.split('/').filter(Boolean)" :key="idx">
            {{ part }}
          </el-breadcrumb-item>
        </el-breadcrumb>
      </el-col>
      <el-col :span="6" style="text-align: right;">
        <el-button :icon="Plus" type="primary" @click="showMkdir = true" style="margin-right: 8px;">新建</el-button>
        <el-button :icon="Upload" type="primary">上传</el-button>
      </el-col>
    </el-row>
    <el-table :data="fileList" stripe v-loading="loading">
      <el-table-column prop="name" label="名称" min-width="200">
        <template #default="{ row }">
          <el-icon v-if="row.type === 'dir'" :size="16" style="margin-right: 6px;"><Folder /></el-icon>
          <el-icon v-else :size="16" style="margin-right: 6px;"><Document /></el-icon>
          <span style="cursor: pointer;" @click="row.type === 'dir' && navigateDir(row.name)">{{ row.name }}</span>
        </template>
      </el-table-column>
      <el-table-column prop="size" label="大小" width="120" />
      <el-table-column prop="modified" label="修改时间" width="180" />
      <el-table-column label="操作" width="150" fixed="right">
        <template #default="{ row }">
          <el-button text size="small" @click="row.type === 'dir' ? navigateDir(row.name) : null">打开</el-button>
          <el-button :icon="Download" text size="small" v-if="row.type !== 'dir'">下载</el-button>
          <el-button :icon="Delete" text size="small" type="danger" @click="removeFile(row.path)" />
        </template>
      </el-table-column>
    </el-table>
    <el-dialog v-model="showMkdir" title="新建文件夹" width="400px">
      <el-form-item label="文件夹名称">
        <el-input v-model="newDirName" />
      </el-form-item>
      <template #footer>
        <el-button @click="showMkdir = false">取消</el-button>
        <el-button type="primary" @click="createDir">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script lang="ts">
import { ArrowUp, Folder, Document } from '@element-plus/icons-vue'
export default { components: { ArrowUp, Folder, Document } }
</script>
