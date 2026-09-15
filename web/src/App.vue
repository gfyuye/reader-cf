<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useAppStore } from '@/stores/app'
import AppLayout from '@/components/Layout/AppLayout.vue'

const route = useRoute()
const appStore = useAppStore()

const isFullscreen = computed(() => route.meta.fullscreen === true)
</script>

<template>
  <div v-if="isFullscreen" class="fullscreen-page">
    <router-view />
  </div>
  <AppLayout v-else>
    <router-view />
  </AppLayout>
</template>
