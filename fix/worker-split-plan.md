# worker/index.ts 全面分析与拆分方案

当前 `worker/index.ts` 已达 **5425 行**，几乎是整个 Cloudflare 版的"上帝文件"。要拆分它，不能一次全搬，得先理清结构、依赖和耦合点，再按域渐进式抽离。

## 1. 整体概览

| 指标 | 数值 | 说明 |
|---|---|---|
| **总行数** | 5425 | 单文件过于庞大，极难阅读、Review、调试 |
| **`handle*` 函数** | 73 | 实际的 API 处理器，几乎覆盖全量业务 |
| **`async function`（总计）** | ~130 | 除 handle 外还包括工具函数、解析函数、上传函数等 |
| **路由分支** | 84+ | 全部写在 `export default.fetch` 的 `if (path === ...)` 链中 |
| **D1 操作** | 151+ | 大量 `env.DB.prepare().bind()` 内联在函数内 |
| **R2 操作** | 较多 | 尤其在 EPUB/PDF/TXT 上传、流式读取、资产处理里频繁使用 |
| **外部依赖** | `legado-engine`、`md5`、`env-defaults` | 其余大部分逻辑都自包含在该文件内 |

## 2. 功能域划分

按实际业务把文件划分成以下模块，能清晰反映现有结构：

| 域 | 涉及函数（大致） | 说明 | 耦合度 |
|---|---|---|---|
| **`auth`** | `handleLogin`, `handleLogout`, `handleGetUserInfo`, `resolveUserNs`, `getAccessToken`, `isAuthorizedAdmin`, `generateSessionToken`, `randomString`, `pbkdf2Hash`, `genSecurePassword`, `verifyPassword` | 用户登录/注册、会话校验、PBKDF2 密码哈希、Secure-Key 越权逻辑。是几乎所有受保护接口的基础依赖。 | **极高（基础）** |
| **`book-source`** | `handleGetBookSources`, `handleGetBookSource`, `handleSaveBookSource`, `handleSaveBookSources`, `handleDeleteBookSource`, `handleDeleteBookSources`, `handleDeleteAllBookSources`, `handleReadRemoteSourceFile`, `handleTestBookSources`, `handleSearchBookMulti`, `handleExploreBook`, `handleGetExploreKinds`, `handleLoginBookSource`, `handleBookSourceProxy`, `handleBookSourceDebugSSE`, ... | 书源增删改查、导入、测试、发现、代理、调试。大量调用 `legado-engine.ts`（`parseSearchResultsWithRules`、`executeLegadoJs`）。 | 中高 |
| **`bookshelf`** | `handleGetBookshelf`, `handleGetShelfBook`, `handleGetShelfBookWithCacheInfo`, `handleSaveBook`, `handleSaveBooks`, `handleDeleteBook`, `handleDeleteBooks`, `handleSaveBookProgress`, `handleSetBookSource`, `handleSaveBookGroupId` | 书架列表、单本详情、进度保存、批量操作。是最常用的核心域。 | 中高 |
| **`content`** | `handleGetBookContent`, `handleGetBookInfo`, `handleGetChapterList`, `fetchTextWithEncoding`, `decryptAes128Cbc`, `encryptAes128Cbc` | 章节列表、正文获取、内容解密。负责路由到 Web/EPUB/PDF/TXT 不同来源，且是调用 `legado-engine` 的重灾区。 | 中高 |
| **`document-json`** | `getDocument`, `saveDocument`, `handleGetDocument`, `handleSaveDocumentItem`, `handleSaveDocumentItems`, `handleDeleteDocumentItem`, `handleDeleteDocumentItems` + 书签/替换规则/书籍分组/RSS源相关 `handle*` | 通用的 "json_documents" CRUD 封装。结构高度相似，极适合先抽离。 | **低（内聚性最高）** |
| **`epub`** | `handleEpubUpload`, `handleEpubRead`, `handleEpubStatus`, `handleEpubAsset`, EPUB 解析索引、中央目录解析相关（`CentralDirEntry` 等） | 大文件上传、R2 存储、zip 中央目录解析、章节索引、Range 读取。逻辑复杂且大量操作 R2。 | 中高（自成体系） |
| **`pdf`** | `handlePdfUpload`, `handlePdfStream`, `handlePdfInfo`, `handlePdfToc` | PDF 上传、Range 流式、页数/大纲提取。与 EPUB 类似但实现路径不同。 | 中高 |
| **`txt`** | `handleTxtUpload`, `handleTxtRead`, `handleTxtInfo`, 章节切分相关逻辑 | TXT 编码嗅探、章节正则切分、偏移索引、分章读取。 | 中高 |
| **`upload`** | `handleChunkedUploadInit`, `handleChunkedUploadPart`, `handleChunkedUploadComplete`, `handleUploadFile`, `handleDeleteFile`, `handleImportWebdavBook` | 通用分片上传、直传 R2、多文件上传。是 EPUB/PDF/TXT 上传的底座。 | 中高 |
| **`webdav`** | `handleWebdav`, `handleGetWebdavFileList`, `handleGetWebdavFile`, `handleUploadFileToWebdav`, `handleDeleteWebdavFile`, `handleDeleteWebdavFileList`, `handleGetRemoteWebdav`, `handleSaveRemoteWebdav`, `handleTestRemoteWebdav`, `handleSyncRemoteWebdavNow`, `verifyBasicWebdav`, `decryptWebdavPassword` | 自带 WebDAV 服务端、远程 WebDAV 同步配置、Basic Auth。与认证域强相关。 | 中高 |
| **`rss`** | `handleGetRssArticles`, `handleGetRssContent`（以及 `getDocument` 配合 rssSource.json） | RSS 源文章列表、正文抓取。也会走 `legado-engine` 做正文提取。 | 中低 |
| **`ai`** | `handleGetAiBookMemory`, `handleSaveAiBookMemory`, `handleDeleteAiBookMemory`, `handleAiProxy`, `handleAiProxyImage`, `handleGetAiModelConfig`（走 document-json） | AI 伴读、代理请求（转发到 OpenAI 兼容接口或 Workers AI）、图像代理。 | 中低 |
| **`user-admin`** | `handleChangePassword`, `handleGetUserList`, `handleAddUser`, `handleUpdateUser`, `handleDeleteUsers`, `handleResetPassword` | 用户管理、密码修改、重置。多为管理员操作，依赖 `isAuthorizedAdmin`。 | 中低 |
| **`asset`** | `handleGetAsset`, 封面相关逻辑 | 封面获取、`/assets/*` 代理、R2 资源读取。常和 `functions/[[path]].ts` 配合。 | 低 |
| **`utils/http`** | `corsHeaders`, `jsonResponse`, `getAccessToken` | 跨域、统一 JSON 响应、Token 提取。几乎全文件都要用。 | **极高（基础）** |
| **`utils/network`** | `isSafeRemoteUrl`, 抓取相关辅助 | URL 校验（当前实现较简陋）。 | 中低 |
| **`utils/encoding`** | `fetchTextWithEncoding` 及编码相关逻辑 | 网页编码探测/转换。 | 低 |

## 3. 当前耦合点分析

拆分最大障碍在于"基础工具"被全量引用。

| 依赖项 | 被引用范围 | 备注 |
|---|---|---|
| **`Env` 接口** | 几乎所有 `handle*` 和大多数工具函数 | 几乎每个模块都要 `env: Env`。拆分后必须在 `types.ts` 导出并统一引用。 |
| **`corsHeaders()` / `jsonResponse()`** | 几乎全文件 | 每个 `handle*` 都直接调用，且 `jsonResponse` 内部也用 `corsHeaders()`。这两个应该最先抽离。 |
| **`resolveUserNs()`** | 绝大多数需要登录的 `handle*`（>40 处） | 是受保护接口的统一入口。抽离后要保证其能访问 D1（`env.DB`）。 |
| **`getAccessToken()` / `isAuthorizedAdmin()`** | `auth` 域内高频使用，也被部分接口复用 | 属于 `auth` 模块内部实现，抽离到 `auth.ts` 即可。 |
| **`getEnv()`** | 全文件多处（Kitesurf、AI、限流相关配置等） | 简单纯函数，直接抽到 `env.ts` 或 `config.ts` 最省事。 |
| **`legado-engine` 导入** | `book-source`, `content`, `rss` 等域 | 已经是独立模块（`worker/legado-engine.ts`），拆分后只需保留 `import`。 |
| **`crypto` 函数（pbkdf2/aes）** | `auth`, `webdav`, 部分内容处理 | 可抽到 `crypto.ts`，函数间无循环依赖的话很干净。 |
| **`ExecutionContext`** | 很多 `handle*`（保存书源、上传、队列相关） | 透传即可，不影响模块划分。 |

## 4. 推荐目录结构

建议放在 `worker/` 下新建子目录，尽量保持与 Cloudflare Workers 的模块解析兼容（ESM）。

```text
worker/
├── index.ts                # 极薄入口：仅 import router 并导出 default { fetch }（也可保留 queue）
├── router.ts               # 路由表 + dispatch（把原 fetch 里的 if 链迁移到这里）
├── types.ts                # Env、EpubQueueMessage、CentralDirEntry、EpubTocItem 等全局类型
├── env.ts                  # getEnv、ENV_DEFAULTS 相关（或直接 re-export）
├── http.ts                 # corsHeaders、jsonResponse、getAccessToken 等 HTTP 工具
├── auth.ts                 # resolveUserNs、isAuthorizedAdmin、登录/会话、密码哈希
├── crypto.ts               # pbkdf2Hash、genSecurePassword、verifyPassword、AES 加解密
├── db.ts                   # （可选）D1 常用封装，如 getDocument/saveDocument
├── utils.ts                # 其他零散工具（randomString、isSafeRemoteUrl、fetchTextWithEncoding 等）
├── legado.ts               # （可选）re-export legado-engine，统一导入路径
│
├── handlers/               # 按业务域拆分的处理器
│   ├── auth.ts
│   ├── book-source.ts
│   ├── bookshelf.ts
│   ├── content.ts
│   ├── document.ts         # bookmark/replaceRule/bookGroup/rssSource/json_documents
│   ├── epub.ts
│   ├── pdf.ts
│   ├── txt.ts
│   ├── upload.ts           # 分片上传 + 通用上传
│   ├── webdav.ts
│   ├── rss.ts
│   ├── ai.ts
│   ├── user-admin.ts
│   └── asset.ts
│
└── legado-engine.ts        # 保持原样（已经足够独立）
└── md5.ts                  # 保持原样
└── env-defaults.ts         # 保持原样
```

## 5. 拆分详细方案

### 5.1 第一批：基础设施（最无业务耦合，最安全）

| 文件 | 拆出内容 | 说明 |
|---|---|---|
| `types.ts` | `export interface Env`、`export interface EpubQueueMessage`、`interface CentralDirEntry`、`interface EpubTocItem` 等 | 全局类型统一管理。 |
| `http.ts` | `corsHeaders()`, `jsonResponse()`, `getAccessToken()` | 几乎全量引用。 |
| `env.ts` | `getEnv()`、必要的 env 常量访问封装 | 简单纯函数。 |
| `crypto.ts` | `pbkdf2Hash`, `genSecurePassword`, `verifyPassword`, `encryptAes128Cbc`, `decryptAes128Cbc`, `decryptWebdavPassword` | 密码与加密相关，纯函数居多。 |
| `utils.ts` | `randomString`, `isSafeRemoteUrl`, `fetchTextWithEncoding` 等剩余小工具 | 收拢零散的辅助函数。 |

### 5.2 第二批：认证域
| 文件 | 拆出内容 | 说明 |
|---|---|---|
| `auth.ts` | `resolveUserNs()`, `isAuthorizedAdmin()`, `generateSessionToken()` 以及与会话相关逻辑 | 依赖 `getAccessToken`、`env.DB`。 |

### 5.3 第三批：按业务域抽离 handle 函数

| 顺序 | 目标文件 | 拆出范围 | 理由 |
|---|---|---|---|
| **1** | `handlers/document.ts` | `getDocument`, `saveDocument`, `handleGetDocument`, `handleSaveDocumentItem`, `handleSaveDocumentItems`, `handleDeleteDocumentItem`, `handleDeleteDocumentItems` + 书签/替换规则/书籍分组/RSS源的 `handle*` | 结构几乎一模一样，耦合最低。 |
| **2** | `handlers/auth.ts`（业务处理器） | `handleLogin`, `handleLogout`, `handleGetUserInfo` | 与认证工具函数一并迁移。 |
| **3** | `handlers/user-admin.ts` | `handleChangePassword`, `handleGetUserList`, `handleAddUser`, `handleUpdateUser`, `handleDeleteUsers`, `handleResetPassword` | 多数需要管理员权限。 |
| **4** | `handlers/book-source.ts` | 全部书源相关 `handle*` | 功能完整但调用较多（`legado-engine`、`fetch`、D1）。 |
| **5** | `handlers/bookshelf.ts` | 书架相关 `handle*` | 高频接口。 |
| **6** | `handlers/upload.ts` | `handleChunkedUploadInit/Part/Complete`, `handleUploadFile`, `handleDeleteFile`, `handleImportWebdavBook` | 底层上传逻辑。 |
| **7** | `handlers/epub.ts`、`handlers/pdf.ts`、`handlers/txt.ts` | 各自的上传/读取/状态 `handle*` 以及相关私有函数 | 自成体系但代码量很大。 |
| **8** | `handlers/content.ts` | `handleGetBookContent`, `handleGetBookInfo`, `handleGetChapterList` | 逻辑最复杂。 |
| **9** | `handlers/webdav.ts` | 全部 WebDAV 相关 `handle*` + `verifyBasicWebdav` | 与 `auth`、`crypto` 强相关。 |
| **10** | `handlers/rss.ts`、`handlers/ai.ts`、`handlers/asset.ts` | 相对边缘但独立的模块 | 收尾。 |

### 5.4 第四批：路由迁移

把 `fetch` 里的巨型 `if` 链抽到 `router.ts`，`index.ts` 精简为仅导出 `default { fetch }`。

## 6. 导入顺序与循环依赖预防

| 原则 | 说明 |
|---|---|
| **自底向上依赖** | `types` -> `env` -> `http`/`utils` -> `crypto` -> `auth` -> `db` -> `handlers/*` -> `router` -> `index`。 |
| **工具函数无业务依赖** | `http.ts`、`crypto.ts`、`utils.ts` 尽量只依赖 `types`。 |
| **`auth` 只依赖基础** | 不要直接 import 具体 `handlers`。 |
| **按需导入** | `handlers/*` 各自按需 import 所需工具。 |
| **类型优先用 `import type`** | 对纯类型用 `import type` 减少运行时循环风险。 |
| **先抽离再替换** | 每次只搬运一个域，编译通过再继续。 |

## 7. 实施路线（渐进式，最安全）

| 步骤 | 操作 | 验证 |
|---|---|---|
| **Step 0** | git commit 当前状态 | 干净工作树 |
| **Step 1** | 新建 `worker/types.ts`，迁移全局类型，`index.ts` 改用 `import type` | `npx tsc --noEmit` |
| **Step 2** | 新建 `worker/http.ts`，抽离 `corsHeaders`、`jsonResponse`、`getAccessToken` | `npx tsc --noEmit` |
| **Step 3** | 新建 `worker/crypto.ts`、`worker/env.ts`、`worker/utils.ts` | `npx tsc --noEmit` |
| **Step 4** | 新建 `worker/auth.ts`，抽离鉴权逻辑 | `npx tsc --noEmit` |
| **Step 5** | 新建 `handlers/document.ts`，先搬 document-json 相关函数 | `npx tsc --noEmit` + 冒烟 |
| **Step 6-7** | 按域逐步抽离，定期编译 | `npx tsc --noEmit` + `npx wrangler dev` |
| **Step 8** | 新建 `router.ts`，迁移路由链，瘦身 `index.ts` 到极薄入口 | 全量编译 + 部署前检查 |

## 8. 注意事项与风险

| 风险点 | 严重度 | 应对方案 |
|---|---|---|
| **循环依赖** | **高** | 严格单向依赖，可用 `npx madge --circular worker` 辅助排查。 |
| **`this`/上下文丢失** | 中 | 函数均显式传参 `request/env/ctx`，基本无影响。 |
| **类型推断变差** | 中 | 必要时补充显式类型。 |
| **`export` 方式** | 中 | 保留 `export default { fetch }`，确保 `functions/[[path]].ts` 兼容。 |
| **队列 Consumer** | 中低 | 若用 `queue()` 需保留在 `index.ts` 默认导出。 |
| **模块级单例** | 低 | 搬移后仍是模块级，行为基本一致。 |

## 9. 预期收益

- **可读性大幅提升**：每个文件 200-600 行
- **可维护性大幅提升**：域内修改更聚焦
- **协作友好**：减少文件冲突
- **类型收敛**：逐步替换 `any`
- **测试友好**：更易单测
- **性能几乎无影响**

## 10. 最终建议

- **先抽基础，再抽业务，最后抽路由**
- **从 `handlers/document.ts` 开始验证思路**
- **每次只搬一个域，编译通过再继续**
- **保留原函数名，最小改动**
- **理想目标**：`index.ts` 压至 80-120 行

