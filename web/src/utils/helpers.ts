import { ref, computed } from 'vue'
import { ElMessage } from 'element-plus'

export function useNotify() {
  function success(message: string) {
    ElMessage.success({ message, duration: 3000 })
  }

  function error(message: string) {
    ElMessage.error({ message, duration: 5000 })
  }

  function warning(message: string) {
    ElMessage.warning({ message, duration: 3000 })
  }

  function info(message: string) {
    ElMessage.info({ message, duration: 3000 })
  }

  return { success, error, warning, info }
}

export function usePagination(pageSize = 20) {
  const currentPage = ref(1)
  const total = ref(0)
  const pageSizeRef = ref(pageSize)
  const loading = ref(false)

  const offset = computed(() => (currentPage.value - 1) * pageSizeRef.value)

  function goToPage(page: number) {
    currentPage.value = page
  }

  function nextPage() {
    currentPage.value++
  }

  function prevPage() {
    currentPage.value = Math.max(1, currentPage.value - 1)
  }

  return {
    currentPage,
    total,
    pageSize: pageSizeRef,
    loading,
    offset,
    goToPage,
    nextPage,
    prevPage,
  }
}
