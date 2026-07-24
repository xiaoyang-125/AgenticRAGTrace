import path from 'path'
import { Router, Request, Response, NextFunction } from 'express'
import multer from 'multer'
import { DocumentRepository } from '../repositories/DocumentRepository'
import { ChunkRepository } from '../repositories/ChunkRepository'
import { parseMarkdown, parseTxt } from '../services/parser'
import { chunkText } from '../services/chunker'
import { embedChunks } from '../services/embedder'

const router = Router()

// ─── Multer 配置 ───────────────────────────────────────────────────────────────
// memoryStorage：文件内容以 Buffer 形式存入 req.file.buffer，不写磁盘。
// limits.fileSize：在流传输阶段就截断超大文件，早于任何业务逻辑执行。
// fileFilter：按扩展名过滤，只接收 .md / .txt。
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase()
    if (['.md', '.txt'].includes(ext)) {
      cb(null, true)
    } else {
      // 传入 Error 会让 multer 中止上传并把错误传给下面的错误中间件
      cb(new Error('FILE_TYPE_UNSUPPORTED'))
    }
  },
})

// ─── POST /api/documents ──────────────────────────────────────────────────────
router.post(
  '/',
  upload.single('file'), // 期望 multipart/form-data 中字段名为 file 的单文件
  async (req: Request, res: Response) => {
    // ── 阶段一：输入校验（Day2 已有） ────────────────────────────────────────

    // 1. 文件存在性检查
    if (!req.file) {
      return res.status(400).json({ error: 'NO_FILE' })
    }

    // 2. Buffer → 字符串（UTF-8 解码）
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
    const plainText =
      ext === '.md' ? await parseMarkdown(rawText) : parseTxt(rawText)

    // 6. 写入 documents.json（status: pending，chunkCount: 0）
    //    先保存再切块/embedding，这样文档主记录一定存在，
    //    失败时用 docRepo.remove 清理掉，让用户可以重新上传同名文件
    const doc = docRepo.save({
      title: path.basename(req.file.originalname, ext),
      filename: req.file.originalname,
      fileSize: req.file.size,
      plainText,
      status: 'pending',
      chunkCount: 0,
    })

    // ── 阶段二：切块 + embedding + 持久化 ──────────────────────────────────
    //
    // 为什么把切块和 embedding 包在同一个 try/catch：
    // - 任意环节失败都应执行同一个清理动作（删除刚创建的 doc）
    // - 两段代码的失败语义相同，合并处理更简洁，不容易遗漏 remove 调用
    //
    // 为什么不直接在步骤 6 之前做切块：
    // - 先写 doc 记录，拿到真实 doc.id，chunkRepo.saveMany 需要这个 id
    // - 如果切块在保存 doc 之前就失败，则不需要 remove，代价更低；
    //   但切块是纯本地逻辑，几乎不会失败；embedding 才是高失败概率的外部调用。
    //   整体选择"先本地+保存，再外部调用，失败则清理"是最常见的 saga 模式简化版。

    try {
      // 7. 切块
      const texts = chunkText(plainText)

      // 空数组说明 plainText 经解析后为空（极罕见），按本地异常处理
      if (texts.length === 0) {
        throw new Error('CHUNK_EMPTY')
      }

      // 8. 生成 embedding（可能抛出 OpenAI 相关错误）
      const embeddings = await embedChunks(texts)

      // 9. 批量写入 chunks.json
      //    saveMany 在 embedChunks 全部成功后才调用，
      //    所以不会出现"部分 chunk 有 embedding、部分为 null"的中间状态
      const chunkRepo = new ChunkRepository()
      chunkRepo.saveMany(
        texts.map((content, index) => ({
          documentId: doc.id,
          content,
          index,
          embedding: embeddings[index],
        })),
      )

      // 10. 更新文档状态和 chunkCount
      const updated = docRepo.update(doc.id, {
        status: 'indexed',
        chunkCount: texts.length,
      })

      // 11. 返回 201，chunkCount 用更新后的真实值
      return res.status(201).json({
        id: updated.id,
        title: updated.title,
        fileName: updated.filename,
        fileSize: updated.fileSize,
        chunkCount: updated.chunkCount,
        createdAt: updated.createdAt,
      })
    } catch (err) {
      // ── 失败清理 ─────────────────────────────────────────────────────────
      // 目的：让用户可以用同名文件重新上传，不被重复文件名校验阻断
      // 为什么此处可以安全调用 remove：
      // - saveMany 在 embedChunks 全部成功后才被调用；
      //   若 embedChunks 失败则 saveMany 根本没执行，chunks.json 里没有残留
      // - 若 saveMany 成功但 update 失败（极罕见的 JSON 写入异常），
      //   则 chunks.json 里存在孤立 chunk，但 remove 之后 doc 也不存在，
      //   前端查询时这些 chunk 对用户不可见；这是 MVP 的已知限制
      try {
        docRepo.remove(doc.id)
      } catch (removeErr) {
        // remove 失败不影响主错误响应，只记录日志
        console.error('[documents] 清理文档失败:', removeErr)
      }

      // 区分 OpenAI 相关错误和本地错误
      const message = err instanceof Error ? err.message : String(err)
      const isEmbeddingError =
        message.includes('OPENAI_API_KEY') || // 未配置密钥
        message.includes('OpenAI API') ||      // API 请求失败（网络/4xx/5xx）
        message.includes('embedding 维度') ||   // 维度校验失败
        message.includes('向量数量')            // 数量校验失败

      if (isEmbeddingError) {
        console.error('[documents] embedding 失败:', message)
        return res.status(502).json({ error: 'EMBEDDING_FAILED' })
      }

      console.error('[documents] indexing 失败:', message)
      return res.status(500).json({ error: 'INDEXING_FAILED' })
    }
  },
)

// ─── 错误中间件（必须放在路由之后，且参数必须是四个）────────────────────────────
// multer 的流阶段错误（超大文件、不支持类型）不会进入上面的处理函数，
// 需要单独的四参数中间件捕获，否则会走 Express 默认 500。
router.use(
  (err: Error, _req: Request, res: Response, _next: NextFunction) => {
    if (err.message === 'FILE_TYPE_UNSUPPORTED') {
      return res.status(415).json({ error: 'FILE_TYPE_UNSUPPORTED' })
    }
    if (
      err instanceof multer.MulterError &&
      err.code === 'LIMIT_FILE_SIZE'
    ) {
      return res.status(413).json({ error: 'FILE_TOO_LARGE' })
    }
    console.error('[documents] unexpected error:', err)
    return res.status(500).json({ error: 'INTERNAL_ERROR' })
  },
)

export default router
