<script setup lang="ts">
import { ref, computed, onBeforeUnmount } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
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
  Lock,
  ArrowDown,
} from '@element-plus/icons-vue'
import { useAppStore } from '@/stores/app'
import { useAuthStore } from '@/stores/auth'
import { getUserList, getUserInfo } from '@/api/user'

const router = useRouter()
const route = useRoute()
const appStore = useAppStore()
const authStore = useAuthStore()
const collapsed = ref(false)

const menuItems = computed(() => [
  { path: '/bookshelf', name: 'Bookshelf', label: '书架', icon: Collection, meta: { icon: 'Collection' } },
  { path: '/search', name: 'Search', label: '搜索', icon: Search, meta: { icon: 'Search' } },
  { path: '/explore', name: 'Explore', label: '发现', icon: Compass, meta: { icon: 'Compass' } },
  { divider: true },
  { path: '/manage/book-source', name: 'BookSource', label: '书源', icon: Notebook, meta: { icon: 'Notebook' } },
  { path: '/manage/book-group', name: 'BookGroup', label: '书组', icon: Folder, meta: { icon: 'Folder' } },
  { path: '/manage/book-manage', name: 'BookManage', label: '书籍管理', icon: Notebook, meta: { icon: 'Notebook' } },
  { path: '/manage/replace-rule', name: 'ReplaceRule', label: '替换规则', icon: MagicStick, meta: { icon: 'MagicStick' } },
  { divider: true },
  { path: '/manage/bookmark', name: 'Bookmark', label: '书签', icon: Flag, meta: { icon: 'Flag' } },
  { path: '/manage/rss', name: 'Rss', label: 'RSS', icon: Feed, meta: { icon: 'Feed' } },
  { path: '/manage/file', name: 'File', label: '文件管理', icon: FolderOpened, meta: { icon: 'FolderOpened' } },
  { path: '/manage/tts', name: 'TTS', label: '语音合成', icon: Microphone, meta: { icon: 'Microphone' } },
  { divider: true },
  { path: '/manage/user', name: 'User', label: '用户管理', icon: User, meta: { icon: 'User', requiresAdmin: true } },
  { path: '/manage/settings', name: 'Settings', label: '设置', icon: Setting, meta: { icon: 'Setting' } },
] as Array<{ path: string; name: string; label: string; icon: any; divider?: boolean; meta?: any } | { divider: true }>)

const currentPath = computed(() => route.path)

function handleSelect(path: string) {
  if (path === route.path) return
  router.push(path)
}

async function handleLogout() {
  try {
    await authStore.logout()
  } catch {
    /* ignore */
  }
}

async function enterManagerMode() {
  try {
    const { value } = await ElMessageBox.prompt('请输入管理密码', '管理模式', {
      inputType: 'password',
      cancelButtonText: '取消',
      confirmButtonText: '确定',
    })
    authStore.enterManagerMode(value)
    ElMessage.success('已进入管理模式')
  } catch {
    /* cancelled */
  }
}

function exitManagerMode() {
  authStore.exitManagerMode()
  ElMessage.success('已退出管理模式')
}

function handleUserNSChange(ns: string) {
  authStore.switchUserNS(ns)
}

onBeforeUnmount(() => {
  // cleanup
})
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
        <template v-for="(item, idx) in menuItems" :key="item.divider ? 'divider-' + idx : item.name">
          <el-divider v-if="item.divider" :style="{ margin: '8px 0', borderColor: '#374151' }" />
          <el-menu-item v-else :index="item.path">
            <el-icon><component :is="item.icon" /></el-icon>
            <template #title>{{ item.label }}</template>
          </el-menu-item>
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
          <el-breadcrumb separator="/">
            <el-breadcrumb-item :to="{ path: '/' }">阅读</el-breadcrumb-item>
            <el-breadcrumb-item v-if="route.path !== '/' && !route.path.includes('login')" :to="{ path: route.path }">
              {{ route.meta.title || '' }}
            </el-breadcrumb-item>
          </el-breadcrumb>
        </div>
        <div class="header-right">
          <el-dropdown v-if="authStore.isLoggedIn" trigger="click">
            <div class="user-info">
              <el-avatar :size="30" class="user-avatar">
                {{ authStore.username?.charAt(0)?.toUpperCase() || 'U' }}
              </el-avatar>
              <span class="username">{{ authStore.username }}</span>
              <el-icon class="el-icon--right"><ArrowDown /></el-icon>
            </div>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item v-if="!authStore.isManagerMode" @click="enterManagerMode">
                  <el-icon><Lock /></el-icon>
                  进入管理模式
                </el-dropdown-item>
                <el-dropdown-item v-if="authStore.isManagerMode" @click="exitManagerMode">
                  <el-icon><SwitchButton /></el-icon>
                  退出管理模式
                </el-dropdown-item>
                <el-dropdown-item v-if="authStore.showManagerMode && authStore.isManagerMode" @click="router.push('/manage/user')">
                  <el-icon><User /></el-icon>
                  用户权限管理
                </el-dropdown-item>
                <el-dropdown-item divided @click="router.push('/manage/settings')">
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

<style scoped>
.layout-container {
  height: 100vh;
}

.sidebar {
  background: #304156;
  transition: width 0.3s;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.logo {
  height: 60px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: #fff;
  font-size: 20px;
  font-weight: bold;
  border-bottom: 1px solid #263445;
  cursor: pointer;
  flex-shrink: 0;
}

.sidebar-menu {
  flex: 1;
  overflow-y: auto;
  border-right: none !important;
  background: #304156;
}

.sidebar-menu .el-menu-item {
  height: 50px;
  line-height: 50px;
  color: #bfcbd9;
}

.sidebar-menu .el-menu-item:hover {
  background-color: #263445 !important;
}

.sidebar-menu .el-menu-item.is-active {
  background-color: var(--el-color-primary) !important;
  color: #fff;
}

.sidebar-footer {
  padding: 12px;
  display: flex;
  justify-content: center;
  border-top: 1px solid #263445;
  flex-shrink: 0;
}

.sidebar-footer .el-button {
  color: #bfcbd9;
  background: transparent;
  border: 1px solid var(--el-color-primary);
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  height: var(--header-height, 60px);
  background: #fff;
  border-bottom: 1px solid var(--border-light, #e4e7ed);
  padding: 0 20px;
  flex-shrink: 0;
}

.header-left {
  display: flex;
  align-items: center;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 16px;
}

.header-icon {
  cursor: pointer;
  color: var(--el-text-color-regular);
  transition: color 0.2s;
}

.header-icon:hover {
  color: var(--el-color-primary);
}

.user-info {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.user-avatar {
  background: var(--el-color-primary);
  color: #fff;
}

.username {
  font-size: 14px;
  color: var(--el-text-color-primary);
}

.main-content {
  background: var(--bg-page, #f0f2f5);
  padding: 16px;
  overflow-y: auto;
}

@media (max-width: 768px) {
  .sidebar {
    width: 64px !important;
  }
}
</style>
