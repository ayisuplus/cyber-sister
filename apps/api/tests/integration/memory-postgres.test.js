import { beforeAll, afterAll, beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const connection = vi.hoisted(() => ({ client: null }))
vi.mock('../../src/prisma/client.js', () => ({ default: new Proxy({}, {
  get: (_, key) => typeof connection.client?.[key] === 'function' ? connection.client[key].bind(connection.client) : connection.client?.[key],
}) }))
import { createMemory, updateMemory, deleteMemory } from '../../src/services/memoryService.js'
import { deriveEdges } from '../../src/services/edgeService.js'
import { embedMemory } from '../../src/services/embeddingService.js'
import { createIndexJob, cancelIndexJob, runIndexJob, startMemoryIndexWorker, stopMemoryIndexWorker } from '../../src/services/memoryIndexService.js'
import { exportMemoryBundle, previewMemoryImport, applyMemoryImport } from '../../src/services/memoryTransferService.js'
import { applyImport, previewImport } from '../../src/services/importService.js'
import { retrieveRelevantMemories, buildMemoryContext } from '../../src/services/llmService.js'
import * as llm from '../../src/services/llmService.js'
import { migrateUserPlans } from '../../src/services/planMigrationService.js'
import { listDueReminders, updateScheduledReminder } from '../../src/services/reminderService.js'
import { dedupeKeyOf, saveInferences } from '../../src/services/memory/inferenceService.js'
import { collectDrafts } from '../../src/services/letterService.js'
import { decideSuggestion } from '../../src/services/memory/proposalService.js'
import { embeddingRow, loadVectors, saveEmbedding } from '../../src/services/vectors/vectorStore.js'
import { contentVersion, identityKeyOf } from '../../src/services/vectors/identity.js'
import { forgetShelf, searchUserBooks } from '../../src/services/bookIndexService.js'
import { deleteBook } from '../../src/services/readingService.js'
import { readFileSync } from 'node:fs'

const withDatabase = process.env.TEST_DATABASE_URL ? describe : describe.skip
const databaseName = `cyber_sister_memory_test_${Date.now()}`
let admin
let db
let user
const create = (content = '喜欢周末爬山') => createMemory(user.id, { type: 'semantic', content }, { projectEmbedding: false })

withDatabase('memory governance on isolated PostgreSQL', () => {
  beforeAll(async () => {
    if (!/^cyber_sister_memory_test_\d+$/.test(databaseName)) throw new Error('Unsafe database name')
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
    vi.stubEnv('MEMORY_EMBEDDING_BASE_URL', '')
    await db.user.deleteMany()
    user = await db.user.create({ data: { phone: '19900000001', externalLlmConsent: true, externalLlmConsentVersion: 'cloud-primary-v4' } })
  })
  afterEach(() => { stopMemoryIndexWorker(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs() })
  afterAll(async () => {
    await db?.$disconnect()
    if (admin) {
      await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`)
      await admin.$disconnect()
    }
  })

  it('claims a legacy-plan migration once under overlapping calls and preserves source records', async () => {
    await db.habit.create({ data: { userId: user.id, name: '迁移测试散步', icon: 'droplet' } })
    const results = await Promise.all(Array.from({ length: 4 }, () => migrateUserPlans(user.id)))
    expect(results.filter(result => !result.skipped)).toHaveLength(1)
    expect(await db.scheduledReminder.count({ where: { userId: user.id } })).toBe(1)
    expect(await db.habit.count({ where: { userId: user.id } })).toBe(1)
    expect(await migrateUserPlans(user.id)).toMatchObject({ skipped: true, created: 0 })
  })

  it('hides pending deliveries after ending a recurring series, including a late insert', async () => {
    const fireAt = new Date('2026-09-01T08:00:00Z')
    const reminder = await db.scheduledReminder.create({ data: {
      userId: user.id, content: '系列结束测试', freq: 'daily', time: '08:00', nextFireAt: fireAt,
    } })
    expect(await listDueReminders(user.id, fireAt)).toHaveLength(1)
    await updateScheduledReminder(reminder.id, user.id, { status: 'done' })
    const late = await db.reminderDelivery.create({ data: { reminderId: reminder.id, fireAt: new Date('2026-09-02T08:00:00Z') } })
    expect(await listDueReminders(user.id, new Date('2026-09-03T08:00:00Z'))).toEqual([])
    expect(await db.reminderDelivery.count({ where: { reminderId: reminder.id } })).toBe(2)
    await db.reminderDelivery.update({ where: { id: late.id }, data: { result: '已生成的历史产出' } })
    expect(await listDueReminders(user.id)).toMatchObject([{ id: late.id, result: '已生成的历史产出' }])
  })

  it('rolls back the migration claim on insert failure so a retry can succeed', async () => {
    await db.habit.create({ data: { userId: user.id, name: '迁移重试散步', icon: 'droplet' } })
    // The trigger only exists in this test-created database.
    await db.$executeRawUnsafe("CREATE FUNCTION reject_plan_insert() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'injected plan failure'; END; $$ LANGUAGE plpgsql")
    await db.$executeRawUnsafe('CREATE TRIGGER reject_plan BEFORE INSERT ON scheduled_reminders FOR EACH ROW EXECUTE FUNCTION reject_plan_insert()')
    try {
      await expect(migrateUserPlans(user.id)).rejects.toThrow()
      expect((await db.user.findUnique({ where: { id: user.id } })).plansMigratedAt).toBeNull()
      expect(await db.scheduledReminder.count({ where: { userId: user.id } })).toBe(0)
    } finally {
      await db.$executeRawUnsafe('DROP TRIGGER reject_plan ON scheduled_reminders')
      await db.$executeRawUnsafe('DROP FUNCTION reject_plan_insert()')
    }
    expect(await migrateUserPlans(user.id)).toMatchObject({ skipped: false, created: 1 })
  })

  it('previews a plan migration without claiming the user or inserting tasks', async () => {
    await db.habit.create({ data: { userId: user.id, name: '迁移预览散步', icon: 'droplet' } })
    expect(await migrateUserPlans(user.id, { dryRun: true })).toMatchObject({ created: 1, dryRun: true })
    expect((await db.user.findUnique({ where: { id: user.id } })).plansMigratedAt).toBeNull()
    expect(await db.scheduledReminder.count({ where: { userId: user.id } })).toBe(0)
  })

  it('creates a baseline and rejects concurrent edits', async () => {
    const memory = await create()
    expect(memory.revision).toBe(1)
    const result = await Promise.allSettled([
      updateMemory(user.id, memory.id, { content: '现在喜欢游泳', expectedRevision: 1 }),
      updateMemory(user.id, memory.id, { content: '现在喜欢阅读', expectedRevision: 1 }),
    ])
    expect(result.filter((item) => item.status === 'fulfilled')).toHaveLength(1)
    expect(result.find((item) => item.status === 'rejected').reason.statusCode).toBe(409)
    const changed = await updateMemory(user.id, memory.id, { content: '后来又变了', expectedRevision: 2 })
    expect(changed).toMatchObject({ content: '后来又变了', revision: 3 })
    expect(changed).not.toHaveProperty('projection')
  })

  it('rejects forged quotes and another user’s source', async () => {
    const other = await db.user.create({ data: { phone: '19900000002' } })
    const foreign = await createMemory(other.id, { type: 'semantic', content: '其他人的内容' }, { projectEmbedding: false })
    await expect(createMemory(user.id, { type: 'semantic', content: '伪造', sources: [{ type: 'memory', id: foreign.id, revision: 1, quote: foreign.content }] })).rejects.toMatchObject({ statusCode: 409 })
    const memory = await create()
    await expect(createMemory(user.id, { type: 'semantic', content: '伪造', sources: [{ type: 'memory', id: memory.id, revision: 1, quote: '不存在的依据' }] })).rejects.toMatchObject({ statusCode: 409 })
    expect(await db.memory.count({ where: { userId: user.id } })).toBe(1)
  })

  it('rolls back a formal write if recording its revision fails', async () => {
    await db.$executeRawUnsafe(`CREATE FUNCTION reject_test_revision() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected revision failure'; END; $$`)
    await db.$executeRawUnsafe(`CREATE TRIGGER reject_test_revision BEFORE INSERT ON memory_revisions FOR EACH ROW EXECUTE FUNCTION reject_test_revision()`)
    try {
      await expect(create()).rejects.toThrow()
      expect(await db.memory.count()).toBe(0)
    } finally {
      await db.$executeRawUnsafe('DROP TRIGGER reject_test_revision ON memory_revisions')
      await db.$executeRawUnsafe('DROP FUNCTION reject_test_revision()')
    }
  })

  /** 她整理出的一条关系（组织层，路线图 C23）。 */
  async function relationBetween(a, b, relation = 'related') {
    await saveInferences(user.id, [{
      kind: 'relation', content: `「${a.content}」与「${b.content}」有关`,
      payload: { fromMemoryId: a.id, toMemoryId: b.id, relation, confidence: 'high' },
      basis: [{ type: 'memory', id: a.id, revision: a.revision, quote: a.content, status: 'verified' }],
      basisMemoryIds: [a.id, b.id],
    }], { producedBy: 'test' })
    return db.inference.findFirst({ where: { userId: user.id, kind: 'relation' }, orderBy: { createdAt: 'desc' } })
  }

  it('根的意思被改，靠它的关系作废；只改重要度不作废（路线图 C23）', async () => {
    const a = await create('喜欢爬山')
    const b = await create('周末外出')
    const relation = await relationBetween(a, b)
    await updateMemory(user.id, a.id, { importance: 9, expectedRevision: 1 })
    expect(await db.inference.findUnique({ where: { id: relation.id } })).toMatchObject({ status: 'active' })
    await updateMemory(user.id, a.id, { content: '最近更喜欢室内阅读', expectedRevision: 2 })
    expect(await db.inference.findUnique({ where: { id: relation.id } })).toMatchObject({ status: 'stale' })
    // 旧关系表已只读：不再有写入
    expect(await db.memoryEdge.count()).toBe(0)
  })

  it('同一条关系只存一行：换个方向、并发两次都一样（唯一约束兜底）', async () => {
    const a = await create('喜欢爬山')
    const b = await create('周末外出')
    const item = (from, to) => ({
      kind: 'relation', content: '有关', payload: { fromMemoryId: from.id, toMemoryId: to.id, relation: 'related' }, basisMemoryIds: [from.id, to.id],
    })
    const results = await Promise.all([saveInferences(user.id, [item(a, b)], { producedBy: 'test' }), saveInferences(user.id, [item(b, a)], { producedBy: 'test' })])
    expect(results.reduce((sum, result) => sum + result.created, 0)).toBe(1)
    expect(await db.inference.count({ where: { userId: user.id } })).toBe(1)
  })

  function enableEmbeddings() {
    vi.stubEnv('MEMORY_EMBEDDING_BASE_URL', 'https://embedding.invalid/v1')
    vi.stubEnv('MEMORY_EMBEDDING_MODEL', 'test-embedding')
    vi.stubEnv('MEMORY_EMBEDDING_DIMENSIONS', '2')
    vi.stubEnv('MEMORY_EMBEDDING_API_KEY', 'synthetic-test-key')
  }

  it('does not revive deleted memory when its vector arrives late', async () => {
    const memory = await create()
    enableEmbeddings()
    let complete
    fetch.mockImplementation(() => new Promise((resolve) => { complete = resolve }))
    const pending = embedMemory({ ...memory, userId: user.id })
    await vi.waitFor(() => expect(complete).toBeTypeOf('function'))
    await deleteMemory(user.id, memory.id)
    complete({ ok: true, json: async () => ({ data: [{ embedding: [1, 0] }] }) })
    expect(await pending).toBe(false)
    expect(await db.embedding.count()).toBe(0)
    expect(await db.memoryRevision.count()).toBe(0)
  })

  it('deduplicates index jobs, supports cancellation and marks restarted jobs interrupted', async () => {
    await create()
    enableEmbeddings()
    const [a, b] = await Promise.all([createIndexJob(user.id), createIndexJob(user.id)])
    expect(a.id).toBe(b.id)
    const other = await db.user.create({ data: { phone: '19900000004' } })
    await expect(cancelIndexJob(other.id, a.id)).rejects.toMatchObject({ statusCode: 404 })
    await cancelIndexJob(user.id, a.id)
    await runIndexJob(a.id)
    expect(fetch).not.toHaveBeenCalled()
    const next = await createIndexJob(user.id)
    await db.memoryIndexJob.update({ where: { id: next.id }, data: { status: 'running' } })
    await startMemoryIndexWorker()
    expect(await db.memoryIndexJob.findUnique({ where: { id: next.id } })).toMatchObject({ status: 'interrupted' })
  })

  it('round-trips formal revisions and confirmed relations, without projections or duplicate imports', async () => {
    const a = await create('偏爱蓝色')
    const b = await create('常穿蓝色外套')
    const updated = await updateMemory(user.id, a.id, { importance: 8, expectedRevision: 1 })
    await relationBetween({ ...a, revision: updated.revision }, b)
    const bundle = await exportMemoryBundle(user.id)
    expect(JSON.stringify(bundle)).not.toContain('embedding')
    expect(JSON.stringify(bundle)).not.toContain('vector')
    const recipient = await db.user.create({ data: { phone: '19900000003' } })
    const payload = { bundle, selectedIds: bundle.memories.map((item) => item.id), selectedEdgeIds: bundle.edges.map((item) => item.id) }
    expect(await previewMemoryImport(recipient.id, bundle)).toMatchObject({ memories: [{ state: 'new' }, { state: 'new' }] })
    expect(await applyMemoryImport(recipient.id, payload)).toMatchObject({ memoriesApplied: 2, edgesApplied: 1 })
    expect(await applyMemoryImport(recipient.id, payload)).toMatchObject({ memoriesApplied: 0, edgesApplied: 0 })
    const restored = await exportMemoryBundle(recipient.id)
    expect(restored.memories.map((item) => [item.id, item.content, item.revision]).sort()).toEqual(bundle.memories.map((item) => [item.id, item.content, item.revision]).sort())
    expect(restored.memories.flatMap((item) => item.revisions.map((revision) => revision.content))).toHaveLength(3)
    // 有效的关系在包里写作 canonical（v2 格式不变），导入后进对方她的组织层
    expect(restored.edges[0]).toMatchObject({ from: bundle.edges[0].from, to: bundle.edges[0].to, relation: 'related', status: 'canonical' })
    expect(await db.inference.count({ where: { userId: recipient.id, kind: 'relation', status: 'active', producedBy: 'import' } })).toBe(1)
    expect(restored.edges[0].evidence).toEqual([{ type: 'memory', id: a.portableId, revision: 2, quote: a.content, status: 'imported' }])
    expect((await db.user.findUnique({ where: { id: recipient.id } })).externalLlmConsent).toBeNull()
    const imported = await db.memory.findFirst({ where: { userId: recipient.id } })
    await updateMemory(recipient.id, imported.id, { content: '已经由用户修正', expectedRevision: imported.revision })
    await expect(applyMemoryImport(recipient.id, payload)).rejects.toMatchObject({ statusCode: 409 })
    expect(await db.memory.count({ where: { userId: recipient.id } })).toBe(2)
  })

  it('rolls back an import with invalid relationship selection and marks missing external sources', async () => {
    const memory = await create()
    const bundle = await exportMemoryBundle(user.id)
    bundle.memories[0].sources = [{ type: 'message', id: 'foreign-message', quote: '包内声明的原话' }]
    bundle.memories[0].revisions[0].sources = bundle.memories[0].sources
    const recipient = await db.user.create({ data: { phone: '19900000003' } })
    const payload = { bundle, selectedIds: [memory.portableId], selectedEdgeIds: ['missing-edge'] }
    await expect(applyMemoryImport(recipient.id, payload)).rejects.toMatchObject({ statusCode: 400 })
    expect(await db.memory.count({ where: { userId: recipient.id } })).toBe(0)
    await applyMemoryImport(recipient.id, { ...payload, selectedEdgeIds: [] })
    const imported = await db.memory.findFirst({ where: { userId: recipient.id } })
    expect(imported.sources).toEqual([{ type: 'message', status: 'missing', quote: '包内声明的原话' }])
  })

  const IDENTITY = { provider: 'https://embedding.invalid/v1', model: 'test-embedding', dimensions: 2, ruleVersion: 1 }
  const storeVector = (memory, vector, identity = IDENTITY, text = memory.content) => saveEmbedding(db, embeddingRow({
    userId: user.id, subjectType: 'memory', subjectId: memory.id, text, identity, vector,
  }))
  const withVectors = async (memories, identity = IDENTITY) => {
    const vectors = await loadVectors(user.id, 'memory', identity)
    return memories.map((memory) => ({ ...memory, semantic: vectors.get(memory.id) ?? null }))
  }

  it('retains a valid vector on rebuild failure; vectors from another model or older text are not used (路线图 C23)', async () => {
    const memory = await create('周末徒步')
    enableEmbeddings()
    await storeVector(memory, [1, 0])
    const job = await createIndexJob(user.id, { mode: 'rebuild' })
    await runIndexJob(job.id)
    expect(await db.embedding.count()).toBe(1)
    expect(await db.memoryIndexJob.findUnique({ where: { id: job.id } })).toMatchObject({ status: 'completed', failed: 1 })

    const query = { ...IDENTITY, vector: [1, 0] }
    const [current] = await withVectors([await db.memory.findFirst()])
    expect(retrieveRelevantMemories('外出', [current], query)).toHaveLength(1)
    // 查询是另一个模型算的
    expect(retrieveRelevantMemories('外出', [current], { ...query, model: 'other-model' })).toEqual([])
    // 向量是旧正文算的
    expect(retrieveRelevantMemories('外出', [{ ...current, semantic: { ...current.semantic, version: contentVersion('以前的正文') } }], query)).toEqual([])
    // 关键词照样找得到
    expect(retrieveRelevantMemories('徒步', [{ ...current, semantic: null }], query)).toHaveLength(1)
  })

  it('imports v1 concurrently once and rolls back persona changes when formal history cannot be saved', async () => {
    const legacy = { version: 1, product: 'Amie cyber-sister', memories: [{ type: 'semantic', content: '旧包里的正式偏好' }] }
    const preview = await previewImport(user.id, legacy)
    const payload = { memories: preview.memoryCandidates, expectedMemoryEpoch: preview.memoryEpoch }
    const results = await Promise.allSettled([applyImport(user.id, payload), applyImport(user.id, payload)])
    expect(results.filter((item) => item.status === 'fulfilled')).toHaveLength(1)
    expect(results.find((item) => item.status === 'rejected').reason.statusCode).toBe(409)
    const refreshed = await previewImport(user.id, legacy)
    expect(await applyImport(user.id, { ...payload, expectedMemoryEpoch: refreshed.memoryEpoch })).toMatchObject({ memoriesApplied: 0, memoriesSkipped: 1 })
    expect(await db.memoryRevision.count()).toBe(1)
    const original = await db.user.findUnique({ where: { id: user.id } })
    await db.$executeRawUnsafe(`CREATE FUNCTION reject_import_revision() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected import failure'; END; $$`)
    await db.$executeRawUnsafe(`CREATE TRIGGER reject_import_revision BEFORE INSERT ON memory_revisions FOR EACH ROW EXECUTE FUNCTION reject_import_revision()`)
    try {
      await expect(applyImport(user.id, { expectedMemoryEpoch: original.memoryEpoch, persona: original.persona === 'toxic' ? 'gentle' : 'toxic', memories: [{ type: 'semantic', content: '不能半完成' }] })).rejects.toThrow()
      expect((await db.user.findUnique({ where: { id: user.id } })).persona).toBe(original.persona)
      expect(await db.memory.count()).toBe(1)
    } finally {
      await db.$executeRawUnsafe('DROP TRIGGER reject_import_revision ON memory_revisions')
      await db.$executeRawUnsafe('DROP FUNCTION reject_import_revision()')
    }
  })

  it('detects different history despite identical current content and rejects malformed v2 records', async () => {
    const memory = await create('以前喜欢茶')
    await updateMemory(user.id, memory.id, { content: '现在喜欢咖啡', expectedRevision: 1 })
    const bundle = await exportMemoryBundle(user.id)
    bundle.memories[0].revisions[0].content = '伪造的早期经历'
    expect((await previewMemoryImport(user.id, bundle)).memories[0].state).toBe('conflict')
    await expect(applyMemoryImport(user.id, { bundle, selectedIds: [memory.portableId] })).rejects.toMatchObject({ statusCode: 409 })
    await expect(previewMemoryImport(user.id, { version: 2, memories: [null], edges: [] })).rejects.toMatchObject({ statusCode: 400 })
    bundle.memories[0].revisions[0] = null
    await expect(previewMemoryImport(user.id, bundle)).rejects.toMatchObject({ statusCode: 400 })
  })

  it('rejects a stale import preview after deletion, while allowing a fresh explicit restore from the package', async () => {
    const memory = await create('可以从备份恢复的合成内容')
    const bundle = await exportMemoryBundle(user.id)
    const preview = await previewImport(user.id, { version: 2, product: 'Amie cyber-sister', memoryBundle: bundle })
    const payload = { memoryBundle: bundle, selectedIds: [memory.portableId], expectedMemoryEpoch: preview.memoryEpoch }
    await deleteMemory(user.id, memory.id)
    await expect(applyImport(user.id, payload)).rejects.toMatchObject({ statusCode: 409 })
    expect(await db.memory.count()).toBe(0)
    const refreshed = await previewImport(user.id, { version: 2, product: 'Amie cyber-sister', memoryBundle: bundle })
    expect(await applyImport(user.id, { ...payload, expectedMemoryEpoch: refreshed.memoryEpoch })).toMatchObject({ memoriesApplied: 1 })
  })

  it('removes deleted memory dependencies and reference copies without erasing other formal history', async () => {
    const source = await create('原始偏好')
    const sources = [{ type: 'memory', id: source.id, revision: 1, quote: source.content }]
    const dependent = await createMemory(user.id, { type: 'semantic', content: '用户另外确认的内容', sources }, { projectEmbedding: false })
    await db.derivedInsight.create({ data: { userId: user.id, kind: 'pattern', content: '靠这条来源的草稿', sources, sourceMemoryIds: [source.id] } })
    await db.memoryEdge.create({ data: { userId: user.id, fromMemoryId: source.id, toMemoryId: dependent.id, relation: 'related' } })
    await relationBetween(source, dependent)
    await saveInferences(user.id, [{ kind: 'insight', content: '靠这条来源的猜测', basis: sources, basisMemoryIds: [source.id] }], { producedBy: 'test' })
    await deleteMemory(user.id, source.id)
    // 她的组织层连同引文一起删；只读的旧表也照样清掉
    expect(await db.inference.count()).toBe(0)
    expect(await db.derivedInsight.count()).toBe(0)
    expect(await db.memoryEdge.count()).toBe(0)
    const preserved = await db.memory.findUnique({ where: { id: dependent.id }, include: { revisions: true } })
    expect(preserved).toMatchObject({ content: dependent.content, sources: [], sourceRef: null, revision: 1 })
    expect(preserved.revisions).toHaveLength(1)
    expect(preserved.revisions[0].sources).toEqual([])
  })

  it('改了来源记忆，靠它推出的理解作废，不再进信（路线图 C23，改变 09-23「待重审进信」的做法）', async () => {
    const source = await create('喜欢去图书馆')
    await saveInferences(user.id, [{ kind: 'insight', content: '爱读书', payload: { category: 'pattern' },
      basis: [{ type: 'memory', id: source.id, revision: 1, quote: source.content }], basisMemoryIds: [source.id] }], { producedBy: 'test' })
    expect((await collectDrafts(user.id)).insights.map((item) => item.content)).toEqual(['爱读书'])
    await updateMemory(user.id, source.id, { type: 'episodic', expectedRevision: 1 })
    expect(await db.inference.findFirst({ where: { userId: user.id, kind: 'insight' } })).toMatchObject({ status: 'stale' })
    expect((await collectDrafts(user.id)).insights).toEqual([])
    expect(fetch).not.toHaveBeenCalled()
  })

  /** 一封带一条建议的信。 */
  const letterWith = (suggestion) => db.letter.create({ data: {
    userId: user.id, periodStart: new Date('2026-09-20T00:00:00.000Z'), freqDays: 7, content: '见信好。', suggestions: [{ decided: null, ...suggestion }],
  } })
  const mergeOf = (a, b, relation) => ({ kind: 'merge_memories', title: '是一回事', suggestText: '我喜欢吃火锅', inferenceIds: [relation.id],
    pair: [{ id: a.id, revision: a.revision, content: a.content }, { id: b.id, revision: b.revision, content: b.content }] })

  it('采纳合并：一个事务里改第一条、删第二条，写根的那一版带来源链（路线图 C23）', async () => {
    const a = await create('喜欢火锅')
    const b = await create('爱吃火锅')
    const relation = await relationBetween(a, b, 'similar')
    const letter = await letterWith(mergeOf(a, b, relation))

    const result = await decideSuggestion(user.id, letter.id, '0', { decision: 'accept' })

    expect(result.letter.suggestions[0].decided).toBe('accepted')
    const merged = await db.memory.findUnique({ where: { id: a.id }, include: { revisions: { orderBy: { revision: 'asc' } } } })
    expect(merged).toMatchObject({ content: '我喜欢吃火锅', revision: 2 })
    expect(merged.revisions[1]).toMatchObject({
      action: 'accept_suggestion', proposal: { letterId: letter.id, index: 0, kind: 'merge_memories', inferenceIds: [relation.id] },
    })
    expect(merged.revisions[0].proposal).toBeNull()
    expect(await db.memory.findUnique({ where: { id: b.id } })).toBeNull()
  })

  it('采纳中途失败整体回滚：第二条在别处改过，第一条不改、建议不写回、依据的关系仍有效', async () => {
    const a = await create('喜欢火锅')
    const b = await create('爱吃火锅')
    const relation = await relationBetween(a, b, 'similar')
    const letter = await letterWith(mergeOf(a, b, relation))
    // 信写好之后你在别处给第二条改了重要度：意思没变，关系仍有效，但版本变了
    await updateMemory(user.id, b.id, { importance: 9, expectedRevision: 1 })

    await expect(decideSuggestion(user.id, letter.id, '0', { decision: 'accept' })).rejects.toMatchObject({ statusCode: 409 })

    expect(await db.memory.findUnique({ where: { id: a.id } })).toMatchObject({ content: '喜欢火锅', revision: 1 })
    expect(await db.memoryRevision.count({ where: { memoryId: a.id } })).toBe(1)
    expect(await db.memory.findUnique({ where: { id: b.id } })).toMatchObject({ revision: 2 })
    expect((await db.letter.findUnique({ where: { id: letter.id } })).suggestions[0].decided).toBeNull()
    expect(await db.inference.findUnique({ where: { id: relation.id } })).toMatchObject({ status: 'active', outcome: null })
  })

  it('把她猜的记下来：新建一条根，来源是她当时引的原话，那条理解结束为采纳', async () => {
    const conversation = await db.conversation.create({ data: { userId: user.id, title: 'Amie' } })
    const message = await db.message.create({ data: { conversationId: conversation.id, role: 'user', content: '又是凌晨三点还醒着，明天还要考试' } })
    await saveInferences(user.id, [{ kind: 'insight', content: '你一紧张就睡不着', payload: { category: 'pattern' },
      basis: [{ type: 'message', id: message.id, quote: '又是凌晨三点还醒着', status: 'verified' }] }], { producedBy: 'test' })
    const insight = await db.inference.findFirst({ where: { userId: user.id, kind: 'insight' } })
    const letter = await letterWith({ kind: 'promote_inference', title: '记下来吧', quote: '又是凌晨三点还醒着', suggestText: '我一紧张就睡不着', inferenceIds: [insight.id] })

    await decideSuggestion(user.id, letter.id, '0', { decision: 'accept' })

    const remembered = await db.memory.findFirst({ where: { userId: user.id, content: '我一紧张就睡不着' }, include: { revisions: true } })
    expect(remembered).toMatchObject({ origin: 'promoted', sources: [{ type: 'message', id: message.id, quote: '又是凌晨三点还醒着', status: 'verified' }] })
    expect(remembered.revisions[0]).toMatchObject({ action: 'accept_suggestion', proposal: expect.objectContaining({ kind: 'promote_inference', inferenceIds: [insight.id] }) })
    expect(await db.inference.findUnique({ where: { id: insight.id } })).toMatchObject({ status: 'closed', outcome: 'accepted', proposedIn: { letterId: letter.id, index: 0 } })
  })

  it('定夺矛盾选「都对，不用改」：关系结束为不用，她不会再推出同一条', async () => {
    const a = await create('想独居')
    const b = await create('想合住')
    const relation = await relationBetween(a, b, 'contradicts')
    const letter = await letterWith({ kind: 'resolve_conflict', title: '对不上', suggestText: '', inferenceIds: [relation.id],
      pair: [{ id: a.id, revision: 1, content: a.content }, { id: b.id, revision: 1, content: b.content }] })

    await decideSuggestion(user.id, letter.id, '0', { decision: 'dismiss' })

    expect(await db.inference.findUnique({ where: { id: relation.id } })).toMatchObject({ status: 'closed', outcome: 'declined' })
    expect(await db.memory.count({ where: { userId: user.id } })).toBe(2)
    const again = await saveInferences(user.id, [{ kind: 'relation', content: '又推出来了',
      payload: { fromMemoryId: b.id, toMemoryId: a.id, relation: 'contradicts' }, basisMemoryIds: [a.id, b.id] }], { producedBy: 'test' })
    expect(again).toMatchObject({ created: 0, revived: 0 })
  })

  it('迁移把三张旧表搬进组织层：状态对应、去重键与 JS 同一口径、重复执行不重复（路线图 C23）', async () => {
    const a = await create('喜欢  火锅')
    const b = await create('每周五吃火锅')
    await db.memoryEdge.createMany({ data: [
      { userId: user.id, fromMemoryId: b.id, toMemoryId: a.id, relation: 'similar', status: 'canonical' },
      { userId: user.id, fromMemoryId: a.id, toMemoryId: b.id, relation: 'similar', status: 'derived' },
      { userId: user.id, fromMemoryId: a.id, toMemoryId: b.id, relation: 'contradicts', status: 'needs_review' },
    ] })
    await db.derivedInsight.createMany({ data: [
      { userId: user.id, kind: 'pattern', content: '你 常熬夜', status: 'active', sourceMemoryIds: [a.id] },
      { userId: user.id, kind: 'summary', content: '被你忽略过的', status: 'dismissed' },
      { userId: user.id, kind: 'summary', content: '进过信的', status: 'dismissed', resolution: 'lettered:2026-09-20T00:00:00.000Z' },
    ] })
    await db.followUp.createMany({ data: [
      { userId: user.id, about: '周三 答辩', ask: '答辩怎么样了？', askOn: new Date('2026-09-24T00:00:00.000Z'), status: 'asked' },
    ] })
    const sql = readFileSync(new URL('../../src/prisma/migrations/20260925150000_inferences/migration.sql', import.meta.url), 'utf8')
    const copy = sql.slice(sql.indexOf('-- 数据迁移')).split(/;\s*\n/).map((statement) => statement.trim()).filter((statement) => statement.includes('INSERT'))
    for (const statement of [...copy, ...copy]) await db.$executeRawUnsafe(statement)

    const rows = await db.inference.findMany({ where: { userId: user.id }, orderBy: { dedupeKey: 'asc' } })
    const byKey = Object.fromEntries(rows.map((row) => [row.dedupeKey, row]))
    // 同一对、同一种关系只留已确认那条；反方向也是同一条
    const similar = dedupeKeyOf({ kind: 'relation', payload: { fromMemoryId: a.id, toMemoryId: b.id, relation: 'similar' } })
    expect(byKey[similar]).toMatchObject({ kind: 'relation', status: 'active', payload: expect.objectContaining({ confirmed: true }), basisMemoryIds: [b.id, a.id] })
    expect(byKey[dedupeKeyOf({ kind: 'relation', payload: { fromMemoryId: a.id, toMemoryId: b.id, relation: 'contradicts' } })]).toMatchObject({ status: 'stale' })
    expect(byKey[dedupeKeyOf({ kind: 'insight', content: '你常熬夜' })]).toMatchObject({ status: 'active', basisMemoryIds: [a.id], expiresAt: expect.any(Date) })
    expect(byKey[dedupeKeyOf({ kind: 'insight', content: '被你忽略过的' })]).toMatchObject({ status: 'vetoed' })
    expect(byKey[dedupeKeyOf({ kind: 'insight', content: '进过信的' })]).toMatchObject({ status: 'active', letteredAt: expect.any(Date) })
    expect(byKey[dedupeKeyOf({ kind: 'followup', payload: { about: '周三答辩' }, dueOn: new Date('2026-09-24T00:00:00.000Z') })])
      .toMatchObject({ status: 'closed', outcome: 'asked', content: '答辩怎么样了？' })
    expect(rows).toHaveLength(6)
  })

  it('finds relevant memory beyond 200 records and keeps conflict semantics in context', async () => {
    await db.memory.createMany({ data: Array.from({ length: 205 }, (_, index) => ({ userId: user.id, type: 'semantic', content: `普通内容${index}`, importance: 10 })) })
    const memory = await create('周末想去观星')
    const all = await db.memory.findMany({ where: { userId: user.id }, orderBy: { importance: 'desc' } })
    expect(all.findIndex((item) => item.id === memory.id)).toBeGreaterThan(200)
    const selected = retrieveRelevantMemories('一起观星', all)
    expect(selected.map((item) => item.id)).toContain(memory.id)
    const context = buildMemoryContext(selected, [{ fromMemoryId: memory.id, toMemoryId: 'b', toContent: '周末要在家', relation: 'contradicts' }])
    expect(context).toContain('「周末想去观星」与「周末要在家」好像互相矛盾')
    expect(context).not.toContain('vector')
  })

  it.each(['edit', 'delete'])('discards late relationship generation after %s changes its inputs', async (action) => {
    const memory = await create('明天去散步')
    await create('散步前查看天气')
    let finish
    vi.spyOn(llm, 'getGateway').mockResolvedValue({ complete: () => new Promise((resolve) => { finish = resolve }) })
    const pending = deriveEdges(user.id, 'synthetic-late-edge', { allowExternal: true, authorizeExternal: async () => true })
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    if (action === 'edit') await updateMemory(user.id, memory.id, { content: '明天留在家', expectedRevision: 1 })
    else await deleteMemory(user.id, memory.id)
    finish({ content: JSON.stringify([{ from: 1, to: 2, relation: 'related', confidence: 'high', evidence: ['散步'] }]) })
    expect(await pending).toMatchObject({ created: 0, skipped: 1 })
    expect(await db.inference.count()).toBe(0)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('repairs missing vectors while retaining valid ones and continuing after one failure', async () => {
    const valid = await create('已有有效索引')
    await create('本条生成失败')
    const missing = await create('本条可以生成')
    enableEmbeddings()
    const existing = await storeVector(valid, [0, 1])
    fetch.mockImplementation(async (_url, options) => ({ ok: true, json: async () => ({ data: [{ embedding: JSON.parse(options.body).input.includes('失败') ? [1] : [1, 0] }] }) }))
    const job = await createIndexJob(user.id, { mode: 'repair' })
    await runIndexJob(job.id)
    expect(await db.memoryIndexJob.findUnique({ where: { id: job.id } })).toMatchObject({ status: 'completed', processed: 3, embedded: 1, skipped: 1, failed: 1 })
    const key = identityKeyOf(IDENTITY, 'memory')
    const byMemory = (memory) => db.embedding.findUnique({ where: { subjectType_subjectId_identityKey: { subjectType: 'memory', subjectId: memory.id, identityKey: key } } })
    expect(await byMemory(valid)).toEqual(existing)
    expect(await byMemory(missing)).toMatchObject({ subjectVersion: contentVersion(missing.content), vector: [1, 0] })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  /** 一本已经上传整理好的书：两段正文，向量是 identity 这个模型算的。 */
  async function readyBook(identity) {
    const book = await db.book.create({ data: { userId: user.id, title: '被讨厌的勇气', format: 'epub', serverIndex: 'ready' } })
    const passages = [
      { id: `${book.id}-0`, seq: 0, chapterIndex: 0, chapter: '课题分离', locator: '0:0', content: '别人怎么看你，是别人的课题。' },
      { id: `${book.id}-1`, seq: 1, chapterIndex: 0, chapter: '课题分离', locator: '0:40', content: '你不必满足别人的期待。' },
    ]
    await db.bookPassage.createMany({ data: passages.map((passage) => ({ ...passage, bookId: book.id, userId: user.id })) })
    for (const passage of passages) {
      await saveEmbedding(db, embeddingRow({
        userId: user.id, subjectType: 'passage', subjectId: passage.id, parentId: book.id,
        text: `${passage.chapter}\n${passage.content}`, identity, vector: [1, 0],
      }))
    }
    return book
  }

  it('换了向量模型：她的书先不翻，补算任务按新模型重算段落之后又能翻到（路线图 C23）', async () => {
    enableEmbeddings()
    await readyBook({ ...IDENTITY, model: 'older-embed' })
    const query = { ...IDENTITY, vector: [1, 0] }
    forgetShelf(user.id)
    expect(await searchUserBooks(user.id, { text: '总在讨好别人', queryEmbedding: query })).toEqual([])

    fetch.mockImplementation(async (_url, options) => {
      const { input } = JSON.parse(options.body)
      return { ok: true, json: async () => ({ data: input.map((_text, index) => ({ index, embedding: [1, 0] })) }) }
    })
    const job = await createIndexJob(user.id, { mode: 'repair' })
    expect(job.total).toBe(2)
    await runIndexJob(job.id)
    expect(await db.memoryIndexJob.findUnique({ where: { id: job.id } })).toMatchObject({ status: 'completed', processed: 2, embedded: 2 })
    expect(await db.embedding.count({ where: { subjectType: 'passage', identityKey: identityKeyOf(IDENTITY, 'passage') } })).toBe(2)
    const [hit] = await searchUserBooks(user.id, { text: '总在讨好别人', queryEmbedding: query })
    expect(hit.cards).toHaveLength(1)
  })

  it('删书：段落随书删掉，派生索引里的段落向量也一起删（没有外键，不留孤儿）', async () => {
    const book = await readyBook(IDENTITY)
    expect(await db.embedding.count({ where: { parentId: book.id } })).toBe(2)
    await deleteBook(user.id, book.id)
    expect(await db.bookPassage.count()).toBe(0)
    expect(await db.embedding.count({ where: { parentId: book.id } })).toBe(0)
  })
})
