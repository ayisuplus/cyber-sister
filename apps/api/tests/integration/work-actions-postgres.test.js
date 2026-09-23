import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import express from 'express'
import request from 'supertest'

const connection = vi.hoisted(() => ({ client: null }))
vi.mock('../../src/prisma/client.js', () => ({ default: new Proxy({}, {
  get: (_, key) => typeof connection.client?.[key] === 'function' ? connection.client[key].bind(connection.client) : connection.client?.[key],
}) }))
vi.mock('../../src/services/llmService.js', async original => ({ ...await original(), generateResponseStream: vi.fn() }))
vi.mock('../../src/services/embeddingService.js', () => ({ embedQuery: () => Promise.resolve(null) }))
vi.mock('../../src/utils/logger.js', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))

import { requestWorkAction, decideWorkAction } from '../../src/services/workActionService.js'
import { createWorkTask, getWorkTask, cancelWorkTask, runWorkTask, retryWorkTask, stopWorkTaskWorker } from '../../src/services/workTaskService.js'
import { generateResponseStream } from '../../src/services/llmService.js'
import workTaskRoutes from '../../src/routes/workTasks.js'

const withDatabase = process.env.TEST_DATABASE_URL ? describe : describe.skip
const databaseName = `cyber_sister_work_actions_test_${Date.now()}`
const payload = { url: 'https://example.com/feedback', method: 'POST', body: '{"message":"合成内容"}', contentType: 'application/json', purpose: '提交测试反馈' }
let admin, db, user, conversation, task
const waiters = []
const app = express()
app.use(express.json())
app.use((req, _res, next) => { req.user = { userId: req.get('x-test-user') }; next() })
app.use(workTaskRoutes)
function propose(value = payload, options = {}) {
  const controller = new AbortController()
  const waiting = requestWorkAction(task, value, { ...options, signal: controller.signal })
  waiting.catch(() => {})
  waiters.push({ controller, waiting })
  return waiting
}
const firstAction = () => db.workAction.findFirst({ where: { taskId: task.id }, orderBy: { createdAt: 'asc' } })
async function pending() {
  await vi.waitFor(async () => expect(await firstAction()).not.toBeNull())
  return firstAction()
}
async function confirmed() {
  const waiting = propose()
  const action = await pending()
  await decideWorkAction(user.id, task.id, action.id, 'approve')
  return { action, grant: await waiting }
}

withDatabase('one-use external approvals on isolated PostgreSQL', () => {
  beforeAll(async () => {
    if (!/^cyber_sister_work_actions_test_\d+$/.test(databaseName)) throw new Error('Unsafe database name')
    admin = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } })
    await admin.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`)
    const url = new URL(process.env.TEST_DATABASE_URL)
    url.pathname = `/${databaseName}`
    const migrated = spawnSync(process.execPath, ['src/prisma/migrateDeploy.js'], { cwd: fileURLToPath(new URL('../../', import.meta.url)),
      env: { ...process.env, NODE_ENV: 'test', APP_ENV: 'development', DATABASE_URL: url.href, DATABASE_PASSWORD_FILE: '' }, encoding: 'utf8' })
    if (migrated.status !== 0) throw new Error(`Migration failed with exit ${migrated.status}`)
    db = new PrismaClient({ datasources: { db: { url: url.href } } })
    connection.client = db
  }, 60000)
  beforeEach(async () => {
    vi.stubEnv('WORK_TASKS_ENABLED', 'true')
    vi.stubEnv('WORK_NATIVE_TOOLS', 'true')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('No live network in tests')))
    generateResponseStream.mockReset().mockImplementation(async function* () { yield { type: 'done', content: '操作结果已核对。', source: 'test_model', emotion: 'neutral' } })
    await db.user.deleteMany()
    user = await db.user.create({ data: { phone: '19900000031', externalLlmConsent: true, externalLlmConsentVersion: 'cloud-primary-v4' } })
    conversation = await db.conversation.create({ data: { userId: user.id, mode: 'work' } })
    const created = await createWorkTask(user.id, conversation.id, { content: '提交测试反馈', requestKey: 'approval-test-request' })
    task = await db.workTask.update({ where: { id: created.id }, data: { status: 'running', leaseToken: 'test-lease', leaseExpiresAt: new Date(Date.now() + 30000), attempts: 1,
      checkpoint: { version: 1, inFlight: 'browser_act', turn: { toolRuns: [] } } } })
  })
  afterEach(async () => {
    for (const waiter of waiters) waiter.controller.abort()
    await Promise.allSettled(waiters.splice(0).map(waiter => waiter.waiting))
    vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs()
  })
  afterAll(async () => {
    await stopWorkTaskWorker()
    await db?.$disconnect()
    if (admin) { await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`); await admin.$disconnect() }
  })

  it('stores concrete review data, binds bytes, and consumes a confirmation exactly once under concurrency', async () => {
    const { action, grant } = await confirmed()
    const visible = (await getWorkTask(user.id, task.id)).actions[0]
    expect(visible).toMatchObject({ ...payload, status: 'approved' })
    expect(visible).not.toHaveProperty('leaseToken')
    expect(visible).not.toHaveProperty('requestHash')
    await expect(grant.begin({ ...payload, body: 'changed' })).rejects.toMatchObject({ statusCode: 409 })
    const results = await Promise.allSettled([grant.begin(payload), grant.begin(payload)])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
    await grant.complete(201)
    expect(await firstAction()).toMatchObject({ id: action.id, status: 'completed', httpStatus: 201 })
    await expect(decideWorkAction(user.id, task.id, action.id, 'approve')).rejects.toMatchObject({ statusCode: 409 })
  })

  it('persists RunningHub IDs as strings and prevents a second generation approval in the same task', async () => {
    const waiting = propose(payload, { provider: 'runninghub' })
    const action = await pending()
    await decideWorkAction(user.id, task.id, action.id, 'approve')
    const grant = await waiting
    await grant.begin(payload)
    expect(() => grant.complete(200, 2099741730948743170)).toThrow('云端任务编号无效')
    await grant.complete(200, '2099741730948743170')
    expect((await getWorkTask(user.id, task.id)).actions[0]).toMatchObject({ provider: 'runninghub', providerTaskId: '2099741730948743170' })
    await expect(propose(payload, { provider: 'runninghub' })).rejects.toThrow('已申请过一次生图')
    await cancelWorkTask(user.id, task.id)
    expect((await firstAction()).providerTaskId).toBe('2099741730948743170')
  })

  it('runs the Agent -> approval -> cloud task -> owned PNG transaction end to end without real cloud requests', async () => {
    vi.stubEnv('RUNNINGHUB_ENABLED', 'true'); vi.stubEnv('RUNNINGHUB_API_KEY', 'synthetic-rh-key')
    await db.workTask.update({ where: { id: task.id }, data: { status: 'queued', leaseToken: null, leaseExpiresAt: null, checkpoint: { version: 1 } } })
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=', 'base64')
    const taskId = '2099741730948743170'
    const response = value => new Response(JSON.stringify(value))
    fetch.mockImplementation(async url => {
      if (url.endsWith('/task/openapi/create')) return response({ code: 0, data: { taskId } })
      if (url.endsWith('/openapi/v2/query')) {
        expect(await firstAction()).toMatchObject({ status: 'completed', providerTaskId: taskId })
        return response({ taskId, status: 'SUCCESS', results: [{ url: 'https://rh-images.xiaoyaoyou.com/test.png', outputType: 'png' }] })
      }
      if (url === 'https://rh-images.xiaoyaoyou.com/test.png') return new Response(png)
      throw new Error('Unexpected request')
    })
    generateResponseStream.mockImplementationOnce(async function* () { yield { type: 'toolcall', name: 'generate_image', args: { workflow: 'text-to-image', prompt: '合成测试插画', seed: 1 } } })
    const running = runWorkTask(task.id)
    const action = await pending()
    expect(action.provider).toBe('runninghub'); expect(fetch).not.toHaveBeenCalled()
    await decideWorkAction(user.id, task.id, action.id, 'approve')
    await running
    expect((await getWorkTask(user.id, task.id)).status).toBe('completed')
    const artifacts = await db.workArtifact.findMany({ where: { userId: user.id, conversationId: conversation.id } })
    expect(artifacts).toHaveLength(1)
    expect(Buffer.from(artifacts[0].content, 'base64')).toEqual(png)
    expect(fetch.mock.calls.filter(([url]) => url.endsWith('/task/openapi/create'))).toHaveLength(1)
  })

  it('recovery pauses an interrupted image submission and cannot replay its paid request', async () => {
    const waiting = propose(payload, { provider: 'runninghub' })
    const action = await pending()
    await decideWorkAction(user.id, task.id, action.id, 'approve')
    const grant = await waiting
    await grant.begin(payload)
    await grant.complete(200, '2099741730948743170')
    await db.workTask.update({ where: { id: task.id }, data: { leaseExpiresAt: new Date(0), checkpoint: { version: 1, inFlight: 'generate_image', turn: { toolRuns: [] } } } })
    await runWorkTask(task.id)
    expect((await getWorkTask(user.id, task.id))).toMatchObject({ status: 'paused', errorCode: 'WORK_TASK_UNCERTAIN' })
    expect(fetch).not.toHaveBeenCalled(); expect(generateResponseStream).not.toHaveBeenCalled()
    expect((await firstAction()).providerTaskId).toBe('2099741730948743170')
  })

  it('route decisions are user and task scoped; body and method supplied with a decision cannot alter the proposal', async () => {
    const waiting = propose()
    const action = await pending()
    expect((await request(app).post(`/tasks/${task.id}/actions/${action.id}`).set('x-test-user', 'foreign').send({ decision: 'approve' })).status).toBe(404)
    expect((await request(app).post(`/tasks/another/actions/${action.id}`).set('x-test-user', user.id).send({ decision: 'approve' })).status).toBe(404)
    const response = await request(app).post(`/tasks/${task.id}/actions/${action.id}`).set('x-test-user', user.id).send({ decision: 'approve', body: 'changed', method: 'DELETE' })
    expect(response.status).toBe(200)
    expect(response.body.task.actions[0]).toMatchObject({ body: payload.body, method: 'POST', status: 'approved' })
    await (await waiting).begin(payload)
  })

  it('cancelling while waiting invalidates approvals and prevents late consumption', async () => {
    const waiting = propose()
    const action = await pending()
    await cancelWorkTask(user.id, task.id)
    await expect(waiting).rejects.toMatchObject({ statusCode: 403 })
    expect(await firstAction()).toMatchObject({ status: 'cancelled', submittedAt: null })
    await expect(decideWorkAction(user.id, task.id, action.id, 'approve')).rejects.toMatchObject({ statusCode: 409 })
    expect(await db.message.count()).toBe(0)
  })

  it('expiry and rejection cannot be converted into permission', async () => {
    const waiting = propose()
    const action = await pending()
    await expect(decideWorkAction(user.id, task.id, action.id, 'yes')).rejects.toMatchObject({ statusCode: 400 })
    await db.workAction.update({ where: { id: action.id }, data: { expiresAt: new Date(Date.now() - 1) } })
    await expect(decideWorkAction(user.id, task.id, action.id, 'approve')).rejects.toMatchObject({ statusCode: 409 })
    await expect(waiting).rejects.toMatchObject({ statusCode: 403 })
    expect((await firstAction()).status).toBe('expired')
  })

  it('a rejection prevents repeated write proposals in the same task', async () => {
    const waiting = propose()
    const action = await pending()
    await decideWorkAction(user.id, task.id, action.id, 'reject')
    await expect(waiting).rejects.toMatchObject({ statusCode: 403 })
    await expect(propose({ ...payload, body: 'another proposal' })).rejects.toMatchObject({ statusCode: 403 })
    expect(await db.workAction.count()).toBe(1)
  })

  it('a replaced lease cannot consume an otherwise approved request', async () => {
    const { grant } = await confirmed()
    await db.workTask.update({ where: { id: task.id }, data: { leaseToken: 'replacement' } })
    await expect(grant.begin(payload)).rejects.toMatchObject({ statusCode: 409 })
    expect((await firstAction()).submittedAt).toBeNull()
  })

  it('checks expiry again atomically at dispatch, after the approval has already been observed', async () => {
    const { action, grant } = await confirmed()
    await db.workAction.update({ where: { id: action.id }, data: { expiresAt: new Date(Date.now() - 1) } })
    await expect(grant.begin(payload)).rejects.toMatchObject({ statusCode: 409 })
    expect((await firstAction()).submittedAt).toBeNull()
  })

  it.each(['executing', 'completed'])('recovery pauses %s submissions before the completed tool checkpoint; no model replay', async status => {
    const { grant } = await confirmed()
    await grant.begin(payload)
    if (status === 'completed') await grant.complete(200)
    await db.workTask.update({ where: { id: task.id }, data: { leaseExpiresAt: new Date(Date.now() - 1) } })
    await runWorkTask(task.id)
    expect(await getWorkTask(user.id, task.id)).toMatchObject({ status: 'paused', errorCode: 'WORK_TASK_UNCERTAIN' })
    expect(generateResponseStream).not.toHaveBeenCalled()
    await expect(retryWorkTask(user.id, task.id)).rejects.toMatchObject({ statusCode: 409 })
    expect(await db.message.count()).toBe(0)
  })

  it('a completed tool checkpoint can resume and commit without resubmitting the external action', async () => {
    const { grant } = await confirmed()
    await grant.begin(payload); await grant.complete(200)
    await db.workTask.update({ where: { id: task.id }, data: { leaseExpiresAt: new Date(Date.now() - 1),
      checkpoint: { version: 1, inFlight: null, turn: { rounds: 1, stalledRounds: 0, history: [], artifacts: [], executedCalls: [], toolRuns: [{ tool: 'browser_act', ok: true, summary: '已提交' }] } } } })
    await runWorkTask(task.id)
    expect((await getWorkTask(user.id, task.id)).status).toBe('completed')
    expect(await db.workAction.count()).toBe(1)
    expect(generateResponseStream).toHaveBeenCalledOnce()
    expect(await db.message.count()).toBe(2)
    expect(await db.memory.count()).toBe(0)
  })

  it('cancellation during a dispatched request preserves uncertainty and audit data', async () => {
    const { grant } = await confirmed()
    await grant.begin(payload)
    await cancelWorkTask(user.id, task.id)
    await expect(grant.complete(200)).rejects.toMatchObject({ statusCode: 409 })
    expect(await firstAction()).toMatchObject({ status: 'uncertain', body: payload.body })
    expect((await getWorkTask(user.id, task.id)).status).toBe('cancelled')
  })
})
