# worker/index.ts 下一步拆分方案

目标：继续按域渐进式拆分 `worker/index.ts`，最终将其压缩到 **80-120 行** 的极薄入口。

目前 `worker/index.ts` 仍有 **4383 行**，剩余的 `handle*` 函数大多是书源、书架、内容、EPUB/PDF/TXT、上传、WebDAV、AI 等核心业务，必须按耦合度从低到高逐步迁移。

## 1. 当前剩余模块评估

| 域 | 涉及函数（大致） | 耦合度 | 说明 |
|---|---|---|---|
| **`upload`** | `handleChunkedUploadInit`, `handleChunkedUploadPart`, `handleChunkedUploadComplete`, `handleUploadFile`, `handleDeleteFile`, `handleImportWebdavBook` | **中低** | 通用分片上传逻辑，EPUB/PDF/TXT 上传都会用到它。 |
| **`book-source`** | `handleGetBookSources`, `handleGetBookSource`, `handleSaveBookSource`, `handleSaveBookSources`, `handleDeleteBookSource`, `handleDeleteBookSources`, `handleDeleteAllBookSources`, `handleReadRemoteSourceFile`, `handleSearchBookMulti`, `handleExploreBook`, `handleTestBookSources`, `handleLoginBookSource`, `handleBookSourceProxy`, `handleBookSourceDebugSSE`, `handleGetExploreKinds` 等 | **中高** | 大量调用 `legado-engine.ts`。 |
| **`bookshelf`** | `handleGetBookshelf`, `handleGetShelfBook`, `handleGetShelfBookWithCacheInfo`, `handleSaveBook`, `handleSaveBooks`, `handleDeleteBook`, `handleDeleteBooks`, `handleSaveBookProgress`, `handleSetBookSource`, `handleSaveBookGroupId` | **中高** | 大量用到 `documentHandlers`。 |
| **`epub`** | `handleEpubUpload`, `handleEpubRead`, `handleEpubStatus`, `handleEpubAsset` + 中央目录解析、索引相关私有函数 | **中高** | 自成一体，逻辑较长。 |
| **`pdf`** | `handlePdfUpload`, `handlePdfStream`, `handlePdfInfo`, `handlePdfToc` | **中高** | R2 Range 流式读取。 |
| **`txt`** | `handleTxtUpload`, `handleTxtRead`, `handleTxtInfo` | **中高** | 编码嗅探、章节切分、偏移索引。 |
| **`content`** | `handleGetBookContent`, `handleGetBookInfo`, `handleGetChapterList` | **极高** | 最复杂，根据书籍来源路由，调用 legado-engine、解密、替换规则。 |
| **`webdav`** | `handleWebdav`, `handleGetWebdavFileList`, `handleGetWebdavFile`, `handleUploadFileToWebdav`, `handleDeleteWebdavFile`, `handleDeleteWebdavFileList`, `handleGetRemoteWebdav`, `handleSaveRemoteWebdav`, `handleTestRemoteWebdav`, `handleSyncRemoteWebdavNow`, `verifyBasicWebdav`, `handleScheduledSync` | **中高** | 与 auth、crypto 强相关。 |
| **`rss`** | `handleGetRssArticles`, `handleGetRssContent` | **中低** | 相对独立。 |
| **`ai`** | `handleGetAiBookMemory`, `handleSaveAiBookMemory`, `handleDeleteAiBookMemory`, `handleAiProxy`, `handleAiProxyImage` | **中低** | D1 + Workers AI/OpenAI 代理。 |
| **`asset`** | `handleGetAsset`（及封面相关） | **低** | R2 资源读取。 |

## 2. 推荐拆分顺序

| 步骤 | 目标 | 操作要点 | 验证 |
|---|---|---|---|
| **Step 9** | `handlers/upload.ts` | 抽离分片上传相关 `handle*` 及私有函数 | `tsc --noEmit` |
| **Step 10** | `handlers/book-source.ts` | 抽离全部书源相关 `handle*`，保留 `legado-engine` 引用 | `tsc --noEmit` |
| **Step 11** | `handlers/bookshelf.ts` | 抽离书架相关 `handle*` | `tsc --noEmit` |
| **Step 12** | `handlers/epub.ts`、`handlers/pdf.ts`、`handlers/txt.ts` | 分三次抽离，每次连同私有函数一并迁移 | `tsc --noEmit` |
| **Step 13** | `handlers/content.ts` | 抽离正文/章节列表/书籍信息 | `tsc --noEmit` |
| **Step 14** | `handlers/webdav.ts` | 抽离 WebDAV 全部相关 | `tsc --noEmit` |
| **Step 15** | `handlers/rss.ts`、`handlers/ai.ts`、`handlers/asset.ts` | 收尾抽离 | `tsc --noEmit` |
| **Step 16** | 路由收束 & 瘦身 `index.ts` | 全量路由走 `router.ts`，`index.ts` 压至 80-150 行 | `tsc --noEmit` + `npm run bundle:check` |

## 3. 建议补充模块

| 文件 | 用途 | 建议时机 |
|---|---|---|
| `worker/db.ts` | 封装 D1 常用操作 | Step 9 前后 |
| `worker/storage.ts` | 封装 R2 常用操作 | 抽离 upload 时 |
| `worker/legado.ts` | 统一 re-export legado-engine | Step 10 开始 |

## 4. 注意事项

- 遵守自底向上的依赖顺序，避免循环依赖
- handler 用到的私有函数必须一并迁移
- 保留 `ExecutionContext` 透传
- 等对应 handler 抽离并接入 `router.ts` 后再删除 stub
- 每次只迁移一个域，迁移后立即 `tsc --noEmit` 和提交

**首个行动：Step 9 - 抽离 `handlers/upload.ts`**
