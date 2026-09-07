import { Router } from 'express'
import { createImageUpload } from '../utils/imageUpload.js'
import { validateEnum, validate } from '../utils/validate.js'
import * as userService from '../services/userService.js'
import { deleteAsset, readAsset, saveAsset } from '../services/userAssetService.js'
import logger from '../utils/logger.js'

const router = Router()

function sendError(res, error, fallback) {
  return res.status(error.statusCode || 500).json({
    error: error.statusCode ? error.message : fallback,
    ...(error.code ? { code: error.code } : {}),
  })
}

router.get('/profile', async (req, res) => {
  try {
    res.json(await userService.getProfile(req.user.userId))
  } catch (error) {
    logger.error('获取用户信息失败', { error: error.message, userId: req.user.userId })
    sendError(res, error, '获取用户信息失败')
  }
})

router.put('/profile', async (req, res) => {
  try {
    res.json(await userService.updateProfile(req.user.userId, req.body))
  } catch (error) {
    logger.error('更新用户信息失败', { error: error.message, userId: req.user.userId })
    sendError(res, error, '更新用户信息失败')
  }
})

router.put('/persona', validate([
  { field: 'persona', validate: (value) => validateEnum(value, '人格', userService.PERSONAS) },
]), async (req, res) => {
  try {
    res.json(await userService.switchPersona(req.user.userId, req.body.persona))
  } catch (error) {
    logger.error('切换人格失败', { error: error.message, userId: req.user.userId })
    sendError(res, error, '切换人格失败')
  }
})

router.put('/roleplay', async (req, res) => {
  try {
    res.json(await userService.updateRolePlay(req.user.userId, req.body))
  } catch (error) {
    logger.error('设置角色扮演失败', { error: error.message, userId: req.user.userId })
    sendError(res, error, '设置角色扮演失败')
  }
})

router.delete('/roleplay', async (req, res) => {
  try {
    await userService.clearRolePlay(req.user.userId)
    res.json({ success: true })
  } catch (error) {
    logger.error('清除角色扮演失败', { error: error.message, userId: req.user.userId })
    sendError(res, error, '清除角色扮演失败')
  }
})

router.get('/external-llm-consent', async (req, res) => {
  try {
    res.json(await userService.getExternalLlmConsent(req.user.userId))
  } catch (error) {
    logger.error('获取外部模型同意状态失败', { error: error.message, userId: req.user.userId })
    sendError(res, error, '获取外部模型同意状态失败')
  }
})

router.put('/external-llm-consent', async (req, res) => {
  try {
    res.json(await userService.updateExternalLlmConsent(req.user.userId, req.body.accepted))
  } catch (error) {
    logger.error('更新外部模型同意状态失败', { error: error.message, userId: req.user.userId })
    sendError(res, error, '更新外部模型同意状态失败')
  }
})

router.get('/membership', async (req, res) => {
  try {
    res.json(await userService.getMembership(req.user.userId))
  } catch (error) {
    logger.error('获取会员状态失败', { error: error.message, userId: req.user.userId })
    sendError(res, error, '获取会员状态失败')
  }
})

router.post('/membership/subscribe', async (req, res) => {
  try {
    res.json(await userService.subscribeMembership(req.user.userId))
  } catch (error) {
    logger.error('开通会员失败', { error: error.message, userId: req.user.userId })
    sendError(res, error, '开通会员失败')
  }
})

// 形象资产只在内存中流转（≤8MB，仅 JPEG/PNG/WebP）
const assetUpload = createImageUpload({
  field: 'file',
  typeMessage: '仅支持 JPEG/PNG/WebP 图片',
  limitMessage: '图片不能超过 8MB',
  fallbackMessage: '图片上传失败，请重试',
})

// 头像落库用现有 User.avatarUrl 列；两张背景是固定槽位文件，存在即生效
router.put('/assets/:slot', assetUpload, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '请选择图片' })
    }
    const result = await saveAsset(req.user.userId, req.params.slot, {
      buffer: req.file.buffer,
      mime: req.file.mimetype,
    })
    if (req.params.slot === 'avatar') {
      await userService.updateProfile(req.user.userId, { avatarUrl: result.url })
    }
    res.json(result)
  } catch (error) {
    logger.error('上传形象资产失败', { error: error.message, userId: req.user.userId })
    sendError(res, error, '图片上传失败，请重试')
  }
})

router.get('/assets/:slot', async (req, res) => {
  try {
    const { buffer, mime } = await readAsset(req.user.userId, req.params.slot)
    res.set('Cache-Control', 'no-store').type(mime).send(buffer)
  } catch (error) {
    // 404「未设置」是正常态，不进错误日志；只记录意外故障
    if (!error.statusCode) logger.error('读取形象资产失败', { error: error.message, userId: req.user.userId })
    sendError(res, error, '读取形象资产失败')
  }
})

router.delete('/assets/:slot', async (req, res) => {
  try {
    await deleteAsset(req.user.userId, req.params.slot)
    if (req.params.slot === 'avatar') {
      await userService.updateProfile(req.user.userId, { avatarUrl: null })
    }
    res.json({ ok: true })
  } catch (error) {
    logger.error('删除形象资产失败', { error: error.message, userId: req.user.userId })
    sendError(res, error, '删除失败，请重试')
  }
})

export default router
