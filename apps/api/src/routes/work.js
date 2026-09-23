import { Router } from 'express'
import { WORK_CLOUD_EXECUTION } from '../services/workCloudService.js'
import { isCloudProviderConfigured } from '../services/llmService.js'
import { ARTIFACT_FORMATS, artifactBuffer, listWorkArtifacts, readWorkArtifact } from '../services/workArtifactService.js'
import { workCodeStatus } from '../services/workExecutionService.js'
import { workBrowserStatus } from '../services/workBrowserService.js'
import { isWorkTasksEnabled } from '../services/workTaskService.js'
import workTaskRoutes from './workTasks.js'

const router = Router()
router.use(workTaskRoutes)

// 对话代理与领域短评分别报告状态，不能因模型已配置就将模拟功能标记为可用。
router.get('/status', async (req, res) => {
  const [code, browser] = await Promise.all([workCodeStatus(), workBrowserStatus(req.user.userId)])
  res.json({
    browser,
    execution: { mode: 'agent', cloudConnected: isCloudProviderConfigured(), persisted: true },
    domainGeneration: WORK_CLOUD_EXECUTION,
    capabilities: {
      conversation: isCloudProviderConfigured(),
      artifacts: Object.keys(ARTIFACT_FORMATS),
      search: process.env.SEARCH_ENABLED === 'true',
      webReading: process.env.SEARCH_ENABLED === 'true',
      browser: browser.available,
      fileUpload: true,
      codeExecution: code.available,
      documentReading: code.available,
      mediaGeneration: false,
      backgroundTasks: isWorkTasksEnabled(),
    },
    codeRuntime: code,
    recordStorage: 'api',
    features: [
      { id: 'schedule', api: '/api/reminders/scheduled', generation: 'agent' },
      { id: 'diary', api: '/api/diary', generation: 'mock' },
      { id: 'reading', api: '/api/reading', generation: 'mock' },
      { id: 'period', api: '/api/tools/period', generation: 'server_calculation' },
      // 装扮是收藏，不做生成
      { id: 'collection', api: '/api/collection', generation: 'none' },
      { id: 'letters', api: '/api/letters', generation: 'mock' },
    ],
  })
})

router.get('/artifacts', async (req, res) => {
  try {
    const conversationId = typeof req.query.conversationId === 'string' ? req.query.conversationId : undefined
    res.json({ artifacts: await listWorkArtifacts(req.user.userId, conversationId) })
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : '文件列表暂时不可用' })
  }
})

router.get('/artifacts/:id/download', async (req, res) => {
  try {
    const artifact = await readWorkArtifact(req.user.userId, req.params.id)
    const filename = `${artifact.title}.${artifact.format}`
    res.setHeader('Content-Type', ARTIFACT_FORMATS[artifact.format] || 'application/octet-stream')
    res.setHeader('Content-Disposition', `attachment; filename="amie.${artifact.format}"; filename*=UTF-8''${encodeURIComponent(filename)}`)
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox")
    res.setHeader('Cache-Control', 'private, no-store')
    res.send(artifactBuffer(artifact))
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : '文件下载失败' })
  }
})

export default router
