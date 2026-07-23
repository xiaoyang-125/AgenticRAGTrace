import path from 'path'
import { Router, Request, Response, NextFunction } from 'express'
import multer from 'multer'
import { DocumentRepository } from '../repositories/DocumentRepository'
import { parseMarkdown, parseTxt } from '../services/parser'

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
    // 1. 文件存在性检查
    //    multer 在 fileFilter 拒绝或请求中根本没有 file 字段时，req.file 为 undefined
    if (!req.file) {
      return res.status(400).json({ error: 'NO_FILE' })
    }

    // 2. Buffer → 字符串（UTF-8 解码）
    //    multer memoryStorage 把原始字节存为 Node.js Buffer（二进制序列）。
    //    .toString('utf-8') 按 UTF-8 编码规则把字节序列解释为 JavaScript 字符串，
    //    才能进行后续的文本校验和解析。
    const rawText = req.file.buffer.toString('utf-8')

    // 3. 内容非空校验
    //    .trim() 去掉首尾空白后，若字符串为空则认为文件无实质内容
    if (!rawText.trim()) {
      return res.status(400).json({ error: 'EMPTY_FILE' })
    }

    // 4. 重复文件名校验
    //    按原始文件名在已有文档中查找，存在则拒绝上传
    const docRepo = new DocumentRepository()
    if (docRepo.findByFilename(req.file.originalname)) {
      return res.status(409).json({ error: 'DUPLICATE_FILENAME' })
    }

    // 5. 解析为纯文本
    //    根据扩展名选择对应的解析函数：
    //    .md → parseMarkdown（AST 级剥离标记）
    //    .txt → parseTxt（换行符规范化 + BOM 去除）
    const ext = path.extname(req.file.originalname).toLowerCase()
    const plainText =
      ext === '.md' ? await parseMarkdown(rawText) : parseTxt(rawText)

    // 6. 写入 documents.json
    //    chunkCount 今日固定为 0，Day3 切分完成后更新
    const doc = docRepo.save({
      title: path.basename(req.file.originalname, ext),
      filename: req.file.originalname,
      fileSize: req.file.size,
      plainText,
      status: 'pending',
      chunkCount: 0,
    })

    // 7. 返回 201
    //    响应体不包含 plainText，避免大文本在响应中传输
    return res.status(201).json({
      id: doc.id,
      title: doc.title,
      fileName: doc.filename,
      fileSize: doc.fileSize,
      chunkCount: doc.chunkCount,
      createdAt: doc.createdAt,
    })
  }
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
  }
)

export default router
