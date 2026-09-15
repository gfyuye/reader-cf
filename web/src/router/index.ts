import { createRouter, createWebHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'
import { useAppStore } from '@/stores/app'
import { useAuthStore } from '@/stores/auth'

const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'Login',
    component: () => import('@/views/LoginView.vue'),
    meta: { title: '登录', fullscreen: true },
  },
  {
    path: '/bookshelf',
    name: 'Bookshelf',
    component: () => import('@/views/BookshelfView.vue'),
    meta: { title: '书架', icon: 'Collection' },
  },
  {
    path: '/reader/:bookUrl',
    name: 'Reader',
    component: () => import('@/views/ReaderView.vue'),
    meta: { title: '阅读', icon: 'Reading' },
    props: true,
  },
  {
    path: '/book-info/:bookUrl',
    name: 'BookInfo',
    component: () => import('@/views/BookInfoView.vue'),
    meta: { title: '书籍详情', icon: 'Document' },
    props: true,
  },
  {
    path: '/search',
    name: 'Search',
    component: () => import('@/views/SearchView.vue'),
    meta: { title: '搜索', icon: 'Search' },
  },
  {
    path: '/explore',
    name: 'Explore',
    component: () => import('@/views/ExploreView.vue'),
    meta: { title: '发现', icon: 'Compass' },
  },
  {
    path: '/manage/book-source',
    name: 'BookSource',
    component: () => import('@/views/BookSourceView.vue'),
    meta: { title: '书源', icon: 'Notebook' },
  },
  {
    path: '/manage/book-group',
    name: 'BookGroup',
    component: () => import('@/views/BookGroupView.vue'),
    meta: { title: '书组', icon: 'Folder' },
  },
  {
    path: '/manage/book-manage',
    name: 'BookManage',
    component: () => import('@/views/BookManageView.vue'),
    meta: { title: '书籍管理', icon: 'Notebook' },
  },
  {
    path: '/manage/replace-rule',
    name: 'ReplaceRule',
    component: () => import('@/views/ReplaceRuleView.vue'),
    meta: { title: '替换规则', icon: 'MagicStick' },
  },
  {
    path: '/manage/bookmark',
    name: 'Bookmark',
    component: () => import('@/views/BookmarkView.vue'),
    meta: { title: '书签', icon: 'Flag' },
  },
  {
    path: '/manage/rss',
    name: 'Rss',
    component: () => import('@/views/RssView.vue'),
    meta: { title: 'RSS', icon: 'Feed' },
  },
  {
    path: '/manage/file',
    name: 'File',
    component: () => import('@/views/FileManagerView.vue'),
    meta: { title: '文件管理', icon: 'FolderOpened' },
  },
  {
    path: '/manage/tts',
    name: 'TTS',
    component: () => import('@/views/TTSView.vue'),
    meta: { title: '语音合成', icon: 'Microphone' },
  },
  {
    path: '/manage/user',
    name: 'User',
    component: () => import('@/views/UserManageView.vue'),
    meta: { title: '用户管理', icon: 'User', requiresAdmin: true },
  },
  {
    path: '/manage/settings',
    name: 'Settings',
    component: () => import('@/views/SettingsView.vue'),
    meta: { title: '设置', icon: 'Setting' },
  },
  {
    path: '/',
    redirect: '/bookshelf',
  },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

router.beforeEach(async (to, from, next) => {
  const appStore = useAppStore()
  const authStore = useAuthStore()

  document.title = to.meta.title ? `${to.meta.title} - 阅读` : '阅读'

  if (to.path === '/login') {
    if (authStore.token) {
      next({ path: '/' })
    } else {
      next()
    }
    return
  }

  if (!appStore.appReady) {
    await appStore.initApp()
  }

  if (appStore.appConfig.secure && !authStore.token) {
    next({ path: '/login' })
    return
  }

  next()
})

export default router
