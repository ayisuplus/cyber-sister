import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  userFindUnique: vi.fn(), memoryFindFirst: vi.fn(), embeddingUpsert: vi.fn(),
  jobFindFirst: vi.fn(), jobCreate: vi.fn(),
}))
vi.mock('../prisma/client.js', () => {
  const client = {
    $queryRaw: vi.fn(async () => [{ id: 'user-1' }]),
    user: { findUnique: mocks.userFindUnique },
    memory: { findFirst: mocks.memoryFindFirst, count: vi.fn(async () => 3) },
    // 派生索引（路线图 C23）：记忆向量存 embeddings
    embedding: { upsert: mocks.embeddingUpsert },
    bookPassage: { count: vi.fn(async () => 0) },
    memoryIndexJob: { findFirst: mocks.jobFindFirst, create: mocks.jobCreate },
  }
  client.$transaction = vi.fn((operation) => operation(client))
  return { default: client }
})
vi.mock('../utils/logger.js', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))
import { embedMemory, embedQuery, embedText, embedTexts, embeddingModelName } from './embeddingService.js'
import { createIndexJob } from './memoryIndexService.js'
import { contentVersion, identityKeyOf } from './vectors/identity.js'
import logger from '../utils/logger.js'

const USER_ID = 'user-1'
const CONSENTED = { externalLlmConsent: true, externalLlmConsentVersion: 'cloud-primary-v4' }
const memory = { id: 'm1', userId: USER_ID, revision: 1, content: 'synthetic memory' }
const identity = { provider: 'https://example.invalid/v1', model: 'synthetic-embed', dimensions: 2, ruleVersion: 1 }
const response = (vector) => ({ ok: true, json: async () => ({ data: [{ embedding: vector }] }) })
function configure() {
  vi.stubEnv('MEMORY_EMBEDDING_BASE_URL', identity.provider)
  vi.stubEnv('MEMORY_EMBEDDING_MODEL', identity.model)
  vi.stubEnv('MEMORY_EMBEDDING_API_KEY', 'synthetic-key')
  vi.stubEnv('MEMORY_EMBEDDING_DIMENSIONS', '2')
}
beforeEach(() => {
  vi.resetAllMocks()
  for (const field of ['BASE_URL', 'MODEL', 'API_KEY', 'DIMENSIONS']) vi.stubEnv('MEMORY_EMBEDDING_' + field, '')
  mocks.userFindUnique.mockResolvedValue(CONSENTED)
  mocks.memoryFindFirst.mockResolvedValue(memory)
  mocks.embeddingUpsert.mockResolvedValue({})
  mocks.jobFindFirst.mockResolvedValue(null)
  mocks.jobCreate.mockImplementation(async ({ data }) => ({ id: 'job-1', status: 'queued', ...data }))
  vi.stubGlobal('fetch', vi.fn())
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe('independent embedding provider', () => {
  it('unconfigured capability does not call the network or authorization store', async () => {
    expect(await embedText('synthetic')).toBeNull()
    expect(await embedMemory(memory)).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
    expect(mocks.userFindUnique).not.toHaveBeenCalled()
  })
  it('chat configuration cannot implicitly enable embeddings', async () => {
    vi.stubEnv('GATEWAY_QWEN_BASE_URL', 'https://chat.invalid/v1')
    vi.stubEnv('GATEWAY_QWEN_MODEL', 'chat')
    vi.stubEnv('GATEWAY_QWEN_API_KEY', 'synthetic-key')
    expect(await embedText('synthetic')).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })
  it('uses the explicit model, dimensions and embeddings endpoint', async () => {
    configure()
    fetch.mockResolvedValue(response([1, 0]))
    expect(embeddingModelName()).toBe(identity.model)
    expect(await embedText('synthetic')).toEqual([1, 0])
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe(identity.provider + '/embeddings')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer synthetic-key')
    expect(JSON.parse(init.body)).toEqual({ model: identity.model, input: 'synthetic' })
  })
  it.each([[], [1], [0, 0], [1, Infinity], [NaN, 1], ['1', 0]])('rejects malformed vectors: %j', async (...vector) => {
    configure()
    fetch.mockResolvedValue(response(vector))
    expect(await embedText('synthetic')).toBeNull()
  })
  it('rejects a response from a different model', async () => {
    configure()
    fetch.mockResolvedValue({ ok: true, json: async () => ({ model: 'different', data: [{ embedding: [1, 0] }] }) })
    expect(await embedText('synthetic')).toBeNull()
  })
  it('degrades safely on HTTP, JSON and network failures', async () => {
    configure()
    fetch.mockResolvedValue({ ok: false })
    expect(await embedText('synthetic')).toBeNull()
    fetch.mockResolvedValue({ ok: true, json: async () => { throw new Error('invalid json') } })
    expect(await embedText('synthetic')).toBeNull()
    fetch.mockRejectedValue(new Error('network failure'))
    expect(await embedText('synthetic')).toBeNull()
  })
})

describe('batch embedding for uploaded book passages', () => {
  it('sends one request for the batch and returns vectors in input order', async () => {
    configure()
    fetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ data: [{ index: 1, embedding: [0, 1] }, { index: 0, embedding: [1, 0] }] }) })
    expect(await embedTexts(['first', 'second'])).toEqual([[1, 0], [0, 1]])
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ model: identity.model, input: ['first', 'second'] })
  })
  it('drops the whole batch when any vector is missing or malformed', async () => {
    configure()
    fetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ data: [{ embedding: [1, 0] }] }) })
    expect(await embedTexts(['first', 'second'])).toBeNull()
    fetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ data: [{ embedding: [1, 0] }, { embedding: [0, 0] }] }) })
    expect(await embedTexts(['first', 'second'])).toBeNull()
    fetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ model: 'different', data: [{ embedding: [1, 0] }] }) })
    expect(await embedTexts(['first'])).toBeNull()
  })
  it('does nothing without configuration or input', async () => {
    expect(await embedTexts(['first'])).toBeNull()
    configure()
    expect(await embedTexts([])).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('query projection consent and cancellation', () => {
  it.each([undefined, async () => false, async () => { throw new Error('authorization unavailable') }])('fails closed without current authorization', async (authorizeExternal) => {
    configure()
    expect(await embedQuery('synthetic', { allowExternal: true, authorizeExternal })).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })
  it('refuses external use when consent is false', async () => {
    configure()
    expect(await embedQuery('synthetic', { allowExternal: false, authorizeExternal: async () => true })).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })
  it('returns only the vector identity, never its key', async () => {
    configure()
    fetch.mockResolvedValue(response([1, 0]))
    expect(await embedQuery('synthetic', { allowExternal: true, authorizeExternal: async () => true })).toEqual({ ...identity, vector: [1, 0] })
  })
  it('redacts sensitive input and propagates cancellation', async () => {
    configure()
    fetch.mockResolvedValue(response([1, 0]))
    const abort = new AbortController()
    await embedQuery('synthetic@example.invalid', { allowExternal: true, authorizeExternal: async () => true, signal: abort.signal })
    const init = fetch.mock.calls[0][1]
    expect(JSON.parse(init.body).input).toBe('[邮箱]')
    abort.abort()
    expect(init.signal.aborted).toBe(true)
  })
  it('cancellation during authorization prevents the request', async () => {
    configure()
    const abort = new AbortController()
    expect(await embedQuery('synthetic', { allowExternal: true, signal: abort.signal,
      authorizeExternal: async () => { abort.abort(); return true } })).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })
  it('checks consent again before returning a result', async () => {
    configure()
    fetch.mockResolvedValue(response([1, 0]))
    const authorizeExternal = vi.fn().mockResolvedValueOnce(true).mockResolvedValue(false)
    expect(await embedQuery('synthetic', { allowExternal: true, authorizeExternal })).toBeNull()
  })
})

describe('memory projection commits', () => {
  it('never calls the provider without consent', async () => {
    configure()
    mocks.userFindUnique.mockResolvedValue({ externalLlmConsent: false })
    expect(await embedMemory(memory)).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
    expect(mocks.embeddingUpsert).not.toHaveBeenCalled()
  })
  it('stores the vector in the derived index, keyed by model identity and bound to the current text', async () => {
    configure()
    fetch.mockResolvedValue(response([3, 4]))
    expect(await embedMemory(memory)).toBe(true)
    const identityKey = identityKeyOf(identity, 'memory')
    const row = {
      userId: USER_ID, subjectType: 'memory', subjectId: memory.id, parentId: memory.id,
      subjectVersion: contentVersion(memory.content), identityKey, dimensions: 2, vector: [0.6, 0.8],
    }
    expect(mocks.embeddingUpsert).toHaveBeenCalledWith({
      where: { subjectType_subjectId_identityKey: { subjectType: 'memory', subjectId: memory.id, identityKey } },
      create: row,
      update: { subjectVersion: row.subjectVersion, dimensions: 2, vector: [0.6, 0.8], parentId: memory.id },
    })
  })
  it('a late result for older text cannot overwrite the vector of the newer text', async () => {
    configure()
    let finishOld, startOld
    const started = new Promise((resolve) => { startOld = resolve })
    fetch.mockImplementation((_url, init) => {
      if (JSON.parse(init.body).input === 'old') { startOld(); return new Promise((resolve) => { finishOld = resolve }) }
      return Promise.resolve(response([0, 1]))
    })
    // 库里现在是新正文：旧正文算出来的向量对不上，不写
    mocks.memoryFindFirst.mockResolvedValue({ ...memory, revision: 2, content: 'new' })
    const old = embedMemory({ ...memory, content: 'old' })
    await started
    expect(await embedMemory({ ...memory, revision: 2, content: 'new' })).toBe(true)
    finishOld(response([1, 0]))
    expect(await old).toBe(false)
    expect(mocks.embeddingUpsert).toHaveBeenCalledTimes(1)
    expect(mocks.embeddingUpsert.mock.calls[0][0].update.vector).toEqual([0, 1])
  })
  it('does not save after consent is revoked while a request is in flight', async () => {
    configure()
    mocks.userFindUnique.mockResolvedValueOnce(CONSENTED).mockResolvedValue({ externalLlmConsent: false })
    fetch.mockResolvedValue(response([1, 0]))
    expect(await embedMemory(memory)).toBe(false)
    expect(mocks.embeddingUpsert).not.toHaveBeenCalled()
  })
  it('database failures do not leak content or raw query parameters', async () => {
    configure()
    fetch.mockResolvedValue(response([1, 0]))
    mocks.embeddingUpsert.mockRejectedValue(Object.assign(new Error('where.content=' + memory.content), { code: 'P2025' }))
    expect(await embedMemory(memory)).toBe(false)
    expect(logger.warn).toHaveBeenCalledWith('记忆向量未保存', { userId: USER_ID, code: 'P2025' })
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(memory.content)
  })
})

describe('rebuild creates durable jobs (POST /memories/index-jobs, mode=rebuild)', () => {
  it('unconfigured provider returns an honest keyword fallback error', async () => {
    await expect(createIndexJob(USER_ID, { mode: 'rebuild' })).rejects.toMatchObject({ code: 'EMBEDDING_NOT_CONFIGURED' })
    expect(mocks.jobCreate).not.toHaveBeenCalled()
  })
  it('requires consent before creating a job', async () => {
    configure()
    mocks.userFindUnique.mockResolvedValue({ externalLlmConsent: false })
    await expect(createIndexJob(USER_ID, { mode: 'rebuild' })).rejects.toMatchObject({ code: 'CLOUD_NOT_CONSENTED' })
    expect(mocks.jobCreate).not.toHaveBeenCalled()
  })
  it('returns a queued receipt without treating it as completion', async () => {
    configure()
    expect(await createIndexJob(USER_ID, { mode: 'rebuild' })).toMatchObject({ id: 'job-1', status: 'queued', mode: 'rebuild', total: 3 })
    expect(fetch).not.toHaveBeenCalled()
  })
  it('reuses the active job for the same user', async () => {
    configure()
    mocks.jobFindFirst.mockResolvedValue({ id: 'job-existing', status: 'running' })
    expect(await createIndexJob(USER_ID, { mode: 'rebuild' })).toMatchObject({ id: 'job-existing', status: 'running' })
    expect(mocks.jobCreate).not.toHaveBeenCalled()
  })
})
