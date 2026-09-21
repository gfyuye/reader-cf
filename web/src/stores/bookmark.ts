import { defineStore } from 'pinia'
import { ref } from 'vue'
import { getBookmarks, saveBookmark as apiSaveBookmark, deleteBookmark as apiDeleteBookmark, deleteBookmarksByTime as apiDeleteBookmarksByTime, saveBookmarks as apiSaveBookmarks } from '@/api/other'
import type { Bookmark } from '@/api/types'
import { useAuthStore } from './auth'
import { useNotify } from '@/utils/helpers'

export const useBookmarkStore = defineStore('bookmark', () => {
  const { success, error } = useNotify()
  const authStore = useAuthStore()
  const bookmarks = ref<Bookmark[]>([])
  const loading = ref(false)

  async function loadBookmarks(userNameSpace?: string) {
    loading.value = true
    try {
      const res = await getBookmarks()
      if (res.isSuccess) {
        bookmarks.value = (res.data as Bookmark[]) || []
      }
    } finally {
      loading.value = false
    }
  }

  async function addBookmark(
    bookUrl: string,
    bookName: string,
    bookAuthor: string,
    chapterUrl: string,
    chapterName: string,
    bookmarkText: string,
    chapterIndex?: number,
    chapterPos?: number,
    userNameSpace?: string
  ) {
    const bookmark: Partial<Bookmark> = {
      bookUrl,
      bookName,
      bookAuthor,
      chapterUrl,
      chapterName,
      bookmarkText,
      chapterIndex,
      chapterPos,
      time: Date.now(),
    }
    const res = await apiSaveBookmark({ ...bookmark, userNameSpace })
    if (res.isSuccess) {
      success('书签添加成功')
      loadBookmarks(userNameSpace)
    } else if (res.errorMsg) {
      error(res.errorMsg)
    }
    return res
  }

  async function removeBookmark(time: number) {
    const res = await apiDeleteBookmark({ time: time as any })
    if (res.isSuccess) {
      success('删除成功')
      bookmarks.value = bookmarks.value.filter((b) => b.time !== time)
    } else if (res.errorMsg) {
      error(res.errorMsg)
    }
    return res
  }

  async function removeBookmarks(times: number[]) {
    const res = await apiDeleteBookmarksByTime(times)
    if (res.isSuccess) {
      success('批量删除成功')
      bookmarks.value = bookmarks.value.filter((b) => !times.includes(b.time))
    }
    return res
  }

  async function saveBookmarkBatch(bookmarksToSave: Bookmark[]) {
    const res = await apiSaveBookmarks(bookmarksToSave)
    if (res.isSuccess) {
      success('保存成功')
      loadBookmarks()
    }
    return res
  }

  return {
    bookmarks,
    loading,
    loadBookmarks,
    addBookmark,
    removeBookmark,
    removeBookmarks,
  }
})
