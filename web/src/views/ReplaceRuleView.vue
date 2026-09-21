<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { Plus, Delete, Edit, Warning } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox, ElTag, ElSwitch } from 'element-plus'
import {
  getReplaceRules,
  saveReplaceRule,
  saveReplaceRules,
  deleteReplaceRule as apiDeleteReplaceRule,
  deleteReplaceRules as apiDeleteReplaceRules,
} from '@/api/other'
import { useNotify } from '@/utils/helpers'
import type { ReplaceRule } from '@/api/types'

const { success, error } = useNotify()

const rules = ref<ReplaceRule[]>([])
const searchQuery = ref('')
const showEdit = ref(false)
const editingRule = ref<ReplaceRule | null>(null)
const ruleForm = ref<Partial<ReplaceRule>>({})
const loading = ref(false)
const selected = ref<Set<string>>(new Set())

onMounted(() => {
  loadRules()
})

async function loadRules() {
  loading.value = true
  try {
    const res = await getReplaceRules()
    if (res.isSuccess) {
      rules.value = (res.data as ReplaceRule[]) || []
    }
  } finally {
    loading.value = false
  }
}

const filteredRules = computed(() => {
  if (!searchQuery.value.trim()) return rules.value
  const kw = searchQuery.value.toLowerCase()
  return rules.value.filter(
    (r) =>
      r.name?.toLowerCase().includes(kw) ||
      r.pattern?.toLowerCase().includes(kw) ||
      r.scope?.toLowerCase().includes(kw)
  )
})

async function saveRule() {
  if (!ruleForm.value.name || !ruleForm.value.pattern) {
    error('名称和规则不能为空')
    return
  }
  const res = await saveReplaceRule({
    ...ruleForm.value,
    isRegex: ruleForm.value.isRegex || false,
    isEnabled: ruleForm.value.isEnabled !== false,
  })
  if (res.isSuccess) {
    success(ruleForm.value.name ? '保存成功' : '添加成功')
    showEdit.value = false
    ruleForm.value = {}
    editingRule.value = null
    loadRules()
  } else if (res.errorMsg) {
    error(res.errorMsg)
  }
}

async function editRule(rule?: ReplaceRule) {
  if (rule) {
    editingRule.value = rule
    ruleForm.value = { ...rule }
  } else {
    editingRule.value = null
    ruleForm.value = {
      name: '',
      pattern: '',
      replacement: '',
      scope: '',
      isRegex: false,
      isEnabled: true,
    }
  }
  showEdit.value = true
}

async function removeRule(name: string) {
  try {
    await ElMessageBox.confirm('确定删除？', '提示', { type: 'warning' })
    const res = await apiDeleteReplaceRule(name)
    if (res.isSuccess) {
      success('删除成功')
      loadRules()
    }
  } catch { /* cancelled */ }
}

async function batchDelete() {
  if (selected.value.size === 0) return
  try {
    await ElMessageBox.confirm(`确定删除选中的 ${selected.value.size} 个规则吗？`, '提示', { type: 'warning' })
    const names = Array.from(selected.value)
    const res = await apiDeleteReplaceRules(names)
    if (res.isSuccess) {
      success('删除成功')
      selected.value.clear()
      loadRules()
    }
  } catch { /* cancelled */ }
}

const scopeOptions = [
  { label: '全部', value: '' },
  { label: '书源', value: 'bookSource' },
  { label: '搜索结果', value: 'searchResult' },
  { label: '书籍详情', value: 'bookInfo' },
  { label: '章节列表', value: 'chapterList' },
  { label: '章节内容', value: 'content' },
  { label: '书签', value: 'bookmark' },
]
</script>

<template>
  <div class="replace-rule-container">
    <el-row :gutter="20" style="margin-bottom: 16px;">
      <el-col :span="10">
        <el-input v-model="searchQuery" placeholder="搜索替换规则" :prefix-icon="Warning" />
      </el-col>
      <el-col :span="14" style="text-align: right;">
        <el-button type="primary" :icon="Plus" @click="editRule()">
          添加规则
        </el-button>
        <el-button type="danger" :icon="Delete" @click="batchDelete" :disabled="selected.size === 0">
          批量删除
        </el-button>
      </el-col>
    </el-row>

    <el-table
      :data="filteredRules"
      stripe
      v-loading="loading"
      style="width: 100%"
    >
      <el-table-column type="selection" />
      <el-table-column prop="name" label="名称" min-width="140" />
      <el-table-column prop="pattern" label="匹配规则" min-width="200" />
      <el-table-column prop="replacement" label="替换内容" min-width="200" />
      <el-table-column prop="scope" label="作用域" width="120">
        <template #default="{ row }">
          {{ scopeOptions.find(s => s.value === row.scope)?.label || row.scope || '全部' }}
        </template>
      </el-table-column>
      <el-table-column prop="isRegex" label="正则" width="80">
        <template #default="{ row }">
          <el-tag :type="row.isRegex ? 'primary' : 'info'" size="small">
            {{ row.isRegex ? '是' : '否' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="isEnabled" label="启用" width="80">
        <template #default="{ row }">
          <ElSwitch v-model="row.isEnabled" :active-value="true" :inactive-value="false" />
        </template>
      </el-table-column>
      <el-table-column label="操作" width="120" fixed="right">
        <template #default="{ row }">
          <el-button :icon="Edit" size="small" text @click="editRule(row)" />
          <el-button :icon="Delete" size="small" type="danger" text @click="removeRule(row.name)" />
        </template>
      </el-table-column>
    </el-table>

    <el-dialog
      v-model="showEdit"
      :title="editingRule ? '编辑替换规则' : '添加替换规则'"
      width="600px"
      :append-to-body="false"
    >
      <el-form :model="ruleForm" label-width="100px">
        <el-form-item label="名称">
          <el-input v-model="ruleForm.name" placeholder="规则名称" />
        </el-form-item>
        <el-form-item label="作用域">
          <el-select v-model="ruleForm.scope" placeholder="选择作用域" style="width: 100%">
            <el-option
              v-for="opt in scopeOptions"
              :key="opt.value"
              :label="opt.label"
              :value="opt.value"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="匹配规则">
          <el-input v-model="ruleForm.pattern" type="textarea" :rows="4" placeholder="输入匹配的文本或正则" />
        </el-form-item>
        <el-form-item label="替换内容">
          <el-input v-model="ruleForm.replacement" type="textarea" :rows="4" placeholder="输入替换后的文本" />
        </el-form-item>
        <el-form-item label="使用正则">
          <el-switch v-model="ruleForm.isRegex" />
        </el-form-item>
        <el-form-item label="启用">
          <el-switch v-model="ruleForm.isEnabled" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showEdit = false">取消</el-button>
        <el-button type="primary" @click="saveRule">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.replace-rule-container {
  padding: 0;
}
</style>
