import { Router, Request, Response } from 'express'

const router = Router()

// GET /health - 健康检查接口，返回服务状态和当前时间戳
router.get('/', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
  })
})

export default router
