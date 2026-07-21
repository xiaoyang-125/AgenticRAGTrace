import express from 'express'
import { initData } from './data/init'
import healthRouter from './routes/health'

const app = express()
const PORT = 3001

// 解析 JSON 请求体
app.use(express.json())

// 注册路由
app.use('/health', healthRouter)

// 启动时初始化 data 目录和 JSON 文件
initData()

app.listen(PORT, () => {
  console.log(`[server] 后端服务已启动，监听端口 ${PORT}`)
  console.log(`[server] 健康检查: http://localhost:${PORT}/health`)
})
