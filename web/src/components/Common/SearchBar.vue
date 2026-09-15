<script setup lang="ts">
import { ref } from 'vue'
import { Search } from '@element-plus/icons-vue'

const modelValue = defineModel<string>()
const searchValue = ref('')

defineProps<{
  placeholder?: string
  delay?: number
}>()

const emit = defineEmits<{
  (e: 'search', value: string): void
}>()

function doSearch() {
  emit('search', searchValue.value)
}
</script>

<template>
  <el-input
    v-model="searchValue"
    :placeholder="placeholder || '输入关键词搜索...'"
    :prefix-icon="Search"
    clearable
    @keyup.enter="doSearch"
    @clear="doSearch"
  >
    <template #append>
      <el-button type="primary" @click="doSearch">搜索</el-button>
    </template>
  </el-input>
</template>
