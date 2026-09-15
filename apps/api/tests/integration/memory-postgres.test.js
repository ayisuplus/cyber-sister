import { beforeAll, afterAll, beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const connection = vi.hoisted(() => ({ client: null }))
vi.mock('../../src/prisma/client.js', () => ({ default: new Proxy({}, {
  get: (_, key) => typeof connection.client?.[key] === 'function' ? connection.client[key].bind(connection.client) : connection.client?.[key],
}) }))
import { createMemory, updateMemory, deleteMemory, restoreMemory, listRevisions } from '../../src/services/memoryService.js'
import { promoteInsight, clearInsights } from '../../src/services/derivedService.js'
import { promoteEdge, deriveEdges } from '../../src/services/edgeService.js'
import { embedMemory } from '../../src/services/embeddingService.js'
import { createIndexJob, cancelIndexJob, runIndexJob, startMemoryIndexWorker, stopMemoryIndexWorker } from '../../src/services/memoryIndexService.js'
import { exportMemoryBundle, previewMemoryImport, applyMemoryImport } from '../../src/services/memoryTransferService.js'
import { applyImport, previewImport } from '../../src/services/importService.js'
import { retrieveRelevantMemories, buildMemoryContext } from '../../src/services/llmService.js'
import * as llm from '../../src/services/llmService.js'

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
    user = await db.user.create({ data: { phone: '19900000001', externalLlmConsent: true, externalLlmConsentVersion: 'cloud-primary-v3' } })
  })
  afterEach(() => { stopMemoryIndexWorker(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs() })
  afterAll(async () => {
    await db?.$disconnect()
    if (admin) {
      await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`)
      await admin.$disconnect()
    }
  })

  it('creates a baseline, rejects concurrent edits and restores by appending a revision', async () => {
    const memory = await create()
    expect(memory.revision).toBe(1)
    const result = await Promise.allSettled([
      updateMemory(user.id, memory.id, { content: '现在喜欢游泳', expectedRevision: 1 }),
      updateMemory(user.id, memory.id, { content: '现在喜欢阅读', expectedRevision: 1 }),
    ])
    expect(result.filter((item) => item.status === 'fulfilled')).toHaveLength(1)
    expect(result.find((item) => item.status === 'rejected').reason.statusCode).toBe(409)
    const restored = await restoreMemory(user.id, memory.id, { revision: 1, expectedRevision: 2 })
    expect(restored).toMatchObject({ content: memory.content, revision: 3 })
    const revisions = await listRevisions(user.id, memory.id)
    expect(revisions.map((item) => item.revision)).toEqual([3, 2, 1])
    expect(revisions[0]).toMatchObject({ action: 'restore', restoredFrom: 1 })
    expect(restored).not.toHaveProperty('projection')
  })

  it('rejects forged quotes and another user’s source', async () => {
    const other = await db.user.create({ data: { phone: '19900000002' } })
    const foreign = await createMemory(other.id, { type: 'semantic', content: '其他人的内容' }, { projectEmbedding: false })
    await expect(createMemory(user.id, { type: 'semantic', content: '伪造', sources: [{ type: 'memory', id: foreign.id, revision: 1, quote: foreign.content }] })).rejects.toMatchObject({ statusCode: 409 })
    const memory = await create()
    await expect(createMemory(user.id, { type: 'semantic', content: '伪造', sources: [{ type: 'memory', id: memory.id, revision: 1, quote: '不存在的依据' }] })).rejects.toMatchObject({ statusCode: 409 })
    expect(await db.memory.count({ where: { userId: user.id } })).toBe(1)
  })

  it('promotes once under duplicate requests and keeps approval history when drafts are cleared', async () => {
    const source = await create('周末常去爬山')
    const insight = await db.derivedInsight.create({ data: {
      userId: user.id, kind: 'pattern', content: '喜欢户外活动', sourceMemoryIds: [source.id],
      sources: [{ type: 'memory', id: source.id, revision: 1, quote: source.content }],
    } })
    const confirmations = await Promise.all([promoteInsight(user.id, insight.id, { expectedRevision: 1 }), promoteInsight(user.id, insight.id, { expectedRevision: 1 })])
    expect(confirmations[0].memory.id).toBe(confirmations[1].memory.id)
    expect(await db.memory.count()).toBe(2)
    await clearInsights(user.id)
    expect(await db.derivedInsight.count({ where: { status: 'promoted' } })).toBe(1)
    expect(await db.memoryRevision.count({ where: { memoryId: confirmations[0].memory.id } })).toBe(1)
    await deleteMemory(user.id, confirmations[0].memory.id)
    await expect(promoteInsight(user.id, insight.id, { expectedRevision: 1 })).rejects.toMatchObject({ statusCode: 404 })
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

  it('requires reviewing a changed relation and retains its earlier confirmation', async () => {
    const a = await create('喜欢爬山')
    const b = await create('周末外出')
    const edge = await db.memoryEdge.create({ data: { userId: user.id, fromMemoryId: a.id, toMemoryId: b.id, relation: 'related' } })
    await promoteEdge(user.id, edge.id, { expectedRevision: 1, expectedFromRevision: 1, expectedToRevision: 1 })
    await updateMemory(user.id, a.id, { content: '最近更喜欢室内阅读', expectedRevision: 1 })
    expect(await db.memoryEdge.findUnique({ where: { id: edge.id } })).toMatchObject({ status: 'needs_review', revision: 3 })
    await expect(promoteEdge(user.id, edge.id, { expectedRevision: 3, expectedFromRevision: 1, expectedToRevision: 1 })).rejects.toMatchObject({ statusCode: 409 })
    const reviewed = await promoteEdge(user.id, edge.id, { expectedRevision: 3, expectedFromRevision: 2, expectedToRevision: 1 })
    expect(reviewed.status).toBe('canonical')
    expect(reviewed.decisions).toHaveLength(2)
  })

  function enableEmbeddings() {
    vi.stubEnv('MEMORY_EMBEDDING_BASE_URL', 'https://embedding.invalid/v1')
    vi.stubEnv('MEMORY_EMBEDDING_MODEL', 'test-embedding')
    vi.stubEnv('MEMORY_EMBEDDING_DIMENSIONS', '2')
    vi.stubEnv('MEMORY_EMBEDDING_API_KEY', 'synthetic-test-key')
  }

  it('does not revive deleted memory when a projection arrives late', async () => {
    const memory = await create()
    enableEmbeddings()
    let complete
    fetch.mockImplementation(() => new Promise((resolve) => { complete = resolve }))
    const pending = embedMemory({ ...memory, userId: user.id })
    await vi.waitFor(() => expect(complete).toBeTypeOf('function'))
    await deleteMemory(user.id, memory.id)
    complete({ ok: true, json: async () => ({ data: [{ embedding: [1, 0] }] }) })
    expect(await pending).toBe(false)
    expect(await db.memoryProjection.count()).toBe(0)
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
    await updateMemory(user.id, a.id, { importance: 8, expectedRevision: 1 })
    const edge = await db.memoryEdge.create({ data: { userId: user.id, fromMemoryId: a.id, toMemoryId: b.id, relation: 'related', fromRevision: 2,
      evidence: JSON.stringify([{ type: 'memory', id: a.id, revision: 2, quote: a.content, status: 'verified' }]) } })
    await promoteEdge(user.id, edge.id, { expectedRevision: 1, expectedFromRevision: 2, expectedToRevision: 1 })
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
    expect(restored.edges[0]).toMatchObject({ from: bundle.edges[0].from, to: bundle.edges[0].to, relation: 'related', status: 'canonical' })
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

  it('retains a valid projection on rebuild failure and excludes incompatible projections from search', async () => {
    const memory = await create('周末徒步')
    enableEmbeddings()
    const identity = { provider: 'https://embedding.invalid/v1', model: 'test-embedding', dimensions: 2, ruleVersion: 1 }
    await db.memoryProjection.create({ data: { memoryId: memory.id, memoryRevision: 1, ...identity, vector: [1, 0] } })
    const job = await createIndexJob(user.id, { mode: 'rebuild' })
    await runIndexJob(job.id)
    expect(await db.memoryProjection.count()).toBe(1)
    expect(await db.memoryIndexJob.findUnique({ where: { id: job.id } })).toMatchObject({ status: 'completed', failed: 1 })
    const current = await db.memory.findFirst({ include: { projection: true } })
    const query = { ...identity, vector: [1, 0] }
    expect(retrieveRelevantMemories('外出', [current], query)).toHaveLength(1)
    expect(retrieveRelevantMemories('外出', [{ ...current, projection: { ...current.projection, model: 'other-model' } }], query)).toEqual([])
    expect(retrieveRelevantMemories('外出', [{ ...current, projection: { ...current.projection, memoryRevision: 99 } }], query)).toEqual([])
    expect(retrieveRelevantMemories('外出', [{ ...current, projection: { ...current.projection, dimensions: 3, vector: [1, 0, 0] } }], query)).toEqual([])
    expect(retrieveRelevantMemories('徒步', [{ ...current, projection: { ...current.projection, memoryRevision: 99 } }], query)).toHaveLength(1)
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
    const insight = await db.derivedInsight.create({ data: { userId: user.id, kind: 'pattern', content: '用户另外确认的内容', sources, sourceMemoryIds: [source.id] } })
    const { memory: dependent } = await promoteInsight(user.id, insight.id, { expectedRevision: 1 })
    await db.memoryEdge.create({ data: { userId: user.id, fromMemoryId: source.id, toMemoryId: dependent.id, relation: 'related' } })
    await deleteMemory(user.id, source.id)
    expect(await db.derivedInsight.count()).toBe(0)
    expect(await db.memoryEdge.count()).toBe(0)
    const preserved = await db.memory.findUnique({ where: { id: dependent.id }, include: { revisions: true } })
    expect(preserved).toMatchObject({ content: dependent.content, sources: [], sourceRef: null, revision: 1 })
    expect(preserved.revisions).toHaveLength(1)
    expect(preserved.revisions[0].sources).toEqual([])
  })

  it('rejects dismissed and changed drafts until an explicit manual review of changed content', async () => {
    const source = await create('喜欢去图书馆')
    const insight = await db.derivedInsight.create({ data: { userId: user.id, kind: 'pattern', content: '爱读书',
      sourceMemoryIds: [source.id], sources: [{ type: 'memory', id: source.id, revision: 1, quote: source.content }] } })
    await updateMemory(user.id, source.id, { type: 'episodic', expectedRevision: 1 })
    const changed = await db.derivedInsight.findUnique({ where: { id: insight.id } })
    expect(changed.status).toBe('needs_review')
    await expect(promoteInsight(user.id, insight.id, { expectedRevision: changed.revision })).rejects.toMatchObject({ statusCode: 409 })
    const reviewed = await promoteInsight(user.id, insight.id, { expectedRevision: changed.revision, asManual: true, content: '我确认自己爱读书' })
    expect(reviewed.memory).toMatchObject({ content: '我确认自己爱读书', origin: 'manual', sources: [] })
    const dismissed = await db.derivedInsight.create({ data: { userId: user.id, kind: 'pattern', content: '已拒绝', status: 'dismissed' } })
    await expect(promoteInsight(user.id, dismissed.id, { expectedRevision: 1, asManual: true, content: '试图跳过拒绝' })).rejects.toMatchObject({ statusCode: 409 })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('finds relevant memory beyond 200 records and keeps conflict semantics in context', async () => {
    await db.memory.createMany({ data: Array.from({ length: 205 }, (_, index) => ({ userId: user.id, type: 'semantic', content: `普通内容${index}`, importance: 10 })) })
    const memory = await create('周末想去观星')
    const all = await db.memory.findMany({ where: { userId: user.id }, orderBy: { importance: 'desc' }, include: { projection: true } })
    expect(all.findIndex((item) => item.id === memory.id)).toBeGreaterThan(200)
    const selected = retrieveRelevantMemories('一起观星', all)
    expect(selected.map((item) => item.id)).toContain(memory.id)
    const context = buildMemoryContext(selected, [{ fromMemoryId: memory.id, toMemoryId: 'b', toContent: '周末要在家', relation: 'contradicts' }])
    expect(context).toContain('"relation":"contradicts"')
    expect(context).not.toContain('vector')
  })

  it.each(['edit', 'delete', 'clear'])('discards late relationship generation after %s changes its inputs', async (action) => {
    const memory = await create('明天去散步')
    await create('散步前查看天气')
    let finish
    vi.spyOn(llm, 'getGateway').mockResolvedValue({ complete: () => new Promise((resolve) => { finish = resolve }) })
    const pending = deriveEdges(user.id, 'synthetic-late-edge', { allowExternal: true, authorizeExternal: async () => true })
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    if (action === 'edit') await updateMemory(user.id, memory.id, { content: '明天留在家', expectedRevision: 1 })
    else if (action === 'delete') await deleteMemory(user.id, memory.id)
    else await clearInsights(user.id)
    finish({ content: JSON.stringify([{ from: 1, to: 2, relation: 'related', confidence: 'high', evidence: ['散步'] }]) })
    expect(await pending).toMatchObject({ created: 0, skipped: 1 })
    expect(await db.memoryEdge.count()).toBe(0)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('repairs missing projections while retaining valid ones and continuing after one failure', async () => {
    const valid = await create('已有有效索引')
    await create('本条生成失败')
    const missing = await create('本条可以生成')
    enableEmbeddings()
    const existing = await db.memoryProjection.create({ data: { memoryId: valid.id, memoryRevision: 1,
      provider: 'https://embedding.invalid/v1', model: 'test-embedding', dimensions: 2, ruleVersion: 1, vector: [0, 1] } })
    fetch.mockImplementation(async (_url, options) => ({ ok: true, json: async () => ({ data: [{ embedding: JSON.parse(options.body).input.includes('失败') ? [1] : [1, 0] }] }) }))
    const job = await createIndexJob(user.id, { mode: 'repair' })
    await runIndexJob(job.id)
    expect(await db.memoryIndexJob.findUnique({ where: { id: job.id } })).toMatchObject({ status: 'completed', processed: 3, embedded: 1, skipped: 1, failed: 1 })
    expect(await db.memoryProjection.findUnique({ where: { memoryId: valid.id } })).toEqual(existing)
    expect(await db.memoryProjection.findUnique({ where: { memoryId: missing.id } })).toMatchObject({ memoryRevision: 1, vector: [1, 0] })
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})
