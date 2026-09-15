<script setup lang="ts">
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { get } from '@/api/http'

const discoverItems = ref<any[]>([])
const loading = ref(false)

async function loadDiscover() {
  loading.value = true
  try {
    const res = await get('/exploreBook', { ruleFindUrl: '', page: 1 })
    if (res.isSuccess) discoverItems.value = res.data || []
  } finally {
    loading.value = false
  }
}

loadDiscover()
</script>

<template>
  <div>
    <h2>发现</h2>
    <el-card v-for="item in discoverItems" :key="item.bookUrl" shadow="hover" style="margin-bottom: 12px;">
      <div class="discover-item">
        <h4>{{ item.name }}</h4>
        <p>{{ item.author }} - {{ item.bookSource }}</p>
      </div>
    </el-card>
    <el-empty v-if="discoverItems.length === 0 && !loading" description="暂无发现内容" />
  </div>
</template>
