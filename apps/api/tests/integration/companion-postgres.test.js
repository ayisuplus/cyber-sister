import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const connection = vi.hoisted(() => ({ client: null }))
vi.mock('../../src/prisma/client.js', () => ({ default: new Proxy({}, {
  get: (_, key) => typeof connection.client?.[key] === 'function' ? connection.client[key].bind(connection.client) : connection.client?.[key],
}) }))
vi.mock('../../src/services/llmService.js', async (original) => ({
  ...await original(),
  generateResponse: vi.fn(() => Promise.resolve({ content: '完成了。', emotion: 'neutral', source: 'test_model' })),
  generateResponseStream: vi.fn(async function* () { yield { type: 'done', content: '完成了。', emotion: 'neutral', source: 'test_model' } }),
  generateCompanionNote: vi.fn(() => Promise.resolve({ content: '' })),
}))
vi.mock('../../src/services/embeddingService.js', () => ({ embedQuery: () => Promise.resolve(null) }))
vi.mock('../../src/services/derivedService.js', () => ({ maybeAutoAnalyze: () => Promise.resolve({ created: 0 }) }))
import { prepareCompanionTurn, commitCompanionTurn, getCompanionState, recoverCompanionState } from '../../src/services/companionService.js'
import { sendMessage, sendMessageStream } from '../../src/services/chatService.js'
import { generateResponse, generateResponseStream } from '../../src/services/llmService.js'
import { readWorkArtifact } from '../../src/services/workArtifactService.js'

const withDatabase = process.env.TEST_DATABASE_URL ? describe : describe.skip
const databaseName = `cyber_sister_companion_test_${Date.now()}`
let admin
let db
let user
let conversation

withDatabase('companion state on isolated PostgreSQL', () => {
  beforeAll(async () => {
    if (!/^cyber_sister_companion_test_\d+$/.test(databaseName)) throw new Error('Unsafe database name')
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
    generateResponse.mockReset().mockResolvedValue({ content: '完成了。', emotion: 'neutral', source: 'test_model' })
    generateResponseStream.mockReset().mockImplementation(async function* () { yield { type: 'done', content: '完成了。', emotion: 'neutral', source: 'test_model' } })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('No live cloud in tests')))
    await db.user.deleteMany()
    user = await db.user.create({ data: { phone: '19900000001', externalLlmConsent: true, externalLlmConsentVersion: 'cloud-primary-v3' } })
    conversation = await db.conversation.create({ data: { userId: user.id } })
  })
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
  afterAll(async () => {
    await db?.$disconnect()
    if (admin) {
      await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`)
      await admin.$disconnect()
    }
  })

  it('新增字段惰性初始化，普通和流式聊天均保存经历，正式记忆不被自动创建', async () => {
    expect(user.companionState).toBe(null)
    expect((await getCompanionState(user.id)).state.experienceCount).toBe(0)
    const result = await sendMessage(conversation.id, user.id, '谢谢你')
    expect(result.aiMessage.companionExperience.revision).toBe(1)
    const events = []
    for await (const event of sendMessageStream(conversation.id, user.id, '简短一点')) events.push(event)
    expect(events.at(-1).aiMessage.companionExperience.revision).toBe(2)
    expect((await getCompanionState(user.id)).state).toMatchObject({ experienceCount: 2, learning: { samples: 1 } })
    expect(await db.message.count()).toBe(4)
    expect(await db.memory.count()).toBe(0)
  })

  it('数据库行锁合并两个旧快照的并发完成，经历和版本不丢失', async () => {
    const first = prepareCompanionTurn(user.id, user, '谢谢')
    const second = prepareCompanionTurn(user.id, user, '详细一点')
    const result = await Promise.all([
      db.$transaction((tx) => commitCompanionTurn(tx, user.id, first, [])),
      db.$transaction((tx) => commitCompanionTurn(tx, user.id, second, [])),
    ])
    expect(result.map((entry) => entry.revision).sort()).toEqual([1, 2])
    expect((await getCompanionState(user.id)).state).toMatchObject({ experienceCount: 2, trust: 0.54, learning: { samples: 1 } })
  })

  it('消息保存失败回滚已更新的角色状态和第一条消息', async () => {
    const transaction = db.$transaction.bind(db)
    vi.spyOn(db, '$transaction').mockImplementationOnce((operation) => transaction((tx) => operation({
      ...tx,
      $queryRaw: tx.$queryRaw.bind(tx),
      message: { create: (args) => {
        if (args.data.role === 'assistant') throw new Error('Injected message failure')
        return tx.message.create(args)
      } },
    })))
    await expect(sendMessage(conversation.id, user.id, '谢谢')).rejects.toThrow('Injected message failure')
    expect((await getCompanionState(user.id)).revision).toBe(0)
    expect(await db.message.count()).toBe(0)
  })

  it('提交中取消同样回滚消息和成长，不留下半轮经历', async () => {
    const controller = new AbortController()
    const transaction = db.$transaction.bind(db)
    vi.spyOn(db, '$transaction').mockImplementationOnce((operation) => transaction((tx) => operation({
      ...tx,
      $queryRaw: tx.$queryRaw.bind(tx),
      message: { create: async (args) => {
        const message = await tx.message.create(args)
        controller.abort()
        return message
      } },
    })))
    await expect(sendMessage(conversation.id, user.id, '谢谢', undefined, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect((await getCompanionState(user.id)).revision).toBe(0)
    expect(await db.message.count()).toBe(0)
  })

  it('显式恢复后旧在途回合不可覆盖恢复结果', async () => {
    const pending = prepareCompanionTurn(user.id, user, '谢谢')
    const recovered = await recoverCompanionState(user.id, 0)
    expect(await db.$transaction((tx) => commitCompanionTurn(tx, user.id, pending, []))).toMatchObject({ status: 'superseded' })
    expect(await getCompanionState(user.id)).toEqual(recovered)
  })

  it('用户之间状态隔离，删除账户只级联删除所属消息', async () => {
    const other = await db.user.create({ data: { phone: '19900000002' } })
    await sendMessage(conversation.id, user.id, '谢谢')
    expect((await getCompanionState(other.id)).revision).toBe(0)
    await db.user.delete({ where: { id: user.id } })
    await expect(getCompanionState(user.id)).rejects.toMatchObject({ statusCode: 404 })
    expect(await db.message.count()).toBe(0)
    expect((await getCompanionState(other.id)).revision).toBe(0)
  })

  const fileCall = { tool: 'create_artifact', args: { title: '验收报告', format: 'md', content: '# 报告\n合成验收数据' } }
  it('上传文件随用户消息事务提交，重新读取对话只暴露文件目录', async () => {
    await db.conversation.update({ where: { id: conversation.id }, data: { mode: 'work' } })
    const files = [{ originalname: '附件.csv', buffer: Buffer.from('item,amount\nA,42') }]
    const result = await sendMessage(conversation.id, user.id, '概述附件', undefined, { files })
    expect(result.userMessage.workArtifacts[0]).toMatchObject({ origin: 'uploaded', title: '附件' })
    expect(result.userMessage.workArtifacts[0]).not.toHaveProperty('content')
    const stored = await readWorkArtifact(user.id, result.userMessage.workArtifacts[0].id)
    expect(stored).toMatchObject({ content: files[0].buffer.toString(), encoding: 'utf8', messageId: result.userMessage.id })
    expect(await db.memory.count()).toBe(0)
  })
  it('上传文件在网页版分发、SSE 错误与取消下都不落库', async () => {
    const files = [{ originalname: '附件.csv', buffer: Buffer.from('a,42') }]
    // 2026-09 起附件不再看会话模式，只看是否本地运行时：网页版一律拒绝
    vi.stubEnv('APP_DISTRIBUTION', 'web')
    await expect(sendMessage(conversation.id, user.id, '读取', undefined, { files })).rejects.toMatchObject({ statusCode: 403, code: 'LOCAL_CLIENT_REQUIRED' })
    vi.unstubAllEnvs()
    expect(generateResponse).not.toHaveBeenCalled()
    generateResponseStream.mockImplementationOnce(async function* () { yield { type: 'error', reason: 'SYNTHETIC_FAILURE' } })
    for await (const _event of sendMessageStream(conversation.id, user.id, '读取', undefined, { files })) { /* Consume terminal failure. */ }
    expect(await db.workArtifact.count()).toBe(0)
    expect(await db.message.count()).toBe(0)
    const controller = new AbortController()
    generateResponse.mockImplementationOnce(async () => { controller.abort(); return { content: 'late' } })
    await expect(sendMessage(conversation.id, user.id, '读取', undefined, { files, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(await db.workArtifact.count()).toBe(0)
    expect((await getCompanionState(user.id)).revision).toBe(0)
  })
  async function prepareWork() {
    await db.conversation.update({ where: { id: conversation.id }, data: { mode: 'work' } })
    generateResponse.mockResolvedValueOnce({ content: JSON.stringify(fileCall), source: 'test_model' })
  }
  it('工作文件与消息、角色经历一起提交，下载按用户隔离且会话删除级联清理', async () => {
    await prepareWork()
    const result = await sendMessage(conversation.id, user.id, '生成验收报告')
    const { artifact } = result.aiMessage.toolRuns[0]
    expect(artifact).not.toHaveProperty('content')
    expect(await readWorkArtifact(user.id, artifact.id)).toMatchObject({ content: fileCall.args.content, messageId: result.aiMessage.id, conversationId: conversation.id })
    const other = await db.user.create({ data: { phone: '19900000002' } })
    await expect(readWorkArtifact(other.id, artifact.id)).rejects.toMatchObject({ statusCode: 404 })
    expect(await db.workArtifact.count()).toBe(1)
    await db.conversation.delete({ where: { id: conversation.id } })
    expect(await db.workArtifact.count()).toBe(0)
  })
  it('文件已暂存后取消，不留下消息、文件或角色成长', async () => {
    await prepareWork()
    const controller = new AbortController()
    // 第一轮暂存文件，第二轮生成时取消。
    generateResponse.mockReset().mockResolvedValueOnce({ content: JSON.stringify(fileCall), source: 'test_model' })
      .mockImplementationOnce(async () => { controller.abort(); return { content: 'late' } })
    await expect(sendMessage(conversation.id, user.id, '生成验收报告', undefined, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(await db.workArtifact.count()).toBe(0)
    expect(await db.message.count()).toBe(0)
    expect((await getCompanionState(user.id)).revision).toBe(0)
  })
  it('文件写入失败回滚同事务的两条消息和角色状态', async () => {
    await prepareWork()
    const transaction = db.$transaction.bind(db)
    vi.spyOn(db, '$transaction').mockImplementationOnce((operation) => transaction((tx) => operation({
      ...tx, $queryRaw: tx.$queryRaw.bind(tx),
      workArtifact: { createMany: () => { throw new Error('Injected artifact failure') } },
    })))
    await expect(sendMessage(conversation.id, user.id, '生成验收报告')).rejects.toThrow('Injected artifact failure')
    expect(await db.workArtifact.count()).toBe(0)
    expect(await db.message.count()).toBe(0)
    expect((await getCompanionState(user.id)).revision).toBe(0)
  })
  it('SSE 文件工具事件与最终文件引用一致，完成前没有持久化文件', async () => {
    await db.conversation.update({ where: { id: conversation.id }, data: { mode: 'work' } })
    generateResponseStream.mockImplementationOnce(async function* () { yield { type: 'toolcall', name: fileCall.tool, args: fileCall.args } })
    const events = []
    for await (const event of sendMessageStream(conversation.id, user.id, '生成验收报告')) {
      events.push(event)
      if (event.type === 'tool_progress') expect(await db.workArtifact.count()).toBe(0)
    }
    const completed = events.find((event) => event.type === 'tool_progress' && event.status === 'completed')
    expect(events.at(-1).aiMessage.toolRuns[0].artifact.id).toBe(completed.artifact.id)
    expect(await db.workArtifact.count()).toBe(1)
  })
})
