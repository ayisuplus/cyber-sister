import { createHash, randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import prisma from '../prisma/client.js'
import { isLocalWorkRuntime } from '../config/distribution.js'
import { HttpError } from '../utils/dbHelpers.js'
import logger from '../utils/logger.js'
import { BACKGROUND_WORK_TOOLS } from './agentService.js'
import { sendMessageStream } from './chatService.js'
import { prepareWorkAttachments } from './workArtifactService.js'
import { WORK_ACTION_FIELDS, requestWorkAction, settleWorkActions } from './workActionService.js'

const ACTIVE = ['queued', 'running', 'paused']
const LEASE_MS = 30000
const MAX_DURATION_MS = 15 * 60 * 1000
const publicFields = {
  id: true, conversationId: true, content: true, status: true, progress: true, attempts: true,
  errorCode: true, userMessageId: true, aiMessageId: true, createdAt: true, updatedAt: true, completedAt: true,
  actions: { select: WORK_ACTION_FIELDS, orderBy: { createdAt: 'asc' } },
}
const active = new Map()
let timer = null
let polling = null
let stopping = false

export const isWorkTasksEnabled = () => isLocalWorkRuntime() && process.env.WORK_TASKS_ENABLED === 'true'
const taskError = (message, statusCode, code) => Object.assign(new HttpError(message, statusCode), { code })
const interrupted = (code) => Object.assign(new Error('后台任务已停止'), { name: 'AbortError', code })

function requireEnabled() {
  if (!isWorkTasksEnabled()) throw taskError('后台执行尚未启用', 503, 'WORK_TASKS_DISABLED')
}

async function lockUser(tx, userId) {
  const owner = await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`
  if (!owner.length) throw taskError('用户不存在', 404, 'USER_NOT_FOUND')
}

function assertWorkConversation(conversation) {
  if (!conversation) throw taskError('会话不存在', 404, 'CONVERSATION_NOT_FOUND')
  if (conversation.archivedAt) throw taskError('请先恢复已归档的对话', 409, 'CONVERSATION_ARCHIVED')
}

export async function createWorkTask(userId, conversationId, { content = '', requestKey, files = [] } = {}) {
  requireEnabled()
  if (typeof content !== 'string' || content.length > 10000 || typeof requestKey !== 'string' || !/^[\w-]{8,128}$/.test(requestKey)) {
    throw taskError('任务内容或提交标识不正确', 400, 'INVALID_WORK_TASK')
  }
  const attachments = prepareWorkAttachments(files)
  const text = content.trim()
  if (!text && !attachments.length) throw taskError('请输入任务或添加文件', 400, 'INVALID_WORK_TASK')
  // ID/时间由服务器产生，不纳入请求摘要；同一份上传重试必须命中同一任务。
  const requestHash = createHash('sha256').update(JSON.stringify({ conversationId, content: text,
    files: attachments.map(({ title, format, content: data, encoding }) => ({ title, format, data, encoding })) })).digest('hex')
  return prisma.$transaction(async (tx) => {
    await lockUser(tx, userId)
    const previous = await tx.workTask.findUnique({ where: { userId_requestKey: { userId, requestKey } }, select: { ...publicFields, requestHash: true } })
    if (previous) {
      if (previous.requestHash !== requestHash) throw taskError('此提交标识已用于另一份内容', 409, 'WORK_TASK_CONFLICT')
      const { requestHash: _hash, ...task } = previous
      return task
    }
    assertWorkConversation(await tx.conversation.findFirst({ where: { id: conversationId, userId } }))
    if (await tx.workTask.findFirst({ where: { userId, status: { in: ACTIVE } }, select: { id: true } })) {
      throw taskError('已有后台任务，请等待完成或先取消', 409, 'WORK_TASK_ACTIVE')
    }
    return tx.workTask.create({ data: { userId, conversationId, content: text, requestKey, requestHash, attachments }, select: publicFields })
  })
}

export function listWorkTasks(userId) {
  return prisma.workTask.findMany({ where: { userId }, select: publicFields, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 20 })
}

export async function getWorkTask(userId, id) {
  const task = await prisma.workTask.findFirst({ where: { userId, id }, select: publicFields })
  if (!task) throw taskError('任务不存在', 404, 'WORK_TASK_NOT_FOUND')
  return task
}

export async function cancelWorkTask(userId, id) {
  const task = await prisma.$transaction(async (tx) => {
    await lockUser(tx, userId)
    const current = await tx.workTask.findFirst({ where: { userId, id }, select: publicFields })
    if (!current) throw taskError('任务不存在', 404, 'WORK_TASK_NOT_FOUND')
    if (!ACTIVE.includes(current.status) && current.status !== 'failed') return current
    await settleWorkActions(tx, await tx.workTask.findUnique({ where: { id } }), 'cancelled')
    return tx.workTask.update({ where: { id }, data: {
      status: 'cancelled', leaseToken: null, leaseExpiresAt: null, completedAt: new Date(),
      checkpoint: Prisma.DbNull, attachments: [], errorCode: null,
    }, select: publicFields })
  })
  if (task.status === 'cancelled') active.get(id)?.controller.abort(interrupted('WORK_TASK_CANCELLED'))
  return task
}

export async function retryWorkTask(userId, id) {
  requireEnabled()
  return prisma.$transaction(async (tx) => {
    await lockUser(tx, userId)
    const task = await tx.workTask.findFirst({ where: { userId, id } })
    if (!task) throw taskError('任务不存在', 404, 'WORK_TASK_NOT_FOUND')
    if (task.status !== 'failed') throw taskError('此任务不能重试', 409, 'WORK_TASK_CONFLICT')
    assertWorkConversation(await tx.conversation.findFirst({ where: { id: task.conversationId, userId } }))
    if (await tx.workTask.findFirst({ where: { userId, status: { in: ACTIVE } }, select: { id: true } })) throw taskError('已有后台任务', 409, 'WORK_TASK_ACTIVE')
    return tx.workTask.update({ where: { id }, data: {
      status: 'queued', attempts: 0, leaseToken: null, leaseExpiresAt: null, errorCode: null, completedAt: null,
    }, select: publicFields })
  })
}

async function claim(id) {
  const owner = await prisma.workTask.findUnique({ where: { id }, select: { userId: true } })
  if (!owner) return null
  return prisma.$transaction(async (tx) => {
    await lockUser(tx, owner.userId)
    const task = await tx.workTask.findUnique({ where: { id } })
    if (!task || (task.status !== 'queued' && !(task.status === 'running' && task.leaseExpiresAt <= new Date()))) return null
    const inFlight = task.checkpoint?.inFlight
    const uncertainAction = await settleWorkActions(tx, task)
    if (uncertainAction || (task.checkpoint && task.checkpoint.version !== 1) || (inFlight && !BACKGROUND_WORK_TOOLS.includes(inFlight))) {
      await tx.workTask.update({ where: { id }, data: { status: 'paused', errorCode: 'WORK_TASK_UNCERTAIN', leaseToken: null, leaseExpiresAt: null } })
      return null
    }
    if (task.attempts >= 3) {
      await tx.workTask.update({ where: { id }, data: { status: 'failed', errorCode: 'WORK_TASK_INTERRUPTED', completedAt: new Date(), leaseToken: null, leaseExpiresAt: null } })
      return null
    }
    return tx.workTask.update({ where: { id }, data: {
      status: 'running', attempts: { increment: 1 }, leaseToken: randomUUID(), leaseExpiresAt: new Date(Date.now() + LEASE_MS), errorCode: null,
    } })
  })
}

function leaseWhere(task) {
  return { id: task.id, userId: task.userId, status: 'running', leaseToken: task.leaseToken, leaseExpiresAt: { gt: new Date() } }
}

async function execute(id, controller) {
  const task = await claim(id)
  if (!task) return
  const { signal } = controller
  const assertActive = async () => {
    signal.throwIfAborted()
    if (!await prisma.workTask.findFirst({ where: { ...leaseWhere(task), conversation: { archivedAt: null } }, select: { id: true } })) {
      controller.abort(interrupted('WORK_TASK_LEASE_LOST'))
    }
    signal.throwIfAborted()
  }
  const heartbeat = setInterval(() => {
    void prisma.workTask.updateMany({ where: leaseWhere(task), data: { leaseExpiresAt: new Date(Date.now() + LEASE_MS) } })
      .then((result) => { if (!result.count) controller.abort(interrupted('WORK_TASK_LEASE_LOST')) })
      .catch(() => controller.abort(interrupted('WORK_TASK_HEARTBEAT_FAILED')))
  }, LEASE_MS / 3)
  const deadline = setTimeout(() => controller.abort(interrupted('WORK_TASK_TIMEOUT')), MAX_DURATION_MS)
  heartbeat.unref(); deadline.unref()
  const durable = {
    snapshot: task.checkpoint?.turn,
    attachments: task.attachments,
    allowedTools: BACKGROUND_WORK_TOOLS,
    requestAction: value => requestWorkAction(task, value, { signal, onUncertain: () => controller.abort(interrupted('WORK_TASK_UNCERTAIN')) }),
    requestMediaAction: value => requestWorkAction(task, value, { signal, provider: 'runninghub', onUncertain: () => controller.abort(interrupted('WORK_TASK_UNCERTAIN')) }),
    assertActive,
    async saveCheckpoint(turn, inFlight) {
      signal.throwIfAborted()
      const progress = turn.toolRuns.map((run, step) => ({ ...run, step, status: run.ok ? 'completed' : 'failed' }))
      if (inFlight) progress.push({ step: progress.length, tool: inFlight, status: 'running' })
      const result = await prisma.workTask.updateMany({ where: leaseWhere(task), data: { checkpoint: { version: 1, turn, inFlight }, progress } })
      if (!result.count) controller.abort(interrupted('WORK_TASK_LEASE_LOST'))
      signal.throwIfAborted()
    },
    async lockForCommit(tx) {
      signal.throwIfAborted()
      // 与取消/角色成长采用相同的 user -> task 锁顺序；任务完成与消息/文件同一事务提交。
      await lockUser(tx, task.userId)
      const locked = await tx.workTask.updateMany({ where: leaseWhere(task), data: { leaseExpiresAt: new Date(Date.now() + LEASE_MS) } })
      if (!locked.count) throw interrupted('WORK_TASK_LEASE_LOST')
      assertWorkConversation(await tx.conversation.findFirst({ where: { id: task.conversationId, userId: task.userId } }))
      signal.throwIfAborted()
    },
    async complete(tx, { userMessage, aiMessage }) {
      signal.throwIfAborted()
      const current = await tx.workTask.findUnique({ where: { id: task.id } })
      if (await settleWorkActions(tx, current)) throw interrupted('WORK_TASK_UNCERTAIN')
      const result = await tx.workTask.updateMany({ where: leaseWhere(task), data: {
        status: 'completed', userMessageId: userMessage.id, aiMessageId: aiMessage.id, completedAt: new Date(),
        leaseToken: null, leaseExpiresAt: null, checkpoint: Prisma.DbNull, attachments: [],
      } })
      if (!result.count) throw interrupted('WORK_TASK_LEASE_LOST')
      signal.throwIfAborted()
    },
  }
  try {
    await assertActive()
    let completed = false
    for await (const event of sendMessageStream(task.conversationId, task.userId, task.content, task.id, { signal, durable })) {
      if (event.type === 'error') throw taskError('任务执行失败', 503, event.reason)
      if (event.type === 'done' || event.type === 'blocked') completed = true
    }
    signal.throwIfAborted()
    if (!completed) throw taskError('任务未完成', 503, 'WORK_TASK_FAILED')
  } catch (error) {
    const code = signal.reason?.code || error.code
    const resuming = code === 'WORK_WORKER_STOPPING'
    const publicCode = ['CLOUD_NOT_CONSENTED', 'LLM_UNAVAILABLE', 'CONVERSATION_ARCHIVED', 'WORK_TASK_TIMEOUT'].includes(code) ? code : 'WORK_TASK_FAILED'
    await prisma.$transaction(async tx => {
      await lockUser(tx, task.userId)
      const current = await tx.workTask.findFirst({ where: { id, status: 'running', leaseToken: task.leaseToken } })
      if (!current) return
      const uncertain = await settleWorkActions(tx, current)
      await tx.workTask.update({ where: { id }, data: {
        status: uncertain ? 'paused' : resuming ? 'queued' : 'failed', errorCode: uncertain ? 'WORK_TASK_UNCERTAIN' : resuming ? null : publicCode,
        leaseToken: null, leaseExpiresAt: null, completedAt: uncertain || resuming ? null : new Date(),
      } })
    }).catch(() => logger.warn('后台任务状态暂时无法保存', { taskId: id }))
  } finally {
    clearInterval(heartbeat)
    clearTimeout(deadline)
  }
}

export function runWorkTask(id) {
  if (!isWorkTasksEnabled() || stopping || active.has(id) || active.size >= 2) return Promise.resolve()
  const controller = new AbortController()
  const entry = { controller, promise: null }
  active.set(id, entry)
  entry.promise = execute(id, controller)
    .catch(() => logger.warn('后台任务暂时无法启动', { taskId: id }))
    .finally(() => { if (active.get(id) === entry) active.delete(id) })
  return entry.promise
}

export function startWorkTaskWorker() {
  if (timer || !isWorkTasksEnabled()) return
  stopping = false
  timer = setInterval(() => {
    if (polling || stopping || active.size >= 2) return
    polling = prisma.workTask.findMany({
      where: { OR: [{ status: 'queued' }, { status: 'running', leaseExpiresAt: { lte: new Date() } }] },
      orderBy: { createdAt: 'asc' }, take: 2, select: { id: true },
    }).then((tasks) => { if (!stopping) for (const task of tasks) void runWorkTask(task.id) })
      .catch(() => logger.warn('后台任务队列尚未就绪'))
      .finally(() => { polling = null })
  }, 1000)
  timer.unref()
}

export async function stopWorkTaskWorker() {
  stopping = true
  if (timer) clearInterval(timer)
  timer = null
  await polling
  for (const { controller } of active.values()) controller.abort(interrupted('WORK_WORKER_STOPPING'))
  await Promise.allSettled([...active.values()].map(({ promise }) => promise))
}
