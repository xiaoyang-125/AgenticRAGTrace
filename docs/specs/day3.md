# Day3 - 文档切块与 Embedding Spec

## 目标

在 `POST /api/documents` 上传流程中，完成已解析纯文本的切块、overlap 拼接、OpenAI embedding 生成与 JSON 持久化。

处理完成后：

- `backend/data/chunks.json` 中写入该文档的所有 chunk；
- 每条 chunk 都包含 `text-embedding-3-small` 生成的 1536 维 embedding；
- `documents.json` 中对应文档的 `status` 更新为 `indexed`，`chunkCount` 更新为实际数量。

**本日不涉及**：检索、相似度计算、问答、重新索引接口、chunk 查询接口、前端展示。

---

## 1. 整体流程

```text
POST /api/documents
        │
        ▼
[1] 上传、校验、文本解析（Day2 已实现）
        │
        ▼
[2] 创建 Document
    status: pending, chunkCount: 0
        │
        ▼
[3] chunkText(plainText)
    段落优先 → 句子兜底 → 固定长度兜底 → 短块合并 → overlap
        │
        ▼
[4] embedChunks(texts)
    OpenAI text-embedding-3-small，按批次生成 1536 维向量
        │
        ▼
[5] ChunkRepository.saveMany()
    写入 chunks.json
        │
        ▼
[6] DocumentRepository.update()
    status: indexed，chunkCount: 实际 chunk 数
        │
        ▼
[7] 返回 201
```

本 MVP 使用同步处理：接口会等待所有 embedding 完成后再返回。考虑到上传限制为 5MB，大文件可能有较长响应时间；不在 Day3 引入任务队列或异步索引。

---

## 2. Chunking 规则

### 2.1 参数

| 参数 | 值 | 说明 |
|---|---:|---|
| `MAX_CHUNK_LEN` | 800 | 最终 chunk 最大长度，包含 overlap |
| `MIN_CHUNK_LEN` | 50 | 优先合并的短正文阈值 |
| `OVERLAP_SIZE` | 100 | 相邻 chunk 共享的最多字符数 |
| `BODY_MAX_LEN` | 700 | 正文最大长度，即 `800 - 100`，为 overlap 预留空间 |

长度使用 JavaScript 的 `text.length` 计算。对普通中英文文本，可近似理解为字符数；Emoji 等 UTF-16 代理对字符可能占用两个长度单位，本 MVP 不做特殊处理。

### 2.2 切分顺序

1. **段落优先**
   - 按连续空行切分段落，过滤空白段落。
   - 依照原有顺序，将短段落累积到正文 chunk，累计长度不超过 `BODY_MAX_LEN`。
   - 合并段落时使用一个换行符作为分隔，保留基本语义边界。

2. **过长段落按句子切分**
   - 段落长度大于 `BODY_MAX_LEN` 时，按中英文句末标点（`。！？.!?`）分句。
   - 句子按顺序累积，超过 `BODY_MAX_LEN` 时开始新的正文 chunk。

3. **超长句按固定长度切分**
   - 单个句子仍大于 `BODY_MAX_LEN` 时，按 `BODY_MAX_LEN` 固定长度硬切。
   - 使用 700 而不是 800 切正文，以保证后续添加 overlap 后最终长度不超过 800。

4. **短正文合并**
   - 对小于 `MIN_CHUNK_LEN` 的短正文，优先尝试与相邻正文合并。
   - 仅在合并后不超过 `BODY_MAX_LEN` 时才合并；否则保留该短正文。
   - 整篇短文档可保留为单个小于 50 的 chunk。

### 2.3 Overlap 规则

正文切分完成后，再生成最终 chunk：

- 第一个 chunk 不带 overlap。
- 从第二个 chunk 起，取前一个**正文**的末尾最多 100 个字符，拼接到当前正文之前。
- overlap 必须从前一个正文提取，不能从已拼接 overlap 的最终 chunk 提取，避免重复内容向后递归扩散。
- 最终 chunk 长度必须不超过 `MAX_CHUNK_LEN`（800）。

示意：

```text
正文 1: [A...B]
正文 2: [C...D]

最终 chunk 1: [A...B]
最终 chunk 2: [B 的末尾最多 100 字符][C...D]
```

### 2.4 服务接口

新增 `backend/src/services/chunker.ts`：

```ts
export function chunkText(text: string): string[]
```

- 空白文本返回 `[]`。
- 返回值为已完成 overlap 拼接后的文本数组。
- 调用方负责补充 `documentId` 与从 0 开始的 `index`。

---

## 3. Embedding 生成

### 3.1 模型与输出

- SDK：`openai`
- 模型：`text-embedding-3-small`
- API Key：`OPENAI_API_KEY`
- 不指定 `dimensions`，使用默认输出，预期每个 embedding 长度为 **1536**。

新增 `backend/src/services/embedder.ts`：

```ts
export async function embedChunks(texts: string[]): Promise<number[][]>
```

### 3.2 批处理与校验

- 输入按固定安全批次请求 OpenAI（建议每批最多 100 个 chunk）。
- 批次串行执行，按照输入顺序组合返回结果。
- 每批返回的向量数量必须等于该批输入数量。
- 每条向量长度必须为 1536，否则视为 embedding 失败。
- 任意批次失败即整体失败；在 embedding 全部成功之前，不得写入 `chunks.json`。

### 3.3 环境变量

项目根目录新增 `.env.example`：

```bash
OPENAI_API_KEY=sk-xxx
```

后端入口最早位置加载根目录 `.env`。真实 `.env` 必须被 `.gitignore` 忽略，禁止提交密钥。

需新增依赖：

```bash
cd backend && pnpm add openai dotenv
```

README 补充：复制 `.env.example` 为 `.env` 后填入有效的 OpenAI API Key。

---

## 4. 数据持久化

### 4.1 Chunk 数据结构

现有 `Chunk` 结构直接复用：

```ts
interface Chunk {
  id: string
  documentId: string
  content: string
  index: number
  embedding: number[] | null
  createdAt: string
}
```

Day3 写入的 `embedding` 必须为实际生成的 1536 维数组，不允许为 `null`。

`ChunkRepository.saveMany()` 接收全部已生成 embedding 的 chunk，一次写入 `backend/data/chunks.json`。

### 4.2 Document 更新能力

在 `backend/src/repositories/DocumentRepository.ts` 增加：

```ts
update(
  id: string,
  partial: Partial<Omit<Document, 'id' | 'createdAt'>>,
): Document

remove(id: string): void
```

- `update`：用于将文档改为 `indexed` 并更新 `chunkCount`。
- `remove`：用于索引失败时删除本次刚创建的 pending 文档，使用户可直接重新上传同名文件。

成功后的 `documents.json` 状态：

```json
{
  "status": "indexed",
  "chunkCount": 3
}
```

---

## 5. 路由改造

修改 `backend/src/routes/documents.ts`，保留 Day2 已实现的上传、校验与解析逻辑。

在 `DocumentRepository.save()` 后执行：

```ts
const texts = chunkText(plainText)
const embeddings = await embedChunks(texts)

chunkRepo.saveMany(
  texts.map((content, index) => ({
    documentId: doc.id,
    content,
    index,
    embedding: embeddings[index],
  })),
)

docRepo.update(doc.id, {
  status: 'indexed',
  chunkCount: texts.length,
})
```

成功响应保持 Day2 格式，`chunkCount` 返回真实数量。

---

## 6. 失败语义

| 场景 | HTTP 状态码 | error | 持久化结果 |
|---|---:|---|---|
| 未配置 API Key | 502 | `EMBEDDING_FAILED` | 删除本次新建 document，不写 chunk |
| OpenAI API 请求失败 | 502 | `EMBEDDING_FAILED` | 删除本次新建 document，不写 chunk |
| OpenAI 返回向量数量或维度异常 | 502 | `EMBEDDING_FAILED` | 删除本次新建 document，不写 chunk |
| 切块结果为空 | 500 | `INDEXING_FAILED` | 删除本次新建 document，不写 chunk |
| 本地未知处理异常 | 500 | `INDEXING_FAILED` | 删除本次新建 document；不返回内部错误详情 |

本 MVP 的已知限制：JSON 文件存储没有事务。如果 `saveMany()` 成功但后续 `DocumentRepository.update()` 写入异常，可能产生 chunk 已存在但 document 仍为 pending 的极少数不一致情况；Day3 不引入数据库或补偿机制。

---

## 7. 文件变更

```text
backend/
├── src/
│   ├── repositories/
│   │   └── DocumentRepository.ts   # 新增 update、remove
│   ├── routes/
│   │   └── documents.ts            # 接入切块、embedding 与持久化
│   ├── services/
│   │   ├── chunker.ts              # 新增
│   │   ├── chunker.test.ts         # 新增
│   │   └── embedder.ts             # 新增
│   └── index.ts                    # 加载 dotenv
├── package.json                     # 新增 openai、dotenv 及测试依赖/脚本
.env.example                         # 新增
README.md                            # 新增环境变量说明
docs/specs/day3.md                  # 本文档
```

---

## 8. 验证标准

### 8.1 chunker 单元测试

1. 多个短段落按段落优先合并。
2. 超长段落按句子边界切分。
3. 超长单句按固定长度切分。
4. 每个最终 chunk 长度不超过 800。
5. 每个非首 chunk 的前缀等于前一个正文的末尾最多 100 个字符。
6. 无法合并的短尾 chunk 会被保留，不突破长度限制。
7. 空白文本返回空数组。

### 8.2 手动集成验证

上传含多个长段落的 `.txt` 或 `.md`：

1. 接口返回 201，且 `chunkCount > 0`。
2. `documents.json` 中对应记录为 `status: "indexed"`，且 `chunkCount` 与响应一致。
3. `chunks.json` 中存在该 `documentId` 的 chunk，`index` 从 0 连续递增。
4. 每条 chunk 的 `content` 长度不超过 800。
5. 每条 chunk 的 `embedding` 为数组，且 `embedding.length === 1536`。
6. 故意配置无效 API Key 后上传，接口返回 `502 EMBEDDING_FAILED`，且 `documents.json`、`chunks.json` 中均不留下本次文档数据。
