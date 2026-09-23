/**
 * 模型供应商管理 /api/admin/model-providers（2026-09-22）。
 *
 * 只有实例管理员（INSTANCE_ADMIN_PHONES ∩ 内测白名单）能读写：路由在 app.js 里统一
 * 挂了 authMiddleware + instanceAdminMiddleware，这里不再自己判权限。
 * key 只进不出：新增/编辑可以写，任何响应只回 hasKey。
 */
import { Router } from 'express'
import * as modelProviderService from '../services/modelProviderService.js'
import { loadCloudProviders } from '../services/llmService.js'
import logger from '../utils/logger.js'

const router = Router()

function sendError(res, error, fallback) {
  if (!error.statusCode) logger.error(fallback, { error: error.message })
  return res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : fallback })
}

/**
 * 改完就把网关环境重新装配一遍：配置生效不用重启，也不会再用旧的一家。
 * 写成功但重装失败（例如某个老行的密钥解不开）时如实告诉调用方：这次改动已经落库了，
 * 不要让它以为要重试，更不能谎报成功。
 */
async function applyChange(res, change) {
  let result
  try {
    result = await change()
  } catch (error) {
    return sendError(res, error, '模型供应商没保存成功，请重试')
  }
  try {
    await loadCloudProviders()
  } catch (error) {
    logger.error('模型供应商配置已写入，但网关没能重装', { error: error.message, code: error.code })
    return res.json({
      ...result,
      warning: `改动已经保存，但网关没能重装：${error.statusCode ? error.message : '服务端错误'}。先修好它，再点一次「刷新列表」。`,
    })
  }
  return res.json(result)
}

router.get('/', async (_req, res) => {
  try {
    res.json({ providers: await modelProviderService.listProviders() })
  } catch (error) {
    sendError(res, error, '供应商列表没读出来')
  }
})

router.post('/', (req, res) => applyChange(res, async () => ({
  provider: await modelProviderService.createProvider(req.user.userId, req.body),
})))

// 排序要排在 /:id 前面，否则「order」会被当成 id
router.put('/order', (req, res) => applyChange(res, async () => ({
  providers: await modelProviderService.reorderProviders(req.user.userId, req.body?.ids),
})))

router.put('/:id', (req, res) => applyChange(res, async () => ({
  provider: await modelProviderService.updateProvider(req.user.userId, req.params.id, req.body),
})))

router.delete('/:id', (req, res) => applyChange(res, async () => {
  await modelProviderService.deleteProvider(req.user.userId, req.params.id)
  return { success: true }
}))

// 试一下：发一次最小的真实请求，会真的花一点点钱（界面上写明了）
router.post('/:id/test', async (req, res) => {
  try {
    res.json(await modelProviderService.testProvider(req.params.id))
  } catch (error) {
    sendError(res, error, '试一下没通过，请核对配置')
  }
})

export default router
