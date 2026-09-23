import { beforeAll, afterAll, beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const connection = vi.hoisted(() => ({ client: null }))
vi.mock('../../src/prisma/client.js', () => ({ default: new Proxy({}, {
  get: (_, key) => typeof connection.client?.[key] === 'function' ? connection.client[key].bind(connection.client) : connection.client?.[key],
}) }))
import { getThread, clearThread } from '../../src/services/chatService.js'
import { findLatestLetter, generateDueLetter } from '../../src/services/letterService.js'

const withDatabase = process.env.TEST_DATABASE_URL ? describe : describe.skip
const databaseName = `cyber_sister_thread_test_${Date.now()}`
let admin
let db
let user
const at = (minutes) => new Date(Date.UTC(2026, 8, 1, 8, minutes))
const addMessages = (conversationId, from, count) => db.message.createMany({
  data: Array.from({ length: count }, (_, index) => ({ conversationId, role: index % 2 ? 'assistant' : 'user', content: `第${from + index}条`, createdAt: at(from + index) })),
})

withDatabase('one thread on isolated PostgreSQL', () => {
  beforeAll(async () => {
    if (!/^cyber_sister_thread_test_\d+$/.test(databaseName)) throw new Error('Unsafe database name')
    admin = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } })
    await admin.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`)
    const url = new URL(process.env.TEST_DATABASE_URL)
    url.pathname = `/${databaseName}`
    const result = spawnSync(process.execPath, ['src/prisma/migrateDeploy.js'], {
      cwd: fileURLToPath(new URL('../../', import.meta.url)), encoding: 'utf8',
      env: { ...process.env, NODE_ENV: 'test', APP_ENV: 'development', DATABASE_URL: url.href, DATABASE_PASSWORD_FILE: '' },
    })
    if (result.status !== 0) throw new Error(`Migration failed: ${result.stdout}\n${result.stderr}`)
    db = new PrismaClient({ datasources: { db: { url: url.href } } })
    connection.client = db
  }, 60000)

  beforeEach(async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('No live cloud in tests')))
    await db.user.deleteMany()
    user = await db.user.create({ data: { phone: '19900000002', externalLlmConsent: true, externalLlmConsentVersion: 'cloud-primary-v4' } })
  })
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
  afterAll(async () => {
    await db?.$disconnect()
    if (admin) {
      await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`)
      await admin.$disconnect()
    }
  })

  it('merges legacy conversations once under overlapping opens and leaves archived ones alone', async () => {
    const older = await db.conversation.create({ data: { userId: user.id, title: '旧的', updatedAt: at(0) } })
    const recent = await db.conversation.create({ data: { userId: user.id, title: '最近的', mode: 'work', summary: '最近那段的摘要', summaryUpToAt: at(30) } })
    const archived = await db.conversation.create({ data: { userId: user.id, title: '收起来的', archivedAt: at(5) } })
    await addMessages(older.id, 0, 20)
    await addMessages(recent.id, 20, 25)
    await addMessages(archived.id, 100, 3)

    const opened = await Promise.all(Array.from({ length: 4 }, () => getThread(user.id)))

    expect(new Set(opened.map((thread) => thread.id))).toEqual(new Set([recent.id]))
    const active = await db.conversation.findMany({ where: { userId: user.id, archivedAt: null } })
    expect(active).toHaveLength(1)
    expect(active[0]).toMatchObject({ id: recent.id, mode: 'chat', summary: '最近那段的摘要' })
    // 最新 19 条之外视为已被摘要覆盖（倒数第 20 条是 at(25)），与原摘要进度 at(30) 取较晚者
    expect(active[0].summaryUpToAt).toEqual(at(30))
    expect(await db.message.count({ where: { conversationId: recent.id } })).toBe(45)
    expect(await db.message.count({ where: { conversationId: archived.id } })).toBe(3)
    expect(await db.conversation.findUnique({ where: { id: older.id } })).toBeNull()
  })

  it('creates exactly one thread for a new user and clears only its messages', async () => {
    const [first, second] = await Promise.all([getThread(user.id), getThread(user.id)])
    expect(first.id).toBe(second.id)
    expect(await db.conversation.count({ where: { userId: user.id } })).toBe(1)

    await addMessages(first.id, 0, 4)
    const archived = await db.conversation.create({ data: { userId: user.id, archivedAt: at(1) } })
    await addMessages(archived.id, 10, 2)
    await db.conversation.update({ where: { id: first.id }, data: { summary: '旧摘要', summaryUpToAt: at(1) } })

    expect(await clearThread(user.id)).toEqual({ success: true, conversationId: first.id })
    expect(await db.message.count({ where: { conversationId: first.id } })).toBe(0)
    expect(await db.message.count({ where: { conversationId: archived.id } })).toBe(2)
    expect(await db.conversation.findUnique({ where: { id: first.id } })).toMatchObject({ summary: null, summaryUpToAt: null })
  })

  it('没开写信就不写；开了到日子写一封，并发打开也只写一封', async () => {
    const thread = await getThread(user.id)
    await addMessages(thread.id, 0, 6)
    // 窗口内的近况：有一条就够写
    await db.message.createMany({
      data: [{ conversationId: thread.id, role: 'user', content: '这几天在赶方案', createdAt: new Date(Date.now() - 60_000) }],
    })

    expect(await generateDueLetter(user.id)).toMatchObject({ letter: null, created: false, reason: 'off' })

    await db.user.update({ where: { id: user.id }, data: { letterFreqDays: 3, externalLlmConsent: false } })
    const results = await Promise.all(Array.from({ length: 4 }, () => generateDueLetter(user.id)))

    expect(results.filter((result) => result.created)).toHaveLength(1)
    expect(await db.letter.count({ where: { userId: user.id } })).toBe(1)
    expect(await generateDueLetter(user.id)).toMatchObject({ created: false, reason: 'not_due' })
    expect((await findLatestLetter(user.id)).content).toBeTruthy()
  })
})
