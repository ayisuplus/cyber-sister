import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const connection = vi.hoisted(() => ({ client: null }))
vi.mock('../../src/prisma/client.js', () => ({ default: new Proxy({}, {
  get: (_, key) => typeof connection.client?.[key] === 'function' ? connection.client[key].bind(connection.client) : connection.client?.[key],
}) }))
vi.mock('../../src/services/llmService.js', async (original) => ({ ...await original(), generateResponseStream: vi.fn() }))
vi.mock('../../src/services/embeddingService.js', () => ({ embedQuery: () => Promise.resolve(null) }))
vi.mock('../../src/utils/logger.js', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))

import { createWorkTask, getWorkTask, listWorkTasks, cancelWorkTask, retryWorkTask, runWorkTask, stopWorkTaskWorker } from '../../src/services/workTaskService.js'
import { generateResponseStream } from '../../src/services/llmService.js'
import { getCompanionState } from '../../src/services/companionService.js'

const withDatabase = process.env.TEST_DATABASE_URL ? describe : describe.skip
const databaseName = `cyber_sister_work_tasks_test_${Date.now()}`
let admin, db, user, conversation
const done = { type: 'done', content: '报告已生成。', emotion: 'neutral', source: 'test_model' }
const artifactCall = { type: 'toolcall', name: 'create_artifact', args: { title: '报告', format: 'csv', content: '项目,金额\n测试,425' } }
const deferred = () => {
  let resolve
  const promise = new Promise((r) => { resolve = r })
  return { promise, resolve }
}
const create = (options = {}) => createWorkTask(user.id, conversation.id, { content: '生成报告', requestKey: 'synthetic-request', ...options })
const fullTask = (id) => db.workTask.findUnique({ where: { id } })

withDatabase('durable work tasks on isolated PostgreSQL', () => {
  beforeAll(async () => {
    if (!/^cyber_sister_work_tasks_test_\d+$/.test(databaseName)) throw new Error('Unsafe database name')
    admin = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } })
    await admin.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`)
    const url = new URL(process.env.TEST_DATABASE_URL)
    url.pathname = `/${databaseName}`
    const migrated = spawnSync(process.execPath, ['src/prisma/migrateDeploy.js'], {
      cwd: fileURLToPath(new URL('../../', import.meta.url)), encoding: 'utf8',
      env: { ...process.env, NODE_ENV: 'test', APP_ENV: 'development', DATABASE_URL: url.href, DATABASE_PASSWORD_FILE: '' },
    })
    if (migrated.status !== 0) throw new Error(`Migration failed with exit ${migrated.status}`)
    db = new PrismaClient({ datasources: { db: { url: url.href } } })
    connection.client = db
  }, 60000)
  beforeEach(async () => {
    vi.stubEnv('WORK_TASKS_ENABLED', 'true')
    vi.stubEnv('WORK_NATIVE_TOOLS', 'true')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('No live network in tests')))
    generateResponseStream.mockReset().mockImplementation(async function* () { yield done })
    await db.user.deleteMany()
    user = await db.user.create({ data: { phone: '19900000011', externalLlmConsent: true, externalLlmConsentVersion: 'cloud-primary-v4' } })
    conversation = await db.conversation.create({ data: { userId: user.id, mode: 'work' } })
  })
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs() })
  afterAll(async () => {
    await stopWorkTaskWorker()
    await db?.$disconnect()
    if (admin) {
      await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`)
      await admin.$disconnect()
    }
  })

  it('concurrent duplicate submissions share one job; changed payload conflicts without exposing staged bytes', async () => {
    const buffer = Buffer.from('项目,金额\n测试,425')
    const files = [{ originalname: '输入.csv', buffer, size: buffer.length }]
    const [a, b] = await Promise.all([create({ files }), create({ files })])
    expect(a.id).toBe(b.id)
    expect(await db.workTask.count()).toBe(1)
    expect(await db.message.count()).toBe(0)
    expect(a).not.toHaveProperty('attachments')
    expect(a).not.toHaveProperty('requestHash')
    expect((await fullTask(a.id)).attachments).toHaveLength(1)
    await expect(create({ content: '另一项任务' })).rejects.toMatchObject({ code: 'WORK_TASK_CONFLICT' })
    await expect(create({ requestKey: 'other-request' })).rejects.toMatchObject({ code: 'WORK_TASK_ACTIVE' })
    expect(await listWorkTasks(user.id)).toHaveLength(1)
  })

  it('completion atomically stores messages, uploaded/generated files and one companion experience', async () => {
    const buffer = Buffer.from('value\n425')
    const task = await create({ files: [{ originalname: 'input.csv', buffer, size: buffer.length }] })
    generateResponseStream.mockImplementationOnce(async function* () { yield artifactCall })
    await runWorkTask(task.id)
    const finished = await fullTask(task.id)
    expect(finished).toMatchObject({ status: 'completed', attempts: 1, checkpoint: null, attachments: [] })
    expect(await db.message.count()).toBe(2)
    expect(await db.workArtifact.count()).toBe(2)
    expect(await db.memory.count()).toBe(0)
    expect((await getCompanionState(user.id)).state.experienceCount).toBe(1)
    const outputs = await db.workArtifact.findMany({ where: { origin: 'generated' } })
    expect(outputs[0]).toMatchObject({ content: artifactCall.args.content, messageId: finished.aiMessageId })
    expect((await getWorkTask(user.id, task.id)).progress[0]).toMatchObject({ tool: 'create_artifact', status: 'completed' })
    await runWorkTask(task.id)
    expect(generateResponseStream).toHaveBeenCalledTimes(2)
    expect((await cancelWorkTask(user.id, task.id)).status).toBe('completed')
    expect((await create({ files: [{ originalname: 'input.csv', buffer, size: buffer.length }] })).id).toBe(task.id)
  })

  it('provider failure after a completed tool resumes with its original file and call cache', async () => {
    const task = await create()
    generateResponseStream.mockImplementationOnce(async function* () { yield artifactCall })
      .mockImplementationOnce(async function* () { yield { type: 'error', reason: 'LLM_UNAVAILABLE' } })
    await runWorkTask(task.id)
    const interruptedTask = await fullTask(task.id)
    expect(interruptedTask.status).toBe('failed')
    const artifactId = interruptedTask.checkpoint.turn.artifacts[0].id
    expect(interruptedTask.checkpoint.turn.executedCalls).toHaveLength(1)
    expect(await db.message.count()).toBe(0)
    generateResponseStream.mockClear().mockImplementationOnce(async function* (_text, _persona, history, _memories, _requestId, options) {
      expect(history.filter((message) => message.content === '生成报告')).toHaveLength(1)
      expect(options.promptInHistory).toBe(true)
      yield artifactCall
    })
    await retryWorkTask(user.id, task.id)
    await runWorkTask(task.id)
    expect((await fullTask(task.id)).status).toBe('completed')
    expect(await db.workArtifact.count()).toBe(1)
    expect((await db.workArtifact.findFirst()).id).toBe(artifactId)
    expect((await getCompanionState(user.id)).state.experienceCount).toBe(1)
  })

  it('cancelled generation drops late tools and done, clears staged data and never updates growth', async () => {
    const task = await create()
    const entered = deferred(), release = deferred()
    generateResponseStream.mockImplementationOnce(async function* () { entered.resolve(); await release.promise; yield artifactCall; yield done })
    const running = runWorkTask(task.id)
    await entered.promise
    expect((await cancelWorkTask(user.id, task.id)).status).toBe('cancelled')
    release.resolve()
    await running
    expect(await fullTask(task.id)).toMatchObject({ status: 'cancelled', checkpoint: null, attachments: [] })
    expect(await db.message.count()).toBe(0)
    expect(await db.workArtifact.count()).toBe(0)
    expect((await getCompanionState(user.id)).state.experienceCount).toBe(0)
  })

  it('queued cancellation prevents any model call and frees the active task slot', async () => {
    const task = await create()
    await cancelWorkTask(user.id, task.id)
    await runWorkTask(task.id)
    expect(generateResponseStream).not.toHaveBeenCalled()
    expect((await create({ requestKey: 'next-request' })).status).toBe('queued')
  })

  it('foreign users cannot read, retry or cancel a task, and conversation deletion removes queued input', async () => {
    const task = await create()
    const other = await db.user.create({ data: { phone: '19900000012' } })
    await expect(getWorkTask(other.id, task.id)).rejects.toMatchObject({ statusCode: 404 })
    await expect(cancelWorkTask(other.id, task.id)).rejects.toMatchObject({ statusCode: 404 })
    await expect(retryWorkTask(other.id, task.id)).rejects.toMatchObject({ statusCode: 404 })
    expect(await listWorkTasks(other.id)).toEqual([])
    await db.conversation.delete({ where: { id: conversation.id } })
    await runWorkTask(task.id)
    expect(await db.workTask.count()).toBe(0)
    expect(generateResponseStream).not.toHaveBeenCalled()
  })

  it('expired owner cannot persist late output or overwrite a replacement lease', async () => {
    const task = await create()
    const entered = deferred(), release = deferred()
    generateResponseStream.mockImplementationOnce(async function* () { entered.resolve(); await release.promise; yield done })
    const running = runWorkTask(task.id)
    await entered.promise
    await db.workTask.update({ where: { id: task.id }, data: { leaseToken: 'replacement-owner', leaseExpiresAt: new Date(Date.now() + 30000) } })
    release.resolve()
    await running
    expect(await fullTask(task.id)).toMatchObject({ status: 'running', leaseToken: 'replacement-owner' })
    expect(await db.message.count()).toBe(0)
    await db.workTask.update({ where: { id: task.id }, data: { leaseExpiresAt: new Date(0) } })
    await runWorkTask(task.id)
    expect(await fullTask(task.id)).toMatchObject({ status: 'completed', attempts: 2 })
    expect(await db.message.count()).toBe(2)
  })

  it('a failed completion transaction rolls back both messages and companion growth', async () => {
    const task = await create()
    const transaction = db.$transaction.bind(db)
    const spy = vi.spyOn(db, '$transaction').mockImplementation((operation) => transaction((tx) => operation({
      ...tx, $queryRaw: tx.$queryRaw.bind(tx), workTask: { ...tx.workTask, updateMany: (args) => {
        if (args.data.status === 'completed') throw new Error('Injected final job write failure')
        return tx.workTask.updateMany(args)
      } },
    })))
    await runWorkTask(task.id)
    spy.mockRestore()
    expect((await fullTask(task.id)).status).toBe('failed')
    expect(await db.message.count()).toBe(0)
    expect((await getCompanionState(user.id)).state.experienceCount).toBe(0)
    await retryWorkTask(user.id, task.id)
    await runWorkTask(task.id)
    expect(await db.message.count()).toBe(2)
  })

  it('background tools cannot mutate user records even through legacy text calls', async () => {
    const task = await create({ content: '添加一个日程' })
    generateResponseStream.mockImplementationOnce(async function* (_text, _persona, _history, _memories, _requestId, options) {
      expect(options.tools.some((tool) => tool.function.name === 'add_todo')).toBe(false)
      yield { type: 'done', content: '{"tool":"add_todo","args":{"content":"不应保存"}}' }
    })
    await runWorkTask(task.id)
    expect(await db.todo.count()).toBe(0)
    expect((await getWorkTask(user.id, task.id)).progress[0]).toMatchObject({ tool: 'add_todo', status: 'failed' })
  })

  it('unknown in-flight side effects pause after restart instead of replaying', async () => {
    const task = await create()
    await db.workTask.update({ where: { id: task.id }, data: {
      status: 'running', leaseToken: 'lost-owner', leaseExpiresAt: new Date(0), checkpoint: { version: 1, inFlight: 'submit_paid_generation' },
    } })
    await runWorkTask(task.id)
    expect(await fullTask(task.id)).toMatchObject({ status: 'paused', errorCode: 'WORK_TASK_UNCERTAIN' })
    expect(generateResponseStream).not.toHaveBeenCalled()
  })

  it('archived conversations and missing consent prevent work from reaching cloud or committing results', async () => {
    const task = await create()
    await db.conversation.update({ where: { id: conversation.id }, data: { archivedAt: new Date() } })
    await runWorkTask(task.id)
    expect((await fullTask(task.id)).status).toBe('failed')
    expect(generateResponseStream).not.toHaveBeenCalled()
    await db.conversation.update({ where: { id: conversation.id }, data: { archivedAt: null } })
    await retryWorkTask(user.id, task.id)
    generateResponseStream.mockImplementationOnce(async function* (_text, _persona, _history, _memories, _requestId, options) {
      await db.user.update({ where: { id: user.id }, data: { externalLlmConsent: false } })
      expect(await options.authorizeExternal()).toBe(false)
      yield { type: 'error', reason: 'CLOUD_NOT_CONSENTED' }
    })
    await runWorkTask(task.id)
    expect((await fullTask(task.id)).errorCode).toBe('CLOUD_NOT_CONSENTED')
    expect(await db.message.count()).toBe(0)
  })

  it('graceful shutdown aborts the active model and requeues the saved checkpoint', async () => {
    const task = await create()
    const entered = deferred()
    generateResponseStream.mockImplementationOnce(async function* (_text, _persona, _history, _memories, _requestId, { signal }) {
      entered.resolve()
      await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }))
      yield done
    })
    const running = runWorkTask(task.id)
    await entered.promise
    await stopWorkTaskWorker()
    await running
    expect(await fullTask(task.id)).toMatchObject({ status: 'queued', leaseToken: null, errorCode: null })
    expect(await db.message.count()).toBe(0)
  })
})
