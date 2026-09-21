import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Book } from '@/api/types'

export interface ShelfBook {
  book: Book
  progress: number
  chapterCount: number
  lastChapterRead?: string
}

export const useBookshelfStore = defineStore('bookshelf', () => {
  const shelfList = ref<Book[]>([])
  const loading = ref(false)

  async function getBookshelf(userNameSpace?: string) {
    loading.value = true
    try {
      const bookApi = await import('@/api/book')
      const res = await bookApi.getBookshelf(userNameSpace)
      if (res.isSuccess) {
        shelfList.value = res.data as Book[]
      }
    } finally {
      loading.value = false
    }
  }

  async function saveBook(book: Book) {
    const bookApi = await import('@/api/book')
    return bookApi.saveBook(book)
  }

  async function deleteBook(bookUrl: string) {
    const bookApi = await import('@/api/book')
    return bookApi.deleteBook(bookUrl)
  }

  return { shelfList, loading, getBookshelf, saveBook, deleteBook }
})
