<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import {
  Collection,
  Search,
  Compass,
  Setting,
  Notebook,
  Folder,
  Flag,
  List as Feed,
  FolderOpened,
  Microphone,
  User,
  Document,
  ReadingLamp,
  MagicStick,
  Fold,
  Expand,
  SwitchButton,
} from '@element-plus/icons-vue'
import { useAppStore } from '@/stores/app'
import { useAuthStore } from '@/stores/auth'

const router = useRouter()
const route = useRoute()
const appStore = useAppStore()
const authStore = useAuthStore()
const collapsed = ref(false)

const menuItems = computed(() => [
  {
    path: '/bookshelf',
    name: 'Bookshelf',
    label: '书架',
    icon: Collection,
  },
  {
    path: '/search',
    name: 'Search',
    label: '搜索',
    icon: Search,
  },
  {
    path: '/explore',
    name: 'Explore',
    label: '发现',
    icon: Compass,
  },
  {
    divider: true,
  },
  {
    path: '/manage/book-source',
    name: 'BookSource',
    label: '书源',
    icon: Notebook,
  },
  {
    path: '/manage/book-group',
    name: 'BookGroup',
    label: '书组',
    icon: Folder,
  },
  {
    path: '/manage/book-manage',
    name: 'BookManage',
    label: '书籍管理',
    icon: Notebook,
  },
  {
    path: '/manage/replace-rule',
    name: 'ReplaceRule',
    label: '替换规则',
    icon: MagicStick,
  },
  {
    divider: true,
  },
  {
    path: '/manage/bookmark',
    name: 'Bookmark',
    label: '书签',
    icon: Flag,
  },
  {
    path: '/manage/rss',
    name: 'Rss',
    label: 'RSS',
    icon: Feed,
  },
  {
    path: '/manage/file',
    name: 'File',
    label: '文件管理',
    icon: FolderOpened,
  },
  {
    path: '/manage/tts',
    name: 'TTS',
    label: '语音合成',
    icon: Microphone,
  },
  {
    divider: true,
  },
  {
    path: '/manage/user',
    name: 'User',
    label: '用户管理',
    icon: User,
  },
  {
    path: '/manage/settings',
    name: 'Settings',
    label: '设置',
    icon: Setting,
  },
])

function handleSelect(path: string) {
  if (path === route.path) return
  router.push(path)
}

function handleLogout() {
  authStore.clearAuth()
  router.push('/login')
  ElMessage.success('已退出登录')
}

const currentPath = computed(() => route.path)
</script>

<template>
  <el-container class="layout-container">
    <el-aside :width="collapsed ? '64px' : '220px'" class="sidebar">
      <div class="logo" @click="router.push('/bookshelf')">
        <el-icon :size="28"><ReadingLamp /></el-icon>
        <span v-show="!collapsed" class="logo-text">阅读</span>
      </div>
      <el-menu
        :default-active="currentPath"
        :collapse="collapsed"
        :collapse-transition="false"
        router
        class="sidebar-menu"
        @select="handleSelect"
      >
        <template v-for="item in menuItems" :key="item.name || item.path">
          <el-menu-item v-if="!item.divider" :index="item.path">
            <el-icon><component :is="item.icon" /></el-icon>
            <template #title>{{ item.label }}</template>
          </el-menu-item>
          <el-divider v-else :style="{ margin: '8px 0', borderColor: '#374151' }" />
        </template>
      </el-menu>
      <div class="sidebar-footer">
        <el-tooltip :content="collapsed ? '展开' : '收起'" placement="right">
          <el-button :icon="collapsed ? Expand : Fold" circle size="small" @click="collapsed = !collapsed" />
        </el-tooltip>
      </div>
    </el-aside>
    <el-container>
      <el-header class="header">
        <div class="header-left">
          <slot name="header-left" />
        </div>
        <div class="header-right">
          <el-dropdown v-if="authStore.isLoggedIn" trigger="click">
            <div class="user-info">
              <el-avatar :size="30" class="user-avatar">
                {{ authStore.username?.charAt(0)?.toUpperCase() || 'U' }}
              </el-avatar>
              <span class="username">{{ authStore.username }}</span>
            </div>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item @click="router.push('/manage/settings')">
                  <el-icon><Setting /></el-icon>
                  设置
                </el-dropdown-item>
                <el-dropdown-item divided @click="handleLogout">
                  <el-icon><SwitchButton /></el-icon>
                  退出登录
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
          <el-button v-else type="primary" @click="router.push('/login')">登录</el-button>
        </div>
      </el-header>
      <el-main class="main-content">
        <slot />
      </el-main>
    </el-container>
  </el-container>
</template>
