<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { Plus, Delete, Refresh, Loading, ZoomIn, Link } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox, ElTag, ElCard } from 'element-plus'
import { getRssSources as apiGetSources, saveRssSource as apiSave, deleteRssSource as apiDelete } from '@/api/rss'
import { getRssArticles as apiGetArticles, getRssContent, getRssBookContent } from '@/api/rss'
import { getBookSources as apiGetBookSources } from '@/api/bookSource'
import { getBookInfo, getChapterList, getBookContent } from '@/api/book'
import { useNotify } from '@/utils/helpers'
import type { RssSource, RssArticle } from '@/api/types'

const { success, error } = useNotify()

const sources = ref<RssSource[]>([])
const articles = ref<RssArticle[]>([])
const currentSource = ref<RssSource | null>(null)
const showAdd = ref(false)
const sourceForm = ref<Partial<RssSource>>({})
const activeTab = ref('sources')
const loading = ref(false)
const loadingArticles = ref(false)
const articleContent = ref('')
const currentArticle = ref<RssArticle | null>(null)
const showArticleContent = ref(false)

onMounted(() => {
  loadSources()
})

async function loadSources() {
  loading.value = true
  try {
    const res = await apiGetSources()
    if (res.isSuccess) {
      sources.value = (res.data as RssSource[]) || []
    }
  } finally {
    loading.value = false
  }
}

async function loadArticles(sourceName: string) {
  currentSource.value = sources.value.find((s) => s.rssSrcName === sourceName) || null
  if (!currentSource.value) return
  loadingArticles.value = true
  articles.value = []
  try {
    const res = await apiGetArticles(sourceName, 1)
    if (res.isSuccess) {
      articles.value = (res.data as RssArticle[]) || []
    }
  } finally {
    loadingArticles.value = false
  }
}

async function readArticle(article: RssArticle) {
  currentArticle.value = article
  showArticleContent.value = true
  articleContent.value = ''
  try {
    const res = await getRssContent(article.articleUrl)
    if (res.isSuccess) {
      const data = res.data as any
      articleContent.value = data.content || data
    } else if (res.errorMsg) {
      error(res.errorMsg)
    }
  } catch {
    error('加载内容失败')
  }
}

async function addSource() {
  if (!sourceForm.value.rssSrcName || !sourceForm.value.rssSrcUrl) {
    error('请填写名称和URL')
    return
  }
  const res = await apiSave({
    ...sourceForm.value,
    interval: sourceForm.value.interval || 30,
  })
  if (res.isSuccess) {
    success('添加成功')
    showAdd.value = false
    sourceForm.value = {}
    loadSources()
  } else if (res.errorMsg) {
    error(res.errorMsg)
  }
}

async function removeSource(name: string) {
  try {
    await ElMessageBox.confirm('确定删除？', '提示', { type: 'warning' })
    const res = await apiDelete(name)
    if (res.isSuccess) {
      success('删除成功')
      loadSources()
    }
  } catch { /* cancelled */ }
}

async function refreshSource(name: string) {
  const bookSources = await apiGetBookSources()
  if (bookSources.isSuccess) {
    success('刷新完成')
  }
}
</script>

<template>
  <div class="rss-container">
    <el-tabs v-model="activeTab" type="border-card">
      <el-tab-pane label="RSS源" name="sources">
        <el-row :gutter="20" style="margin-bottom: 16px;">
          <el-col :span="18"><h3>RSS源管理</h3></el-col>
          <el-col :span="6" style="text-align: right;">
            <el-button type="primary" :icon="Plus" @click="showAdd = true">
              添加
            </el-button>
            <el-button :icon="Refresh" @click="loadSources">
              刷新
            </el-button>
          </el-col>
        </el-row>
        <el-table :data="sources" stripe v-loading="loading">
          <el-table-column prop="rssSrcName" label="名称" min-width="150" />
          <el-table-column prop="rssSrcUrl" label="URL" min-width="250" />
          <el-table-column prop="rssSrcGroup" label="分组" width="120" />
          <el-table-column prop="interval" label="间隔(min)" width="120" />
          <el-table-column label="操作" width="150" fixed="right">
            <template #default="{ row }">
              <el-button text size="small" @click="loadArticles(row.rssSrcName)">
                查看文章
              </el-button>
              <el-button :icon="Delete" type="danger" text size="small" @click="removeSource(row.rssSrcName)" />
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <el-tab-pane label="文章" name="articles">
        <el-empty v-if="!currentSource" description="先选择一个 RSS 源" />
        <template v-else>
          <div class="article-header">
            <h3>{{ currentSource.rssSrcName }}</h3>
            <el-tag size="small">{{ currentSource.rssSrcUrl }}</el-tag>
          </div>
          <el-table
            :data="articles"
            stripe
            v-loading="loadingArticles"
            style="width: 100%"
          >
            <el-table-column prop="articleTitle" label="标题" min-width="300" />
            <el-table-column prop="author" label="作者" width="120" />
            <el-table-column prop="pubDate" label="发布日期" width="160" />
            <el-table-column label="操作" width="100" fixed="right">
              <template #default="{ row }">
                <el-button
                  :icon="ZoomIn"
                  text
                  size="small"
                  @click="readArticle(row)"
                >
                  阅读
                </el-button>
              </template>
            </el-table-column>
          </el-table>
        </template>
      </el-tab-pane>
    </el-tabs>

    <el-dialog
      v-model="showArticleContent"
      :title="currentArticle?.articleTitle"
      width="900px"
      :append-to-body="false"
    >
      <div class="article-content" v-html="articleContent" />
      <template #footer>
        <el-button @click="showArticleContent = false">
          关闭
        </el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="showAdd" title="添加RSS源" width="500px" :append-to-body="false">
      <el-form :model="sourceForm" label-width="100px">
        <el-form-item label="名称">
          <el-input v-model="sourceForm.rssSrcName" />
        </el-form-item>
        <el-form-item label="URL">
          <el-input v-model="sourceForm.rssSrcUrl" />
        </el-form-item>
        <el-form-item label="分组">
          <el-input v-model="sourceForm.rssSrcGroup" />
        </el-form-item>
        <el-form-item label="更新间隔(分钟)">
          <el-input-number v-model.number="sourceForm.interval" :min="1" :max="1440" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showAdd = false">取消</el-button>
        <el-button type="primary" @click="addSource">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.rss-container {
  padding: 0;
}
.article-header h3 {
  margin: 0 0 8px 0;
}
.article-content {
  max-height: 600px;
  overflow-y: auto;
  padding: 16px;
  line-height: 1.8;
}
</style>
