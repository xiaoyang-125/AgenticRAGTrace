import fs from 'fs'
import path from 'path'

// data 目录路径，位于 backend/data/（相对于项目根）
const DATA_DIR = path.resolve(__dirname, '../../data')
const DOCUMENTS_FILE = path.join(DATA_DIR, 'documents.json')
const CHUNKS_FILE = path.join(DATA_DIR, 'chunks.json')

/**
 * 初始化 data 目录和 JSON 文件
 * - 目录不存在时自动创建
 * - JSON 文件不存在时写入空数组，避免后续读取报错
 */
export function initData(): void {
  // 确保 data 目录存在
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true })
    console.log('[init] 创建 data 目录:', DATA_DIR)
  }

  // 确保 documents.json 存在
  if (!fs.existsSync(DOCUMENTS_FILE)) {
    fs.writeFileSync(DOCUMENTS_FILE, JSON.stringify([], null, 2), 'utf-8')
    console.log('[init] 创建 documents.json')
  }

  // 确保 chunks.json 存在
  if (!fs.existsSync(CHUNKS_FILE)) {
    fs.writeFileSync(CHUNKS_FILE, JSON.stringify([], null, 2), 'utf-8')
    console.log('[init] 创建 chunks.json')
  }

  console.log('[init] data 目录初始化完成')
}

// 导出路径常量，供 Repository 使用
export { DATA_DIR, DOCUMENTS_FILE, CHUNKS_FILE }
