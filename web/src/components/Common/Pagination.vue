<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  total: number
  page: number
  pageSize: number
  onChange?: (page: number) => void
}>(), {
  pageSize: 20,
})

const pages = computed(() => {
  const totalPages = Math.ceil(props.total / props.pageSize)
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1)
  const current = props.page
  if (current <= 4) return [1, 2, 3, 4, 5, '...', totalPages]
  if (current >= totalPages - 3) return [1, '...', totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages]
  return [1, '...', current - 1, current, current + 1, '...', totalPages]
})
</script>

<template>
  <div class="pagination">
    <el-pagination
      :total="total"
      :current-page="page"
      :page-size="pageSize"
      :pager-count="7"
      layout="prev, pager, next"
      @current-change="$emit('change', $event)"
    />
  </div>
</template>

<style scoped>
.pagination {
  display: flex;
  justify-content: center;
  margin-top: 16px;
}
</style>
