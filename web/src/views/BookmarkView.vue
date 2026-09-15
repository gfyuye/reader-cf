<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { Plus, Delete, Edit } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { getBookmarks, saveBookmark, deleteBookmark as apiDelete } from '@/api/other'
import { useNotify } from '@/utils/helpers'

const { success, error } = useNotify()
const bookmarks = ref<any[]>([])
const showAdd = ref(false)
const bookmarkForm = ref<any>({})
const loading = ref(false)

onMounted(() => { loadBookmarks() })

async function loadBookmarks() {
  loading.value = true
  try {
    const res = await getBookmarks()
    if (res.isSuccess) bookmarks.value = res.data || []
  } finally {
    loading.value = false
  }
}

async function addBookmark() {
  if (!bookmarkForm.value.bookName || !bookmarkForm.value.chapterUrl) {
    error('请填写完整')
    return
  }
  const res = await saveBookmark(bookmarkForm.value)
  if (res.isSuccess) {
    success('添加成功')
    showAdd.value = false
    bookmarkForm.value = {}
    loadBookmarks()
  } else {
      if (res.errorMsg) { error(res.errorMsg) }
  }
}

async function removeBookmark(time: number) {
  try {
    await ElMessageBox.confirm('确定删除？', '提示', { type: 'warning' })
    const res = await apiDelete({ time })
    if (res.isSuccess) {
      success('删除成功')
      loadBookmarks()
    }
  } catch { /* cancelled */ }
}
</script>

<template>
  <div>
    <el-row :gutter="20" style="margin-bottom: 16px;">
      <el-col :span="18"><h2>书签</h2></el-col>
      <el-col :span="6" style="text-align: right;">
        <el-button type="primary" :icon="Plus" @click="showAdd = true">添加</el-button>
      </el-col>
    </el-row>
    <el-table :data="bookmarks" stripe v-loading="loading">
      <el-table-column prop="bookName" label="书名" min-width="180" />
      <el-table-column prop="chapterName" label="章节" min-width="150" />
      <el-table-column prop="bookmarkText" label="内容摘要" min-width="200" />
      <el-table-column prop="time" label="时间" width="160">
        <template #default="{ row }">{{ row.time ? new Date(row.time).toLocaleString() : '' }}</template>
      </el-table-column>
      <el-table-column label="操作" width="120" fixed="right">
        <template #default="{ row }">
          <el-button :icon="Delete" size="small" type="danger" text @click="removeBookmark(row.time)" />
        </template>
      </el-table-column>
    </el-table>
    <el-dialog v-model="showAdd" title="添加书签" width="500px">
      <el-form :model="bookmarkForm" label-width="100px">
        <el-form-item label="书名">
          <el-input v-model="bookmarkForm.bookName" />
        </el-form-item>
        <el-form-item label="章节">
          <el-input v-model="bookmarkForm.chapterName" />
        </el-form-item>
        <el-form-item label="内容">
          <el-input v-model="bookmarkForm.bookmarkText" type="textarea" :rows="3" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showAdd = false">取消</el-button>
        <el-button type="primary" @click="addBookmark">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>
