import { Router } from 'express'
import { validateRequired, validate } from '../utils/validate.js'
import * as makeupPresetService from '../services/makeupPresetService.js'
import logger from '../utils/logger.js'

const router = Router()

router.get('/', async (req, res) => {
  try {
    res.json(await makeupPresetService.listPresets(req.user.userId))
  } catch (error) {
    logger.error('获取妆容预设失败', { error: error.message })
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : '获取妆容预设失败' })
  }
})

router.post('/', validate([
  { field: 'name', validate: (v) => validateRequired(v, '妆容名字') },
]), async (req, res) => {
  try {
    res.json(await makeupPresetService.createPreset(req.user.userId, req.body))
  } catch (error) {
    logger.error('创建妆容预设失败', { error: error.message })
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : '创建妆容预设失败' })
  }
})

router.put('/:id', validate([
  { field: 'name', validate: (v) => validateRequired(v, '妆容名字') },
]), async (req, res) => {
  try {
    res.json(await makeupPresetService.renamePreset(req.user.userId, req.params.id, req.body))
  } catch (error) {
    logger.error('重命名妆容预设失败', { error: error.message })
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : '重命名妆容预设失败' })
  }
})

router.delete('/:id', async (req, res) => {
  try {
    await makeupPresetService.deletePreset(req.user.userId, req.params.id)
    res.json({ success: true })
  } catch (error) {
    logger.error('删除妆容预设失败', { error: error.message })
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : '删除妆容预设失败' })
  }
})

export default router
