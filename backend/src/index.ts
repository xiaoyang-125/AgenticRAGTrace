// dotenv 必须在所有其他 import 之前加载，
// 否则 embedder.ts 在模块初始化时读取 process.env.OPENAI_API_KEY 可能为 undefined。
// 使用 'dotenv/config' side-effect import（等价于 require('dotenv').config()），
// 它会查找当前工作目录（即启动 `pnpm dev` 的目录）下的 .env 文件。
// 启动命令从 AgenticRAGTrace/ 根目录执行，.env 放在根目录即可被正确读取。
import 'dotenv/config'

import express from 'express'
import { initData } from './data/init'
import healthRouter from './routes/health'
import documentsRouter from './routes/documents'

const app = express()
const PORT = 3001

// 解析 JSON 请求体
app.use(express.json())

// 注册路由
app.use('/health', healthRouter)
app.use('/api/documents', documentsRouter)

// 启动时初始化 data 目录和 JSON 文件
initData()

app.listen(PORT, () => {
  console.log(`[server] 后端服务已启动，监听端口 ${PORT}`)
  console.log(`[server] 健康检查: http://localhost:${PORT}/health`)
})
