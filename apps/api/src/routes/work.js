import { Router } from 'express'
import { getBrowserStatus } from '../services/browserService.js'
import { readWorkImage } from '../services/workImageService.js'
import logger from '../utils/logger.js'

const router = Router()

// 工作模式能力状态：目前仅暴露内置浏览器可用性，供聊天页工作模式徽章轮询
router.get('/status', (_req, res) => {
  res.json({ browser: getBrowserStatus() })
})


// 工作模式生成图读取：按登录用户隔离目录，文件名形态非法或不存在一律 404
router.get('/images/:name', async (req, res) => {
  try {
    const data = await readWorkImage(req.user.userId, req.params.name)
    res.type('png').send(data)
  } catch (error) {
    logger.error('读取生成图失败', { error: error.message, userId: req.user.userId })
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : '读取生成图失败' })
  }
})
export default router
