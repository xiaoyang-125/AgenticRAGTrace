import fs from 'fs'
import { nanoid } from 'nanoid'
import { DOCUMENTS_FILE } from '../data/init'

/**
 * 文档元数据结构
 * 对应 data/documents.json 中每一条记录
 */
export interface Document {
  id: string                      // 唯一标识，使用 nanoid 生成
  title: string                   // 展示用标题，取文件名去扩展名
  filename: string                // 原始上传文件名（含扩展名）
  fileSize: number                // 文件大小，单位字节
  status: 'pending' | 'indexed'  // 处理状态：pending=待入库，indexed=已完成 embedding 入库
  createdAt: string               // 创建时间，ISO 8601 格式
  chunkCount: number              // 该文档切出的 chunk 数量，入库前初始为 0
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

  /**
   * 保存一条新文档记录
   * 自动生成 id 和 createdAt，写回 JSON 文件
   */
  save(input: CreateDocumentInput): Document {
    const docs = this.findAll()
    const newDoc: Document = {
      ...input,
      id: nanoid(),
      createdAt: new Date().toISOString(),
    }
    docs.push(newDoc)
    fs.writeFileSync(DOCUMENTS_FILE, JSON.stringify(docs, null, 2), 'utf-8')
    return newDoc
  }
}
