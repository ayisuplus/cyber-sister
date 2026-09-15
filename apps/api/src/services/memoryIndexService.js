import prisma from '../prisma/client.js'
import { HttpError } from '../utils/dbHelpers.js'
import { withMemoryTransaction } from './memoryGovernance.js'
import { embeddingConfig, projectionMatches } from './embeddingConfig.js'
import { embedMemory, hasEmbeddingConsent } from './embeddingService.js'
import logger from '../utils/logger.js'

const controllers = new Map()
let timer = null
let ticking = false

export async function createIndexJob(userId, { mode = 'repair' } = {}) {
  if (!['repair', 'rebuild'].includes(mode)) throw new HttpError('索引模式不正确', 400)
  if (!embeddingConfig()) throw Object.assign(new HttpError('向量服务尚未配置，目前使用关键词检索', 503), { code: 'EMBEDDING_NOT_CONFIGURED' })
  return withMemoryTransaction(userId, async (tx) => {
    if (!await hasEmbeddingConsent(userId, tx)) throw Object.assign(new HttpError('需要先同意云端处理', 503), { code: 'CLOUD_NOT_CONSENTED' })
    const existing = await tx.memoryIndexJob.findFirst({ where: { userId, status: { in: ['queued', 'running'] } } })
    if (existing) return existing
    const total = await tx.memory.count({ where: { userId, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } })
    return tx.memoryIndexJob.create({ data: { userId, mode, total } })
  })
}

export async function getIndexJob(userId, id) {
  const job = await prisma.memoryIndexJob.findFirst({ where: { userId, id } })
  if (!job) throw new HttpError('索引任务不存在', 404)
  return job
}

export function latestIndexJob(userId) {
  return prisma.memoryIndexJob.findFirst({ where: { userId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] })
}

export async function cancelIndexJob(userId, id) {
  const job = await withMemoryTransaction(userId, async (tx) => {
    const current = await tx.memoryIndexJob.findFirst({ where: { userId, id } })
    if (!current) throw new HttpError('索引任务不存在', 404)
    if (!['queued', 'running'].includes(current.status)) return current
    return tx.memoryIndexJob.update({ where: { id }, data: { status: 'cancelled' } })
  })
  controllers.get(id)?.abort()
  return job
}

export async function runIndexJob(id) {
  const claimed = await prisma.memoryIndexJob.updateMany({ where: { id, status: 'queued' }, data: { status: 'running' } })
  if (!claimed.count) return
  const job = await prisma.memoryIndexJob.findUnique({ where: { id } })
  if (!job) return
  const controller = new AbortController()
  controllers.set(id, controller)
  try {
    let cursor
    for (;;) {
      // eslint-disable-next-line no-await-in-loop
      const current = await getIndexJob(job.userId, id)
      if (current.status !== 'running' || controller.signal.aborted) return
      // 用 id 条件翻页，游标记录被删除也不会提前结束任务。
      // eslint-disable-next-line no-await-in-loop
      const memories = await prisma.memory.findMany({
        where: { userId: job.userId, createdAt: { lte: job.createdAt }, ...(cursor ? { id: { gt: cursor } } : {}),
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
        orderBy: { id: 'asc' }, take: 50, include: { projection: true },
      })
      if (!memories.length) break
      for (const memory of memories) {
        // eslint-disable-next-line no-await-in-loop
        if (!await hasEmbeddingConsent(job.userId)) throw Object.assign(new Error('Consent revoked'), { code: 'CLOUD_NOT_CONSENTED' })
        if (controller.signal.aborted) return
        let outcome = 'skipped'
        if (job.mode === 'rebuild' || !projectionMatches(memory.projection, memory.revision)) {
          // eslint-disable-next-line no-await-in-loop
          outcome = await embedMemory(memory, { signal: controller.signal, jobId: id }) ? 'embedded' : 'failed'
        }
        // eslint-disable-next-line no-await-in-loop
        const progress = await prisma.memoryIndexJob.updateMany({ where: { id, status: 'running' }, data: { processed: { increment: 1 }, [outcome]: { increment: 1 } } })
        if (!progress.count) return
      }
      cursor = memories.at(-1).id
    }
    await prisma.memoryIndexJob.updateMany({ where: { id, status: 'running' }, data: { status: 'completed' } })
  } catch (error) {
    await prisma.memoryIndexJob.updateMany({ where: { id, status: 'running' }, data: { status: 'failed', errorCode: error?.code || 'INDEX_JOB_FAILED' } })
  } finally { controllers.delete(id) }
}

export async function startMemoryIndexWorker() {
  if (timer) return
  // 当前为单 API 实例，重启后的中断任务由用户显式重试。
  await prisma.memoryIndexJob.updateMany({ where: { status: 'running' }, data: { status: 'interrupted', errorCode: 'SERVER_RESTARTED' } })
  timer = setInterval(async () => {
    if (ticking) return
    ticking = true
    try {
      const queued = await prisma.memoryIndexJob.findMany({ where: { status: 'queued' }, orderBy: { createdAt: 'asc' }, take: 4 })
      await Promise.allSettled(queued.map((job) => runIndexJob(job.id)))
    } catch { logger.warn('索引任务轮询暂时失败') }
    finally { ticking = false }
  }, 1000)
  timer.unref()
}

export function stopMemoryIndexWorker() {
  if (timer) clearInterval(timer)
  timer = null
  for (const controller of controllers.values()) controller.abort()
}
