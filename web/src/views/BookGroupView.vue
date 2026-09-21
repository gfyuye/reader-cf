<script setup lang="ts">
import { ref, computed } from 'vue'
import { Folder, Plus, Delete, Edit } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { getBookGroups, saveBookGroup, deleteBookGroup as apiDeleteBookGroup } from '@/api/other'
import { useNotify } from '@/utils/helpers'

const { success, error } = useNotify()
const groups = ref<any[]>([])
const showAdd = ref(false)
const showEdit = ref(false)
const editingGroup = ref<any>(null)
const newGroupName = ref('')
const selectedGroup = ref('全部')
const loading = ref(false)

async function loadGroups() {
  loading.value = true
  try {
    const res = await getBookGroups()
    if (res.isSuccess) {
      groups.value = res.data || []
    }
  } finally {
    loading.value = false
  }
}

async function addGroup() {
  if (!newGroupName.value.trim()) return
  const res = await saveBookGroup({ groupName: newGroupName.value, order: groups.value.length, show: true })
  if (res.isSuccess) {
    success('分组添加成功')
    showAdd.value = false
    newGroupName.value = ''
    loadGroups()
  } else {
    if (res.errorMsg) { error(res.errorMsg) }
  }
}

async function removeGroup(groupId: number) {
  try {
    await ElMessageBox.confirm('确定要删除这个分组吗？', '提示', { type: 'warning' })
    const res = await apiDeleteBookGroup(groupId)
    if (res.isSuccess) {
      success('删除成功')
      loadGroups()
    } else {
      if (res.errorMsg) { error(res.errorMsg) }
    }
  } catch {
    /* user cancelled */
  }
}

const displayedBooks = computed(() => {
  // Filtered by selected group would go here
  return groups.value
})

loadGroups()
</script>

<template>
  <div class="book-group-container">
    <div class="toolbar">
      <el-input v-model="selectedGroup" placeholder="选择分组" />
      <el-button type="primary" :icon="Plus" @click="showAdd = true">添加分组</el-button>
    </div>
    <el-card v-for="group in displayedBooks" :key="group.groupId" class="group-card">
      <div class="group-header">
        <el-icon :size="18"><Folder /></el-icon>
        <span>{{ group.groupName }}</span>
        <el-button-group class="group-actions">
          <el-button :icon="Edit" size="small" @click="editingGroup = group; showEdit = true" />
          <el-button :icon="Delete" size="small" type="danger" @click="removeGroup(group.groupId)" />
        </el-button-group>
      </div>
    </el-card>
  </div>

  <el-dialog v-model="showAdd" title="添加分组" width="400px">
    <el-form>
      <el-form-item label="分组名称">
        <el-input v-model="newGroupName" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="showAdd = false">取消</el-button>
      <el-button type="primary" @click="addGroup">确定</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.toolbar {
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
  align-items: center;
}
.group-card {
  margin-bottom: 12px;
}
.group-header {
  display: flex;
  align-items: center;
  gap: 8px;
}
.group-header span {
  flex: 1;
}
.group-actions {
  margin-left: auto;
}
</style>
