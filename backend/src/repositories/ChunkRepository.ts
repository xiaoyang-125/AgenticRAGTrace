import fs from 'fs'
import { nanoid } from 'nanoid'
import { CHUNKS_FILE } from '../data/init'

/**
 * 文档分块结构
 * 对应 data/chunks.json 中每一条记录
 */
export interface Chunk {
  id: string                    // 唯一标识，使用 nanoid 生成
  documentId: string            // 所属文档的 id，外键关联 Document.id
  content: string               // 该 chunk 的文本内容
  index: number                 // 在文档内的顺序编号，从 0 开始
  embedding: number[] | null    // 向量数组，Day1 初始为 null，Day3 生成 embedding 后填入
  createdAt: string             // 创建时间，ISO 8601 格式
}

/**
 * 用于批量创建 chunk 时传入的参数，不含系统自动生成的字段
 */
export type CreateChunkInput = Omit<Chunk, 'id' | 'createdAt'>

export class ChunkRepository {
  /** 从 JSON 文件读取所有 chunk */
  findAll(): Chunk[] {
    const raw = fs.readFileSync(CHUNKS_FILE, 'utf-8')
    return JSON.parse(raw) as Chunk[]
  }

  /** 根据 documentId 查找该文档下所有 chunk，按 index 排序 */
  findByDocumentId(documentId: string): Chunk[] {
    return this.findAll()
      .filter((chunk) => chunk.documentId === documentId)
      .sort((a, b) => a.index - b.index)
  }

  /**
   * 批量保存多条 chunk 记录
   * 自动为每条 chunk 生成 id 和 createdAt，写回 JSON 文件
   */
  saveMany(inputs: CreateChunkInput[]): Chunk[] {
    const chunks = this.findAll()
    const now = new Date().toISOString()
    const newChunks: Chunk[] = inputs.map((input) => ({
      ...input,
      id: nanoid(),
      createdAt: now,
    }))
    chunks.push(...newChunks)
    fs.writeFileSync(CHUNKS_FILE, JSON.stringify(chunks, null, 2), 'utf-8')
    return newChunks
  }
}
