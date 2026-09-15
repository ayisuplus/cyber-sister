import { createHash } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import prisma from '../prisma/client.js'
import { HttpError } from '../utils/dbHelpers.js'
import { browserActionRequest } from './webReadService.js'

export const WORK_ACTION_FIELDS = {
  id: true, purpose: true, method: true, url: true, body: true, contentType: true, status: true,
  expiresAt: true, createdAt: true, decidedAt: true, submittedAt: true, completedAt: true, httpStatus: true,
  provider: true, providerTaskId: true,
}
const error = (message, status = 409) => new HttpError(message, status)
const fingerprint = request => createHash('sha256').update(JSON.stringify(browserActionRequest(request))).digest('hex')
const leaseWhere = task => ({ id: task.id, userId: task.userId, status: 'running', leaseToken: task.leaseToken,
  leaseExpiresAt: { gt: new Date() }, conversation: { archivedAt: null } })

async function lockTask(tx, task) {
  await tx.$queryRaw`SELECT id FROM users WHERE id = ${task.userId} FOR UPDATE`
  const current = await tx.workTask.findFirst({ where: leaseWhere(task) })
  if (!current) throw error('任务已停止，请重新核对')
  return current
}

const touch = (tx, id) => tx.workTask.update({ where: { id }, data: { updatedAt: new Date() } })

export async function decideWorkAction(userId, taskId, id, decision) {
  if (!['approve', 'reject'].includes(decision)) throw error('请选择确认提交或不提交', 400)
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`
    const action = await tx.workAction.findFirst({ where: { id, taskId, task: { userId } }, include: { task: true } })
    if (!action) throw error('待确认操作不存在', 404)
    if (action.status !== 'pending' || action.expiresAt <= new Date()) throw error('此确认已失效，请查看最新状态')
    await lockTask(tx, { ...action.task, leaseToken: action.leaseToken })
    await tx.workAction.update({ where: { id }, data: { status: decision === 'approve' ? 'approved' : 'rejected', decidedAt: new Date() } })
    await touch(tx, taskId)
  })
}

/** Called with the same user lock as task recovery/cancellation; never replay an uncertain submission. */
export async function settleWorkActions(tx, task, pendingStatus = 'expired') {
  const step = task.checkpoint?.turn?.toolRuns?.length || 0
  const submitted = await tx.workAction.count({ where: { taskId: task.id, OR: [
    { status: { in: ['executing', 'uncertain'] } },
    ...(task.checkpoint?.inFlight ? [{ step, status: 'completed' }] : []),
  ] } })
  await tx.workAction.updateMany({ where: { taskId: task.id, status: { in: ['pending', 'approved'] } }, data: { status: pendingStatus, completedAt: new Date() } })
  await tx.workAction.updateMany({ where: { taskId: task.id, status: 'executing' }, data: { status: 'uncertain', completedAt: new Date() } })
  return submitted > 0
}

export async function requestWorkAction(task, value, { signal, onUncertain, provider = null } = {}) {
  signal.throwIfAborted()
  const request = browserActionRequest(value)
  const action = await prisma.$transaction(async tx => {
    const current = await lockTask(tx, task)
    if (provider === 'runninghub' && await tx.workAction.findFirst({ where: { taskId: task.id, provider } })) {
      throw error('本次后台任务已申请过一次生图，请查询原任务；新图请另建任务', 400)
    }
    if (await tx.workAction.count({ where: { taskId: task.id } }) >= 5) throw error('本次任务已达到五次提交确认上限', 400)
    if (await tx.workAction.findFirst({ where: { taskId: task.id, status: 'rejected' } })) throw error('你已拒绝提交，本次任务不会再次请求外部写入', 403)
    signal.throwIfAborted()
    const proposal = await tx.workAction.create({ data: { ...request, provider, taskId: task.id, leaseToken: task.leaseToken,
      step: current.checkpoint?.turn?.toolRuns?.length || 0, requestHash: fingerprint(request), expiresAt: new Date(Date.now() + 300000) } })
    await touch(tx, task.id)
    return proposal
  })
  for (;;) {
    signal.throwIfAborted()
    // Approval can arrive through a different API process; PostgreSQL is authoritative.
    // eslint-disable-next-line no-await-in-loop
    const current = await prisma.workAction.findFirst({ where: { id: action.id, task: leaseWhere(task) } })
    if (!current || !['pending', 'approved'].includes(current.status)) throw error('此次提交未获确认或任务已停止', 403)
    if (current.expiresAt <= new Date()) {
      // eslint-disable-next-line no-await-in-loop
      await prisma.workAction.updateMany({ where: { id: action.id, status: { in: ['pending', 'approved'] } }, data: { status: 'expired', completedAt: new Date() } })
      throw error('等待确认已超时，此次请求未发送', 403)
    }
    if (current.status === 'approved') break
    // eslint-disable-next-line no-await-in-loop
    await delay(400, undefined, { signal })
  }
  const change = (expected, data) => prisma.$transaction(async tx => {
    await lockTask(tx, task)
    signal.throwIfAborted()
    const changed = await tx.workAction.updateMany({ where: { id: action.id, leaseToken: task.leaseToken, status: expected,
      ...(expected === 'approved' ? { expiresAt: { gt: new Date() } } : {}) }, data })
    if (!changed.count) throw error('此次确认已使用或失效')
    await touch(tx, task.id)
  })
  return {
    id: action.id,
    async begin(actual) {
      if (fingerprint(actual) !== action.requestHash || action.expiresAt <= new Date()) throw error('提交内容或有效期发生变化，请重新确认')
      await change('approved', { status: 'executing', submittedAt: new Date() })
    },
    complete: (httpStatus, providerTaskId) => {
      if (provider === 'runninghub' && (typeof providerTaskId !== 'string' || !/^\d{1,40}$/.test(providerTaskId))) throw error('云端任务编号无效', 400)
      return change('executing', { status: 'completed', httpStatus, ...(provider === 'runninghub' ? { providerTaskId } : {}), completedAt: new Date() })
    },
    async uncertain() {
      try { await change('executing', { status: 'uncertain', completedAt: new Date() }) }
      finally { onUncertain?.() }
    },
  }
}
