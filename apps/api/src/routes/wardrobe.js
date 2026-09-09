import { Router } from 'express'
import { createImageUpload } from '../utils/imageUpload.js'
import * as wardrobeService from '../services/wardrobeService.js'
import logger from '../utils/logger.js'

const router = Router()

function sendError(res, error, fallback) {
  return res.status(error.statusCode || 500).json({
    error: error.statusCode ? error.message : fallback,
    ...(error.code ? { code: error.code } : {}),
  })
}

const imageUpload = createImageUpload({
  field: 'image',
  typeMessage: '仅支持 JPEG/PNG/WebP 图片',
  limitMessage: '图片不能超过 8MB',
  fallbackMessage: '图片上传失败',
})

router.get('/', async (req, res) => {
  try {
    res.json(await wardrobeService.listItems(req.user.userId))
  } catch (error) {
    logger.error('获取衣柜列表失败', { error: error.message })
    sendError(res, error, '获取衣柜列表失败')
  }
})

router.post('/', imageUpload, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '请选择图片' })
  try {
    res.json(await wardrobeService.createItem(req.user.userId, {
      name: req.body.name,
      buffer: req.file.buffer,
      mime: req.file.mimetype,
    }))
  } catch (error) {
    logger.error('创建衣柜单品失败', { error: error.message })
    sendError(res, error, '创建衣柜单品失败')
  }
})

router.get('/:id/source', async (req, res) => {
  try {
    const { buffer, mime } = await wardrobeService.readItemFile(req.user.userId, req.params.id, 'source')
    res.set('Cache-Control', 'no-store').type(mime).send(buffer)
  } catch (error) {
    logger.error('读取单品图片失败', { error: error.message })
    sendError(res, error, '读取单品图片失败')
  }
})

router.get('/:id/model', async (req, res) => {
  try {
    const { buffer, mime } = await wardrobeService.readItemFile(req.user.userId, req.params.id, 'model')
    res.set('Cache-Control', 'no-store').type(mime).send(buffer)
  } catch (error) {
    logger.error('读取单品模型失败', { error: error.message })
    sendError(res, error, '读取单品模型失败')
  }
})

router.delete('/:id', async (req, res) => {
  try {
    await wardrobeService.deleteItem(req.user.userId, req.params.id)
    res.json({ success: true })
  } catch (error) {
    logger.error('删除衣柜单品失败', { error: error.message })
    sendError(res, error, '删除衣柜单品失败')
  }
})

export default router
