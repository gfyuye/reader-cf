<script setup lang="ts">
import { computed, onMounted, onBeforeMount } from 'vue'
import { useRoute } from 'vue-router'
import { useAppStore } from '@/stores/app'
import { useSettingsStore } from '@/stores/settings'
import AppLayout from '@/components/Layout/AppLayout.vue'

const route = useRoute()
const appStore = useAppStore()
const settingsStore = useSettingsStore()

const isFullscreen = computed(() => route.meta.fullscreen === true)

function setTheme(isNight: boolean) {
  if (isNight) {
    document.body.className = (document.body.className || '').replace('night-theme', '') + ' night-theme'
  } else {
    document.body.className = (document.body.className || '').replace('night-theme', '')
  }
}

function setMiniInterfaceClass() {
  if (settingsStore.shelfConfig?.miniInterface) {
    document.body.className = (document.body.className || '').replace('mini-interface', '') + ' mini-interface'
  } else {
    document.body.className = (document.body.className || '').replace('mini-interface', '')
  }
}

function setPageTypeClass() {
  if (settingsStore.config?.isKindlePage) {
    document.body.className = (document.body.className || '').replace('kindle-page', '') + ' kindle-page'
  } else {
    document.body.className = (document.body.className || '').replace('kindle-page', '')
  }
}

window.setTheme = (isNight: boolean) => {
  if (isNight) {
    document.body.className = (document.body.className || '').replace('night-theme', '') + ' night-theme'
  } else {
    document.body.className = (document.body.className || '').replace('night-theme', '')
  }
}

window.setMiniInterfaceClass = () => {
  if (settingsStore.shelfConfig?.miniInterface) {
    document.body.className = (document.body.className || '').replace('mini-interface', '') + ' mini-interface'
  } else {
    document.body.className = (document.body.className || '').replace('mini-interface', '')
  }
}

window.setPageTypeClass = () => {
  if (settingsStore.config?.isKindlePage) {
    document.body.className = (document.body.className || '').replace('kindle-page', '') + ' kindle-page'
  } else {
    document.body.className = (document.body.className || '').replace('kindle-page', '')
  }
}

window.autoSetTheme = (autoTheme: boolean) => {
  if (autoTheme) {
    if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
      settingsStore.setNightTheme(true)
    } else {
      settingsStore.setNightTheme(false)
    }
  }
}

onBeforeMount(() => {
  settingsStore.syncFromLocalStorage()
  setTheme(settingsStore.isNight)
  setMiniInterfaceClass()
  setPageTypeClass()
})

onMounted(() => {
  document.documentElement.style.setProperty('--vh', `${window.innerHeight * 0.01}px`)
  if (settingsStore.config?.autoTheme) {
    window.autoSetTheme(settingsStore.config.autoTheme)
  }
})
</script>

<template>
  <div v-if="isFullscreen" class="fullscreen-page">
    <router-view />
  </div>
  <AppLayout v-else>
    <router-view />
  </AppLayout>
</template>
