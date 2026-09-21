<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { Plus, Delete, Upload, Download, Folder, Document, ArrowUp, Refresh, View, Close } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox, ElTag, ElTooltip } from 'element-plus'
import {
  fileList as apiList,
  fileGet,
  fileSave,
  fileMkdir,
  fileUpload as apiUpload,
  fileDownload as apiDownload,
  fileDelete as apiDelete,
  fileDeleteMulti,
  fileRestore,
  fileParse as apiParse,
  fileImportPreview,
} from '@/api/file'
import { useNotify, formatSize } from '@/utils/helpers'
import type { FileInfo } from '@/api/types'

const { success, error } = useNotify()

const files = ref<FileInfo[]>([])
const currentPath = ref('/')
const showMkdir = ref(false)
const newDirName = ref('')
const loading = ref(false)
const showUpload = ref(false)
const uploadFiles = ref<File[]>([])
const showPreview = ref(false)
const previewContent = ref('')
const previewFile = ref<FileInfo | null>(null)
const selected = ref<Set<string>>(new Set())
const importFile = ref<File | null>(null)
const showImport = ref(false)
const importPreviewResult: any = ref(null)

onMounted(() => {
  loadFiles('/')
})

async function loadFiles(path = '/') {
  currentPath.value = path
  loading.value = true
  try {
    const res = await apiList(path)
    if (res.isSuccess) {
      files.value = (res.data as FileInfo[]) || []
    }
  } finally {
    loading.value = false
  }
}

async function createDir() {
  if (!newDirName.value.trim()) {
    error('请输入文件夹名称')
    return
  }
  const res = await fileMkdir(`${currentPath.value}${newDirName.value}/`)
  if (res.isSuccess) {
    success('创建成功')
    showMkdir.value = false
    newDirName.value = ''
    loadFiles(currentPath.value)
  } else if (res.errorMsg) {
    error(res.errorMsg)
  }
}

async function removeFile(file: FileInfo) {
  try {
    await ElMessageBox.confirm(`确定删除 ${file.path}?`, '提示', { type: 'warning' })
    const res = await apiDelete(file.path)
    if (res.isSuccess) {
      success('删除成功')
      loadFiles(currentPath.value)
    }
  } catch { /* cancelled */ }
}

async function downloadFile(file: FileInfo) {
  const res = await apiDownload(file.path)
  if (res.isSuccess) {
    const blob = new Blob([res.data])
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = encodeURIComponent(file.name)
    a.click()
    URL.revokeObjectURL(url)
  }
}

async function previewFileFn(file: FileInfo) {
  const res = await fileGet(file.path)
  if (res.isSuccess) {
    previewContent.value = typeof res.data === 'string' ? res.data : JSON.stringify(res.data)
    previewFile.value = file
    showPreview.value = true
  }
}

async function doUpload() {
  if (!uploadFiles.value.length) {
    error('请选择文件')
    return
  }
  for (const file of uploadFiles.value) {
    const res = await apiUpload([file], currentPath.value)
    if (res.isSuccess) {
      success(`上传 ${file.name} 成功`)
    } else if (res.errorMsg) {
      error(`上传 ${file.name} 失败: ${res.errorMsg}`)
    }
  }
  showUpload.value = false
  uploadFiles.value = []
  loadFiles(currentPath.value)
}

function navigateUp() {
  const parts = currentPath.value.split('/').filter(Boolean)
  if (parts.length > 0) {
    loadFiles('/' + parts.slice(0, -1).join('/') + '/')
  } else {
    loadFiles('/')
  }
}

function navigateDir(name: string) {
  loadFiles(`${currentPath.value}${name}/`)
}

async function importPreviewBook() {
  if (!importFile.value) {
    error('请选择文件')
    return
  }
  const formData = new FormData()
  formData.append('file', importFile.value)
  const res = await fileImportPreview(importFile.value.name)
  if (res.isSuccess) {
    importPreviewResult.value = res.data
    success('预览生成')
  }
}

function handleUploadChange(files: File[]) {
  uploadFiles.value = files
}

function getFileType(name: string): 'dir' | 'file' {
  return name.endsWith('/') ? 'dir' : 'file'
}
</script>

<template>
  <div class="file-manager-container">
    <el-row :gutter="20" style="margin-bottom: 16px;">
      <el-col :span="12">
        <div class="path-bar">
          <el-button type="text" :icon="ArrowUp" @click="navigateUp" />
          <span>{{ currentPath }}</span>
        </div>
      </el-col>
      <el-col :span="12" style="text-align: right;">
        <el-button type="primary" :icon="Folder" @click="showMkdir = true">
          新建文件夹
        </el-button>
        <el-button :icon="Upload" @click="showUpload = true">
          上传
        </el-button>
        <el-button :icon="Refresh" @click="loadFiles(currentPath)">
          刷新
        </el-button>
      </el-col>
    </el-row>

    <el-table
      :data="files"
      stripe
      v-loading="loading"
      style="width: 100%"
    >
      <el-table-column type="selection" />
      <el-table-column prop="name" label="名称" min-width="200">
        <template #default="{ row }">
          <el-icon v-if="row.type === 'dir' || row.name?.endsWith('/')" :size="16" style="margin-right: 6px;">
            <Folder />
          </el-icon>
          <el-icon v-else :size="16" style="margin-right: 6px;">
            <Document />
          </el-icon>
          <span
            style="cursor: pointer;"
            @click="row.type === 'dir' || row.name?.endsWith('/') ? navigateDir(row.name) : null"
          >
            {{ row.name }}
          </span>
        </template>
      </el-table-column>
      <el-table-column prop="size" label="大小" width="120">
        <template #default="{ row }">
          {{ row.size ? formatSize(row.size) : '-' }}
        </template>
      </el-table-column>
      <el-table-column prop="modified" label="修改时间" width="180">
        <template #default="{ row }">
          {{ row.modified ? new Date(row.modified).toLocaleString() : '-' }}
        </template>
      </el-table-column>
      <el-table-column label="操作" width="160" fixed="right">
        <template #default="{ row }">
          <ElTooltip content="查看" placement="top">
            <el-button :icon="View" text size="small" @click="previewFileFn(row)" v-if="row.type !== 'dir' && !row.name?.endsWith('/')" />
          </ElTooltip>
          <ElTooltip content="下载" placement="top">
            <el-button :icon="Download" text size="small" @click="downloadFile(row)" v-if="row.type !== 'dir' && !row.name?.endsWith('/')" />
          </ElTooltip>
          <ElTooltip content="删除" placement="top">
            <el-button :icon="Delete" text size="small" type="danger" @click="removeFile(row)" />
          </ElTooltip>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="showMkdir" title="新建文件夹" width="400px" :append-to-body="false">
      <el-form-item label="文件夹名称">
        <el-input v-model="newDirName" />
      </el-form-item>
      <template #footer>
        <el-button @click="showMkdir = false">取消</el-button>
        <el-button type="primary" @click="createDir">确定</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="showUpload" title="上传文件" width="500px" :append-to-body="false">
      <el-upload
        :auto-upload="false"
        :multiple="true"
        @change="handleUploadChange"
      >
        <el-button type="primary">选择文件</el-button>
      </el-upload>
      <div v-if="uploadFiles.length" class="upload-list">
        <el-tag v-for="f in uploadFiles" :key="f.name" closable style="margin: 2px;">
          {{ f.name }}
          <el-icon><Close /></el-icon>
        </el-tag>
      </div>
      <template #footer>
        <el-button @click="showUpload = false">取消</el-button>
        <el-button type="primary" @click="doUpload">确定</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="showPreview" title="文件预览" width="800px" :append-to-body="false">
      <pre style="max-height: 500px; overflow: auto; padding: 12px; font-size: 13px;">{{ previewContent }}</pre>
      <template #footer>
        <el-button @click="showPreview = false">关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.file-manager-container {
  padding: 0;
}
.path-bar {
  display: flex;
  align-items: center;
  gap: 8px;
}
.upload-list {
  margin-top: 12px;
}
</style>
