/**
 * 「她的来信」的读取与动作。
 * - GET 只读既有来信，绝不隐式生成；POST /generate 惰性生成（幂等，打开「她」页时调用）。
 * - 看信的两个一键动作：「带去对话」纯前端拼草稿，不走后端；「同意采纳」在这里执行——
 *   改/删记忆都走 memoryService 的既有校验与版本约束（冲突 409 原样透传，不自动覆盖），
 *   plan 建议建一条 once 的「安排」。记忆只能由用户创建和维护：这里只执行用户点下的那次采纳。
 */
import { Router } from 'express'
import * as letterService from '../services/letterService.js'
import * as memoryService from '../services/memoryService.js'
import * as reminderService from '../services/reminderService.js'
import { HttpError } from '../utils/dbHelpers.js'
import { localClock } from '../services/contextBlocks.js'
import logger from '../utils/logger.js'

const router = Router()
const DAY_MS = 24 * 60 * 60 * 1000

function sendError(res, error, fallback) {
  return res.status(error.statusCode || 500).json({
    error: error.statusCode ? error.message : fallback,
    ...(error.code ? { code: error.code } : {}),
  })
}

/** 明天（北京时间）的 'yyyy-MM-dd'：plan 建议没写日子时的缺省安排日。 */
function tomorrowDate(now = new Date()) {
  const day = new Date(localClock(now).dayKey + DAY_MS)
  return `${day.getUTCFullYear()}-${String(day.getUTCMonth() + 1).padStart(2, '0')}-${String(day.getUTCDate()).padStart(2, '0')}`
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
    res.json(await letterService.generateDueLetter(req.user.userId))
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
 * 一键采纳 / 不用：动作矩阵
 * - accept × edit_memory：把那条记忆改成 suggestText（body.content 可带用户改过的正文），版本冲突 409 透传。
 * - accept × delete_memory：删掉那条记忆；已经不在了也算采纳（already: true）。
 * - accept × plan：建一条 once 的「安排」，缺省明天（北京时间）09:00，instruction 交给她到点做。
 * - dismiss：不动记忆与安排。
 * 成功后把 decided 写回这封信，返回整封更新后的信。
 */
router.post('/:id/suggestions/:index/decide', async (req, res) => {
  try {
    const userId = req.user.userId
    const letter = await letterService.getLetter(userId, req.params.id)
    const suggestions = Array.isArray(letter.suggestions) ? [...letter.suggestions] : []
    const index = Number(req.params.index)
    if (!Number.isInteger(index) || index < 0 || index >= suggestions.length) {
      throw new HttpError('这条建议已经不在了', 404)
    }
    const item = suggestions[index]
    if (item?.decided != null) throw new HttpError('这条建议已经处理过了', 409)
    const decision = req.body?.decision
    if (decision !== 'accept' && decision !== 'dismiss') {
      throw new HttpError('decision只能是accept或dismiss', 400)
    }

    let result = {}
    if (decision === 'accept' && item.kind === 'edit_memory') {
      const content = typeof req.body?.content === 'string' && req.body.content.trim()
        ? req.body.content.trim()
        : item.suggestText
      try {
        await memoryService.updateMemory(userId, item.memoryId, {
          content,
          expectedRevision: req.body?.expectedRevision ?? item.memoryRevision,
        })
      } catch (error) {
        if (error?.statusCode === 404) throw new HttpError('这条记忆已经不在了', 404)
        throw error
      }
    } else if (decision === 'accept' && item.kind === 'delete_memory') {
      try {
        await memoryService.deleteMemory(userId, item.memoryId)
      } catch (error) {
        // 记忆已经不在了：建议照常算采纳，不报错
        if (error?.statusCode !== 404) throw error
        result = { success: true, already: true }
      }
    } else if (decision === 'accept' && item.kind === 'plan') {
      await reminderService.createScheduledReminder(userId, {
        content: item.suggestText,
        freq: 'once',
        date: item.planDate ?? tomorrowDate(),
        time: '09:00',
        instruction: item.instruction ?? null,
      })
    }

    suggestions[index] = { ...item, decided: decision === 'accept' ? 'accepted' : 'dismissed' }
    const updated = await letterService.saveSuggestions(letter.id, suggestions)
    res.json({ ...result, letter: updated })
  } catch (error) {
    logger.error('来信建议处理失败', { errorCode: error.code || error.name, userId: req.user.userId })
    sendError(res, error, '来信建议处理失败')
  }
})

export default router
