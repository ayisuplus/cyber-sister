import { Router } from 'express'
import {
  detectLocalLlm,
  getStoredLocalConfig,
  probeLocalLlm,
  saveLocalLlmConfig,
  serializeLocalConfig,
} from '../services/localLlmConfigService.js'

const router = Router()

function sendError(res, error, fallback) {
  return res.status(error.statusCode || 500).json({
    error: error.statusCode ? error.message : fallback,
    ...(error.code ? { code: error.code } : {}),
  })
}

function hasOnlyKeys(body, allowed) {
  return body && typeof body === 'object' && !Array.isArray(body)
    && Object.keys(body).every((key) => allowed.has(key))
}

router.post('/detect', async (req, res) => {
  try {
    if (!hasOnlyKeys(req.body, new Set(['preset'])) || Object.keys(req.body).length !== 1) {
      return res.status(400).json({ error: '检测请求参数无效', code: 'INVALID_LOCAL_LLM_PRESET' })
    }
    res.json(await detectLocalLlm(req.body.preset))
  } catch (error) {
    sendError(res, error, '检测 llama.cpp 失败')
  }
})

router.post('/test', async (req, res) => {
  try {
    if (!hasOnlyKeys(req.body, new Set(['baseUrl', 'model', 'apiKey']))) {
      return res.status(400).json({ error: '测试请求参数无效', code: 'INVALID_LOCAL_LLM_CONFIG' })
    }
    res.json(await probeLocalLlm(req.body))
  } catch (error) {
    sendError(res, error, '测试 llama.cpp 连接失败')
  }
})

router.get('/config', async (_req, res) => {
  try {
    res.json(serializeLocalConfig(await getStoredLocalConfig()))
  } catch (error) {
    sendError(res, error, '获取 llama.cpp 配置失败')
  }
})

router.put('/config', async (req, res) => {
  try {
    if (!hasOnlyKeys(req.body, new Set([
      'enabled', 'baseUrl', 'model', 'apiKey', 'apiKeyAction',
    ]))) {
      return res.status(400).json({ error: '配置请求参数无效', code: 'INVALID_LOCAL_LLM_CONFIG' })
    }
    res.json(await saveLocalLlmConfig(req.user.userId, req.body))
  } catch (error) {
    sendError(res, error, '保存 llama.cpp 配置失败')
  }
})

export default router
