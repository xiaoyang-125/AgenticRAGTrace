# Day2 - 文档上传与文本解析 Spec

## 目标

POST /api/documents 接口可用：接收文件 → 校验 → 解析为纯文本 → 将文档元信息写入 documents.json。

**本日不涉及**：chunk 切分、embedding 生成、chunks.json 写入（均为 Day3 任务）。

---

## 1. 整体流程

```
POST /api/documents
        │
        ▼
  [1] Multer 接收文件（内存模式）
        │   ① 文件大小 ≤ 5MB
        │   ② 文件类型：.md / .txt
        ▼
  [2] 校验层
        │   ③ 内容不为空
        │   ④ 重复文件名检测
        ▼
  [3] 解析层（Parser）
        │   Markdown → strip-markdown → 纯文本
        │   TXT → 换行符统一 + BOM 去除 + 首尾空白
        ▼
  [4] 写入层
        │   DocumentRepository.save()
        │   plainText 字段存入 documents.json（供 Day3 切分使用）
        ▼
  [5] 返回 201 响应
```

**设计考虑**：今天的终点是把解析好的纯文本持久化到 documents.json，让 Day3 可以直接读取已解析内容进行切分，无需重新解析。因此 Document 数据结构需要增加 `plainText` 字段。

---

## 2. 数据结构变更

Day1 建立的 `Document` 接口需新增一个字段：

```ts
interface Document {
  id: string
  title: string
  filename: string
  fileSize: number
  plainText: string               // ← 新增：解析后的纯文本，供 Day3 切分使用
  status: 'pending' | 'indexed'
  chunkCount: number              // 今日上传时固定为 0，Day3 切分完成后更新
  createdAt: string
}
```

**为什么把 plainText 存进 documents.json**：Day3 切分时需要文本内容，若不持久化则每次需要重新拿原始文件再解析，但原始文件没有保存（内存模式）。存入 JSON 是最直接的方式，不引入额外存储依赖。

**chunkCount 今日为 0**：Day3 切分完成后，DocumentRepository 需提供 `updateChunkCount(id, count)` 方法更新该字段，今日不实现该方法，仅预留字段。

---

## 3. 新增依赖

| 包 | 用途 | 选型理由 |
|---|---|---|
| `multer` + `@types/multer` | HTTP multipart 文件上传 | Express 生态事实标准，支持 `memoryStorage`，文件以 `Buffer` 直接可用，无需临时写磁盘 |
| `remark` + `strip-markdown` | Markdown → 纯文本 | remark 官方生态插件，AST 级别处理，能正确处理 frontmatter / 嵌套语法 / 链接文本，比正则可靠 |
| `remark-frontmatter` | 剥离 YAML/TOML frontmatter | 与 remark 同生态，无额外学习成本 |

**为什么用 memoryStorage**：文件上传后只做文本解析，不保留原始文件，内存模式避免临时文件清理逻辑。5MB 上限使内存压力可控。

---

## 4. 新增文件结构

```
backend/src/
├── routes/
│   ├── health.ts           （已有，不改）
│   └── documents.ts        ← 新增，POST /api/documents 路由
├── services/
│   └── parser.ts           ← 新增，文本解析服务
└── index.ts                （已有，注册新路由）
```

**设计考虑**：routes 只做 HTTP 层（接收、校验、响应格式），解析逻辑下沉到 services/parser.ts，保持单一职责。Day3 的 chunker.ts 也会放在 services/ 下，目录结构一致。

---

## 5. 路由层：`src/routes/documents.ts`

### 5.1 Multer 配置

```ts
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },  // 5MB
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase()
    if (['.md', '.txt'].includes(ext)) {
      cb(null, true)
    } else {
      cb(new Error('FILE_TYPE_UNSUPPORTED'))
    }
  },
})
```

**设计考虑**：
- `limits.fileSize` 在流传输阶段截断，早于业务逻辑执行，节省解析 CPU。
- `fileFilter` 用扩展名而非 MIME 判断：浏览器对 .md 的 MIME 上报不稳定（可能是 `text/plain` 或 `application/octet-stream`），扩展名更可靠。

### 5.2 请求处理

```ts
router.post('/', upload.single('file'), async (req, res) => {
  // 1. 文件存在性检查
  if (!req.file) {
    return res.status(400).json({ error: 'NO_FILE' })
  }

  // 2. UTF-8 解码
  const rawText = req.file.buffer.toString('utf-8')

  // 3. 内容非空校验
  if (!rawText.trim()) {
    return res.status(400).json({ error: 'EMPTY_FILE' })
  }

  // 4. 重复文件名校验
  const docRepo = new DocumentRepository()
  if (docRepo.findByFilename(req.file.originalname)) {
    return res.status(409).json({ error: 'DUPLICATE_FILENAME' })
  }

  // 5. 解析为纯文本
  const ext = path.extname(req.file.originalname).toLowerCase()
  const plainText = ext === '.md'
    ? await parseMarkdown(rawText)
    : parseTxt(rawText)

  // 6. 保存文档元数据（含解析后的纯文本）
  const doc = docRepo.save({
    title: path.basename(req.file.originalname, ext),
    filename: req.file.originalname,
    fileSize: req.file.size,
    plainText,
    status: 'pending',
    chunkCount: 0,
  })

  // 7. 返回
  return res.status(201).json({
    id: doc.id,
    title: doc.title,
    fileName: doc.filename,
    fileSize: doc.fileSize,
    chunkCount: doc.chunkCount,
    createdAt: doc.createdAt,
  })
})
```

**注意**：响应体中不返回 `plainText`，避免大文本在响应中传输；plainText 仅作为内部存储字段。

### 5.3 Multer 错误拦截（路由级中间件）

```ts
router.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  if (err.message === 'FILE_TYPE_UNSUPPORTED') {
    return res.status(415).json({ error: 'FILE_TYPE_UNSUPPORTED' })
  }
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'FILE_TOO_LARGE' })
  }
  return res.status(500).json({ error: 'INTERNAL_ERROR' })
})
```

**设计考虑**：Multer 的超大文件错误在流传输阶段抛出，不会进入业务处理函数，需要单独的错误中间件捕获；不加这个中间件会走 Express 默认的 500 响应，丢失语义。

---

## 6. 解析层：`src/services/parser.ts`

### 6.1 Markdown 解析

```ts
import { remark } from 'remark'
import remarkFrontmatter from 'remark-frontmatter'
import stripMarkdown from 'strip-markdown'

export async function parseMarkdown(raw: string): Promise<string> {
  const file = await remark()
    .use(remarkFrontmatter, ['yaml', 'toml'])  // 剥离 YAML/TOML frontmatter
    .use(stripMarkdown)                         // 去除 MD 标记，保留文字
    .process(raw)

  return String(file)
    .replace(/\n{3,}/g, '\n\n')  // 合并连续空行
    .trim()
}
```

**strip-markdown 保留哪些内容**：
- 标题文字：`## 安装` → `安装`
- 链接文字：`[点击这里](url)` → `点击这里`（URL 丢弃，RAG 检索不需要 URL）
- 代码块内容（作为纯文本保留）
- 图片 alt 文字

**为什么不用正则**：YAML frontmatter 可能含多行复杂内容，嵌套 Markdown（行内代码内的 `*`）正则难以无歧义处理，AST 解析器更可靠。

### 6.2 TXT 处理

```ts
export function parseTxt(raw: string): string {
  return raw
    .replace(/^\uFEFF/, '')   // 去除 UTF-8 BOM（Windows 记事本常见）
    .replace(/\r\n/g, '\n')   // CRLF → LF
    .replace(/\r/g, '\n')     // 旧 Mac CR → LF
    .trim()
}
```

**设计考虑**：TXT 只做格式规范化，不做语义处理。BOM 不去除会导致首行第一个字符异常，影响后续 Day3 的切分和 embedding。

---

## 7. Repository 层变更：`src/repositories/DocumentRepository.ts`

### 7.1 新增 `findByFilename` 方法

```ts
findByFilename(filename: string): Document | undefined {
  return this.findAll().find(d => d.filename === filename)
}
```

**设计考虑**：重复文件名校验封装进 Repository，而不是在路由里直接 `.find()`，保持层次清晰；后续若换数据库，只需改 Repository 层。

### 7.2 id 格式改为 `doc_` 前缀

```ts
id: 'doc_' + nanoid()  // 由纯 nanoid 改为带前缀，匹配返回结构要求
```

### 7.3 `CreateDocumentInput` 新增 `plainText` 字段

```ts
export type CreateDocumentInput = Omit<Document, 'id' | 'createdAt'>
// Document 接口本身加了 plainText 字段后，CreateDocumentInput 自动包含
```

---

## 8. 入口层变更：`src/index.ts`

```ts
import documentsRouter from './routes/documents'

app.use('/api/documents', documentsRouter)
```

**设计考虑**：`/api/` 前缀统一标识业务接口，与 `/health` 等基础设施接口分开，方便前端 Vite proxy 配置统一拦截。

---

## 9. 错误码一览

| HTTP 状态码 | error 字段 | 触发场景 |
|---|---|---|
| 400 | `NO_FILE` | 请求中没有 file 字段 |
| 400 | `EMPTY_FILE` | 文件内容为空或全空白 |
| 409 | `DUPLICATE_FILENAME` | 同名文件已存在 |
| 413 | `FILE_TOO_LARGE` | 文件超过 5MB |
| 415 | `FILE_TYPE_UNSUPPORTED` | 不是 .md / .txt |
| 500 | `INTERNAL_ERROR` | 解析/写入异常 |

---

## 10. documents.json 数据示例

```json
[
  {
    "id": "doc_V1StGXR8",
    "title": "React-Hooks",
    "filename": "React-Hooks.md",
    "fileSize": 10240,
    "plainText": "React Hooks 是 React 16.8 新增的特性，允许在函数组件中使用 state...",
    "status": "pending",
    "chunkCount": 0,
    "createdAt": "2026-07-22T10:00:00.000Z"
  }
]
```

---

## 11. 验证标准

1. `POST /api/documents` 上传 .md 文件 → 返回 201 + 正确 JSON 结构
2. `POST /api/documents` 上传 .txt 文件 → 同上
3. 上传后 `documents.json` 中有对应记录，`plainText` 字段为解析后纯文本，`chunkCount: 0`
4. Markdown 文件的 YAML frontmatter 被剥离，标题/链接文字被保留
5. TXT 文件 BOM / CRLF 被规范化
6. 重复上传同名文件 → 返回 409 `DUPLICATE_FILENAME`
7. 上传超过 5MB 文件 → 返回 413 `FILE_TOO_LARGE`
8. 上传 .pdf 等非支持类型 → 返回 415 `FILE_TYPE_UNSUPPORTED`
9. 上传空文件 → 返回 400 `EMPTY_FILE`

---

## 12. 本日范围外（Day3 实现）

- chunk 切分（含 overlap 逻辑）
- chunks.json 写入
- embedding 生成与持久化
- DocumentRepository.updateChunkCount() 方法
