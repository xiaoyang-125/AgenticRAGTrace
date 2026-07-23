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
}
