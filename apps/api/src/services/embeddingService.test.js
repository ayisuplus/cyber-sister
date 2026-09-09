import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  memoryFindMany: vi.fn(),
  memoryUpdate: vi.fn(),
}))

vi.mock('../prisma/client.js', () => ({
  default: {
    user: { findUnique: mocks.userFindUnique },
    memory: { findMany: mocks.memoryFindMany, update: mocks.memoryUpdate },
  },
}))
vi.mock('../utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import {
  embedMemory,
  embedQuery,
  embedText,
  embeddingModelName,
  rebuildEmbeddings,
} from './embeddingService.js'

const USER_ID = 'user-1'
const CONSENTED = { externalLlmConsent: true, externalLlmConsentVersion: 'cloud-primary-v3' }
const NOT_CONSENTED = { externalLlmConsent: null, externalLlmConsentVersion: null }
// 与 llmService.test.js 同款：用环境变量控制供应商是否配置
const CLOUD_ENV = {
  GATEWAY_QWEN_BASE_URL: 'https://example.invalid/v1',
  GATEWAY_QWEN_MODEL: 'qwen-model',
  GATEWAY_QWEN_API_KEY: 'k',
}

function withCloudEnv() {
  Object.assign(process.env, CLOUD_ENV)
}

function withoutCloudEnv() {
  for (const key of Object.keys(CLOUD_ENV)) delete process.env[key]
}

function embeddingResponse(vector) {
  return { ok: true, json: async () => ({ data: [{ embedding: vector }] }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  withoutCloudEnv()
  delete process.env.GATEWAY_QWEN_EMBEDDING_MODEL
  mocks.userFindUnique.mockResolvedValue(CONSENTED)
  mocks.memoryFindMany.mockResolvedValue([])
  mocks.memoryUpdate.mockImplementation(({ where, data }) => Promise.resolve({ id: where.id, ...data }))
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
  withoutCloudEnv()
})

describe('embedText', () => {
  it('供应商未配置时返回 null 且不发 fetch', async () => {
    expect(await embedText('你好')).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('200 返回合法向量，请求逐字对齐 /embeddings 契约', async () => {
    withCloudEnv()
    fetch.mockResolvedValue(embeddingResponse([0.1, 0.2, 0.3]))

    expect(await embedText('喜欢火锅')).toEqual([0.1, 0.2, 0.3])
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('https://example.invalid/v1/embeddings')
    expect(init.method).toBe('POST')
    expect(init.headers['Content-Type']).toBe('application/json')
    expect(init.headers.Authorization).toBe('Bearer k')
    expect(JSON.parse(init.body)).toEqual({ model: 'text-embedding-v4', input: '喜欢火锅' })
  })

  it('GATEWAY_QWEN_EMBEDDING_MODEL 覆盖默认模型名', async () => {
    process.env.GATEWAY_QWEN_EMBEDDING_MODEL = 'custom-embed'
    expect(embeddingModelName()).toBe('custom-embed')

    withCloudEnv()
    fetch.mockResolvedValue(embeddingResponse([1]))
    await embedText('x')
    expect(JSON.parse(fetch.mock.calls[0][1].body).model).toBe('custom-embed')
  })

  it('非 2xx、畸形 JSON、空数组、非数值元素均返回 null', async () => {
    withCloudEnv()
    fetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })
    expect(await embedText('x')).toBeNull()

    fetch.mockResolvedValue({ ok: true, json: async () => { throw new Error('bad json') } })
    expect(await embedText('x')).toBeNull()

    fetch.mockResolvedValue(embeddingResponse([]))
    expect(await embedText('x')).toBeNull()

    fetch.mockResolvedValue(embeddingResponse([0.1, 'a']))
    expect(await embedText('x')).toBeNull()

    fetch.mockResolvedValue({ ok: true, json: async () => ({ data: [{}] }) })
    expect(await embedText('x')).toBeNull()
  })

  it('fetch 抛错（含超时）返回 null 不抛出', async () => {
    withCloudEnv()
    fetch.mockRejectedValue(new Error('network'))
    await expect(embedText('x')).resolves.toBeNull()
  })
})

describe('embedQuery', () => {
  it('未同意直接返回 null，不触碰供应商', async () => {
    withCloudEnv()
    expect(await embedQuery('今晚吃啥', false)).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('同意时返回 embedText 结果', async () => {
    withCloudEnv()
    fetch.mockResolvedValue(embeddingResponse([0.4, 0.5]))
    expect(await embedQuery('今晚吃啥', true)).toEqual([0.4, 0.5])
  })
})

describe('embedMemory', () => {
  it('未同意返回 false 且不 fetch 不写库', async () => {
    withCloudEnv()
    mocks.userFindUnique.mockResolvedValue(NOT_CONSENTED)

    expect(await embedMemory({ id: 'm1', userId: USER_ID, content: '喜欢火锅' })).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
    expect(mocks.memoryUpdate).not.toHaveBeenCalled()
  })

  it('供应商未配置返回 false，不查同意也不 fetch', async () => {
    expect(await embedMemory({ id: 'm1', userId: USER_ID, content: '喜欢火锅' })).toBe(false)
    expect(mocks.userFindUnique).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('同意且 fetch 成功时写入 embedding 与 embeddingModel', async () => {
    withCloudEnv()
    fetch.mockResolvedValue(embeddingResponse([1, 2]))

    expect(await embedMemory({ id: 'm1', userId: USER_ID, content: '喜欢火锅' })).toBe(true)
    expect(mocks.memoryUpdate).toHaveBeenCalledWith({
      where: { id: 'm1' },
      data: { embedding: [1, 2], embeddingModel: 'text-embedding-v4' },
    })
  })

  it('fetch 失败或写库异常返回 false 不抛出', async () => {
    withCloudEnv()
    fetch.mockRejectedValue(new Error('network'))
    await expect(embedMemory({ id: 'm1', userId: USER_ID, content: 'x' })).resolves.toBe(false)

    fetch.mockResolvedValue(embeddingResponse([1]))
    mocks.memoryUpdate.mockRejectedValue(new Error('db down'))
    await expect(embedMemory({ id: 'm1', userId: USER_ID, content: 'x' })).resolves.toBe(false)
  })
})

describe('rebuildEmbeddings', () => {
  it('未同意抛 CLOUD_NOT_CONSENTED，一行不读一行不写', async () => {
    withCloudEnv()
    mocks.userFindUnique.mockResolvedValue(NOT_CONSENTED)

    await expect(rebuildEmbeddings(USER_ID)).rejects.toMatchObject({ code: 'CLOUD_NOT_CONSENTED' })
    expect(mocks.memoryFindMany).not.toHaveBeenCalled()
    expect(mocks.memoryUpdate).not.toHaveBeenCalled()
  })

  it('供应商未配置抛 LLM_UNAVAILABLE', async () => {
    await expect(rebuildEmbeddings(USER_ID)).rejects.toMatchObject({ code: 'LLM_UNAVAILABLE' })
    expect(mocks.memoryFindMany).not.toHaveBeenCalled()
  })

  it('已有向量计 skipped，缺失的逐条投影写库', async () => {
    withCloudEnv()
    mocks.memoryFindMany.mockResolvedValue([
      { id: 'm1', content: '已有', embedding: [0.5] },
      { id: 'm2', content: '缺失一', embedding: [] },
      { id: 'm3', content: '缺失二', embedding: [] },
    ])
    fetch.mockResolvedValue(embeddingResponse([0.1]))

    const result = await rebuildEmbeddings(USER_ID)

    expect(result).toEqual({ embedded: 2, failed: 0, skipped: 1 })
    expect(mocks.memoryUpdate).toHaveBeenCalledTimes(2)
    expect(mocks.memoryUpdate).not.toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'm1' } }))
  })

  it('投影失败计入 failed，不中断后续条目', async () => {
    withCloudEnv()
    mocks.memoryFindMany.mockResolvedValue([
      { id: 'm1', content: '一', embedding: [] },
      { id: 'm2', content: '二', embedding: [] },
    ])
    fetch
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce(embeddingResponse([0.9]))

    const result = await rebuildEmbeddings(USER_ID)

    expect(result).toEqual({ embedded: 1, failed: 1, skipped: 0 })
    expect(mocks.memoryUpdate).toHaveBeenCalledTimes(1)
  })
})
