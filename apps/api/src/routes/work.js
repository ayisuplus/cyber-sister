import { Router } from 'express'

const router = Router()

// 工作模式能力状态：云端切割后不再有内置浏览器，恒报 browser 未启用（保留契约形状）。
router.get('/status', (_req, res) => {
  res.json({ browser: { enabled: false, running: false, headed: false } })
})


export default router
