/**
 * 「她的来信」的读取与动作。
 * - GET 只读既有来信，绝不隐式生成；POST /generate 惰性生成（幂等，打开「她」页时调用）。
 * - 看信的两个一键动作：「带去对话」纯前端拼草稿，不走后端；「同意采纳 / 不用」交给提议通道
 *   （services/memory/proposalService.js，路线图 C23）。记忆只能由用户创建和维护：这里只执行用户点下的那一次。
 */
import { Router } from 'express'
import * as letterService from '../services/letterService.js'
import * as proposalService from '../services/memory/proposalService.js'
import logger from '../utils/logger.js'

const router = Router()

function sendError(res, error, fallback) {
  return res.status(error.statusCode || 500).json({
    error: error.statusCode ? error.message : fallback,
    ...(error.code ? { code: error.code } : {}),
  })
}

router.get('/', async (req, res) => {
  try {
    res.json({ letters: await letterService.listLetters(req.user.userId) })
  } catch (error) {
    sendError(res, error, '读取来信失败')
  }
})

// 到期就写一封：幂等，没开写信/没到期/沉默期都不写，返回值带 reason 说明为什么没写
router.post('/generate', async (req, res) => {
  try {
    res.json(await letterService.scheduleDueLetter(req.user.userId))
  } catch (error) {
    logger.error('生成来信失败', { errorCode: error.code || error.name, userId: req.user.userId })
    sendError(res, error, '生成来信失败')
  }
})

router.get('/:id', async (req, res) => {
  try {
    res.json({ letter: await letterService.getLetter(req.user.userId, req.params.id) })
  } catch (error) {
    sendError(res, error, '读取来信失败')
  }
})

// 看过这封信：幂等，重复调用照样 success
router.post('/:id/read', async (req, res) => {
  try {
    res.json(await letterService.markLetterRead(req.user.userId, req.params.id))
  } catch (error) {
    sendError(res, error, '没记下来，请重试')
  }
})

/**
 * 一键采纳 / 不用：动作都在提议通道里，一个事务做完（写根、回写这条建议、结束她依据的整理），
 * 动作矩阵见 services/memory/proposalService.js 与 API 文档 §十四。返回整封更新后的信。
 */
router.post('/:id/suggestions/:index/decide', async (req, res) => {
  try {
    res.json(await proposalService.decideSuggestion(req.user.userId, req.params.id, req.params.index, req.body ?? {}))
  } catch (error) {
    logger.error('来信建议处理失败', { errorCode: error.code || error.name, userId: req.user.userId })
    sendError(res, error, '来信建议处理失败')
  }
})

export default router
