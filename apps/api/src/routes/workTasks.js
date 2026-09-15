import { Router } from 'express'
import { workMessageUpload } from '../utils/workMessageUpload.js'
import { createWorkTask, listWorkTasks, getWorkTask, cancelWorkTask, retryWorkTask } from '../services/workTaskService.js'
import { decideWorkAction } from '../services/workActionService.js'

const router = Router()
const fail = (res, error) => res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : '后台任务暂时不可用', ...(error.code && error.statusCode ? { code: error.code } : {}) })

router.post('/conversations/:id/tasks', workMessageUpload, async (req, res) => {
  if (req.file) return res.status(400).json({ error: '后台任务请通过「添加文件」上传资料；照片对话请直接发送', code: 'INVALID_WORK_TASK' })
  try {
    const task = await createWorkTask(req.user.userId, req.params.id, {
      content: req.body?.content ?? '', requestKey: req.get('Idempotency-Key'), files: req.workFiles || [],
    })
    res.status(202).json({ task })
  } catch (error) { fail(res, error) }
})
router.get('/tasks', async (req, res) => {
  try { res.set('Cache-Control', 'private, no-store').json({ tasks: await listWorkTasks(req.user.userId) }) }
  catch (error) { fail(res, error) }
})
router.get('/tasks/:id', async (req, res) => {
  try { res.set('Cache-Control', 'private, no-store').json({ task: await getWorkTask(req.user.userId, req.params.id) }) }
  catch (error) { fail(res, error) }
})
router.post('/tasks/:id/cancel', async (req, res) => {
  try { res.json({ task: await cancelWorkTask(req.user.userId, req.params.id) }) }
  catch (error) { fail(res, error) }
})
router.post('/tasks/:id/retry', async (req, res) => {
  try { res.status(202).json({ task: await retryWorkTask(req.user.userId, req.params.id) }) }
  catch (error) { fail(res, error) }
})
router.post('/tasks/:id/actions/:actionId', async (req, res) => {
  try {
    await decideWorkAction(req.user.userId, req.params.id, req.params.actionId, req.body?.decision)
    res.set('Cache-Control', 'private, no-store').json({ task: await getWorkTask(req.user.userId, req.params.id) })
  } catch (error) { fail(res, error) }
})

export default router
