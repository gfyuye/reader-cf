<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { Search, Bell, FullScreen, RefreshRight } from '@element-plus/icons-vue'
import { useAuthStore } from '@/stores/auth'
import { useAppStore } from '@/stores/app'

const route = useRoute()
const authStore = useAuthStore()
const appStore = useAppStore()

const breadcrumb = computed(() => {
  const paths = route.path.split('/').filter(Boolean)
  const labels: Record<string, string> = {
    bookshelf: '书架',
    search: '搜索',
    explore: '发现',
    manage: '管理',
    reader: '阅读',
    bookInfo: '书籍详情',
    login: '登录',
  }
  const result: Array<{ label: string; path: string }> = [{ label: '阅读', path: '/' }]
  let currentPath = ''
  for (const p of paths) {
    currentPath += '/' + p
    if (labels[p]) {
      result.push({ label: labels[p], path: currentPath })
    }
  }
  return result
})
</script>

<template>
  <div class="header">
    <div class="header-left">
      <el-breadcrumb separator="/">
        <el-breadcrumb-item
          v-for="(item, idx) in breadcrumb"
          :key="idx"
          :to="{ path: item.path }"
        >
          {{ item.label }}
        </el-breadcrumb-item>
      </el-breadcrumb>
    </div>
    <div class="header-right">
      <el-icon :size="20" class="header-icon"><Search /></el-icon>
      <el-icon :size="20" class="header-icon"><Bell /></el-icon>
      <el-icon :size="20" class="header-icon"><RefreshRight /></el-icon>
    </div>
  </div>
</template>
