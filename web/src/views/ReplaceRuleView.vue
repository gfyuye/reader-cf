<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { Plus, Delete, Edit } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { getReplaceRules, saveReplaceRule, deleteReplaceRule as apiDelete } from '@/api/other'
import { useNotify } from '@/utils/helpers'

const { success, error } = useNotify()
const rules = ref<any[]>([])
const showAdd = ref(false)
const ruleForm = ref<any>({})
const loading = ref(false)

onMounted(() => { loadRules() })

async function loadRules() {
  loading.value = true
  try {
    const res = await getReplaceRules()
    if (res.isSuccess) rules.value = res.data || []
  } finally {
    loading.value = false
  }
}

async function addRule() {
  if (!ruleForm.value.name || !ruleForm.value.pattern) {
    error('名称和规则不能为空')
    return
  }
  const res = await saveReplaceRule(ruleForm.value)
  if (res.isSuccess) {
    success('保存成功')
    showAdd.value = false
    ruleForm.value = {}
    loadRules()
  } else {
    if (res.errorMsg) { error(res.errorMsg) }
  }
}

async function removeRule(name: string) {
  try {
    await ElMessageBox.confirm('确定删除？', '提示', { type: 'warning' })
    const res = await apiDelete(name)
    if (res.isSuccess) {
      success('删除成功')
      loadRules()
    } else {
      if (res.errorMsg) { error(res.errorMsg) }
    }
  } catch { /* cancelled */ }
}
</script>

<template>
  <div>
    <el-row :gutter="20" style="margin-bottom: 16px;">
      <el-col :span="18">
        <h2>替换规则</h2>
      </el-col>
      <el-col :span="6" style="text-align: right;">
        <el-button type="primary" :icon="Plus" @click="showAdd = true">添加</el-button>
      </el-col>
    </el-row>
    <el-table :data="rules" stripe v-loading="loading">
      <el-table-column prop="name" label="名称" min-width="150" />
      <el-table-column prop="pattern" label="匹配" min-width="200" />
      <el-table-column prop="replacement" label="替换" min-width="200" />
      <el-table-column label="操作" width="150" fixed="right">
        <template #default="{ row }">
          <el-button :icon="Edit" size="small" text />
          <el-button :icon="Delete" size="small" type="danger" text @click="removeRule(row.name)" />
        </template>
      </el-table-column>
    </el-table>
    <el-dialog v-model="showAdd" title="添加替换规则" width="500px">
      <el-form :model="ruleForm" label-width="100px">
        <el-form-item label="名称">
          <el-input v-model="ruleForm.name" />
        </el-form-item>
        <el-form-item label="匹配规则">
          <el-input v-model="ruleForm.pattern" type="textarea" :rows="3" />
        </el-form-item>
        <el-form-item label="替换内容">
          <el-input v-model="ruleForm.replacement" type="textarea" :rows="3" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showAdd = false">取消</el-button>
        <el-button type="primary" @click="addRule">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>
