import fs from 'fs'
import { nanoid } from 'nanoid'
import { DOCUMENTS_FILE } from '../data/init'

/**
 * 文档元数据结构
 * 对应 data/documents.json 中每一条记录
 */
export interface Document {
  id: string                      // 唯一标识，格式为 doc_ + nanoid
  title: string                   // 展示用标题，取文件名去扩展名
  filename: string                // 原始上传文件名（含扩展名）
  fileSize: number                // 文件大小，单位字节
  plainText: string               // 解析后的纯文本，供 Day3 切分使用
  status: 'pending' | 'indexed'  // 处理状态：pending=待入库，indexed=已完成 embedding 入库
  chunkCount: number              // 该文档切出的 chunk 数量，Day2 写入时固定为 0
  createdAt: string               // 创建时间，ISO 8601 格式
}

/**
 * 用于创建文档时传入的参数，不含系统自动生成的字段
 */
export type CreateDocumentInput = Omit<Document, 'id' | 'createdAt'>

export class DocumentRepository {
  /** 从 JSON 文件读取所有文档 */
  findAll(): Document[] {
    const raw = fs.readFileSync(DOCUMENTS_FILE, 'utf-8')
    return JSON.parse(raw) as Document[]
  }

  /** 根据 id 查找单条文档，不存在返回 undefined */
  findById(id: string): Document | undefined {
    return this.findAll().find((doc) => doc.id === id)
  }

  /** 根据文件名查找文档，用于重复文件名校验 */
  findByFilename(filename: string): Document | undefined {
    return this.findAll().find((doc) => doc.filename === filename)
  }

  /**
   * 保存一条新文档记录
   * 自动生成 id（doc_ 前缀 + nanoid）和 createdAt，写回 JSON 文件
   */
  save(input: CreateDocumentInput): Document {
    const docs = this.findAll()
    const newDoc: Document = {
      ...input,
      id: 'doc_' + nanoid(),
      createdAt: new Date().toISOString(),
    }
    docs.push(newDoc)
    fs.writeFileSync(DOCUMENTS_FILE, JSON.stringify(docs, null, 2), 'utf-8')
    return newDoc
  }

  /**
   * 更新指定文档的部分字段（不允许更改 id / createdAt）
   *
   * 为什么用 Partial<Omit<Document, 'id' | 'createdAt'>>：
   * - id 是主键，改了就找不到记录了
   * - createdAt 是不可变时间戳，不应通过业务逻辑修改
   * - Partial 允许调用方只传需要更新的字段，其余保持不变
   *
   * @param id       目标文档 id
   * @param partial  要合并的字段
   * @returns        更新后的完整文档对象
   * @throws         id 不存在时抛出错误（表明是调用方 bug，不应静默忽略）
   */
  update(
    id: string,
    partial: Partial<Omit<Document, 'id' | 'createdAt'>>,
  ): Document {
    const docs = this.findAll()
    const index = docs.findIndex((d) => d.id === id)
    if (index === -1) {
      throw new Error(`[DocumentRepository] 文档不存在，id: ${id}`)
    }
    const updated: Document = { ...docs[index], ...partial }
    docs[index] = updated
    fs.writeFileSync(DOCUMENTS_FILE, JSON.stringify(docs, null, 2), 'utf-8')
    return updated
  }

  /**
   * 删除指定 id 的文档记录
   *
   * 使用场景：indexing 失败时删除刚创建的 pending 文档，
   * 使用户可以用相同文件名重新上传，不被重复文件名校验阻断。
   *
   * 为什么不用软删除（is_deleted 标记）：
   * - MVP 阶段不需要回收站或审计日志，物理删除更简单。
   * - 文档删除后 chunks.json 中对应的 chunk 也不存在（embedding 失败时不写入）；
   *   不存在孤立外键问题。
   *
   * @param id  目标文档 id（不存在时静默忽略，保证幂等性）
   */
  remove(id: string): void {
    const docs = this.findAll()
    const filtered = docs.filter((d) => d.id !== id)
    // 只有在确实找到并删除时才写文件，避免不必要的 I/O
    if (filtered.length !== docs.length) {
      fs.writeFileSync(DOCUMENTS_FILE, JSON.stringify(filtered, null, 2), 'utf-8')
    }
  }
}
