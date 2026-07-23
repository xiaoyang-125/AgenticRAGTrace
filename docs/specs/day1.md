# Day1 - 项目初始化与数据骨架

## 目标

完成 Monorepo 初始化、健康检查接口（GET /health）可访问、data 目录 JSON 初始化可运行、DocumentRepository / ChunkRepository 基础结构建立。

---

## 1. 目录结构

```
AgenticRAGTrace/
├── docs/plans/               # 每日 Plan 文档
├── package.json              # pnpm workspace 根配置
├── pnpm-workspace.yaml       # workspace 声明
├── frontend/                 # React + TS + Vite + Tailwind
│   ├── package.json
│   ├── vite.config.ts
│   ├── tsconfig.json
│   ├── index.html
│   └── src/
│       ├── main.tsx
│       └── App.tsx           # 空壳页面，仅展示标题
└── backend/                  # Express + TS
    ├── package.json
    ├── tsconfig.json
    ├── src/
    │   ├── index.ts          # 入口，启动 Express
    │   ├── routes/
    │   │   └── health.ts     # GET /health
    │   ├── data/
    │   │   └── init.ts       # 初始化 data 目录和空 JSON 文件
    │   └── repositories/
    │       ├── DocumentRepository.ts
    │       └── ChunkRepository.ts
    └── data/                 # 运行时生成，不入 git
        ├── documents.json
        └── chunks.json
```

---

## 2. 数据结构

### Document（存于 documents.json）

```ts
interface Document {
  id: string;                        // 唯一标识，使用 nanoid 生成
  title: string;                     // 展示用标题，取文件名去扩展名
  filename: string;                  // 原始上传文件名（含扩展名）
  fileSize: number;                  // 文件大小，单位字节
  status: 'pending' | 'indexed';     // 处理状态：pending=待入库，indexed=已完成 embedding 入库
  createdAt: string;                 // 创建时间，ISO 8601 格式
  chunkCount: number;                // 该文档切出的 chunk 数量，入库前初始为 0
}
```

### Chunk（存于 chunks.json）

```ts
interface Chunk {
  id: string;                  // 唯一标识，使用 nanoid 生成
  documentId: string;          // 所属文档的 id，外键关联 Document.id
  content: string;             // 该 chunk 的文本内容
  index: number;               // 在文档内的顺序编号，从 0 开始
  embedding: number[] | null;  // 向量数组，Day1 初始为 null，Day3 生成 embedding 后填入
  createdAt: string;           // 创建时间，ISO 8601 格式
}
```

---

## 3. 后端实现要点

### 3.1 入口 `src/index.ts`
- 创建 Express app
- 注册 `/health` 路由
- 启动时调用 `initData()` 确保 data 目录和 JSON 文件存在
- 监听 3001 端口

### 3.2 健康检查 `src/routes/health.ts`
```
GET /health → 200 { status: 'ok', timestamp: ISOString }
```

### 3.3 初始化逻辑 `src/data/init.ts`
- 检查 `backend/data/` 目录是否存在，不存在则 `mkdir`
- 检查 `documents.json` 是否存在，不存在则写入 `[]`
- 检查 `chunks.json` 是否存在，不存在则写入 `[]`

### 3.4 DocumentRepository `src/repositories/DocumentRepository.ts`
只建结构，提供方法签名 + 基础实现：
- `findAll(): Document[]`
- `findById(id): Document | undefined`
- `save(doc): Document`（写入 JSON 文件）

### 3.5 ChunkRepository `src/repositories/ChunkRepository.ts`
只建结构，提供方法签名 + 基础实现：
- `findAll(): Chunk[]`
- `findByDocumentId(docId): Chunk[]`
- `saveMany(chunks): Chunk[]`

---

## 4. 前端实现要点

- Vite + React + TypeScript 脚手架
- 安装 Tailwind CSS v3 并配置
- `App.tsx` 渲染一个居中标题 `Agentic RAG Demo` 即可，不做多余 UI

---

## 5. 执行步骤

1. 在仓库创建 `docs/plans/day1.md`（本文件）
2. 根目录写 `pnpm-workspace.yaml` + 根 `package.json`
3. 初始化 `frontend/`（pnpm create vite，配置 Tailwind）
4. 初始化 `backend/`（手动创建 package.json，安装 express / tsx / typescript）
5. 编写后端源码：index.ts → health.ts → init.ts → repositories
6. 本地验证：`pnpm --filter backend dev` 启动后访问 `GET http://localhost:3001/health`

---

## 6. 验证标准

- `GET http://localhost:3001/health` 返回 `{ status: 'ok', timestamp: "..." }`
- 首次启动后 `backend/data/documents.json` 和 `backend/data/chunks.json` 自动生成
- `frontend/` 可通过 `pnpm --filter frontend dev` 正常启动，浏览器显示标题
