import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  findUnique: vi.fn(),
  upsert: vi.fn(),
}))

vi.mock('../prisma/client.js', () => ({
  default: {
    llmRuntimeConfig: {
      findUnique: db.findUnique,
      upsert: db.upsert,
    },
  },
}))

import {
  checkLocalLlmState,
  detectLocalLlm,
  getStoredLocalConfig,
  normalizeAndAuthorizeBaseUrl,
  probeLocalLlm,
  saveLocalLlmConfig,
  serializeLocalConfig,
} from './localLlmConfigService.js'

function jsonResponse(body, status = 200) {
  return new globalThis.Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('llama.cpp 实例配置服务', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.LOCAL_LLM_ALLOWED_ORIGINS = [
      'http://llama:8080',
      'http://host.docker.internal:8080',
      'http://127.0.0.1:8080',
    ].join(',')
  })

  afterEach(() => vi.unstubAllGlobals())

  it('只允许精确 origin，并拒绝凭据、查询参数和其他路径', () => {
    expect(normalizeAndAuthorizeBaseUrl('http://llama:8080')).toBe('http://llama:8080/v1')
    expect(normalizeAndAuthorizeBaseUrl('http://llama:8080/v1/')).toBe('http://llama:8080/v1')
    expect(() => normalizeAndAuthorizeBaseUrl('http://evil.test:8080/v1'))
      .toThrow(/origin/)
    expect(() => normalizeAndAuthorizeBaseUrl('http://user:pass@llama:8080/v1'))
      .toThrow(/baseUrl/)
    expect(() => normalizeAndAuthorizeBaseUrl('http://llama:8080/admin'))
      .toThrow(/baseUrl/)
    expect(() => normalizeAndAuthorizeBaseUrl('http://llama:8080/v1?token=secret'))
      .toThrow(/baseUrl/)
  })

  it('按 health、models、无用户数据 chat 顺序完成连接探针', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ status: 'ok' }))
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: 'model-a' }, { id: 'model-b' }] }))
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: '连接正常' } }] }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await probeLocalLlm({
      baseUrl: 'http://llama:8080/v1',
      model: 'model-b',
      apiKey: '',
    })

    expect(result).toEqual({
      baseUrl: 'http://llama:8080/v1',
      models: ['model-a', 'model-b'],
      model: 'model-b',
      state: 'ready',
      apiKeyConfigured: false,
    })
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'http://llama:8080/v1/health',
      'http://llama:8080/v1/models',
      'http://llama:8080/v1/chat/completions',
    ])
    const chatInit = fetchMock.mock.calls[2][1]
    expect(chatInit.redirect).toBe('error')
    expect(JSON.parse(chatInit.body)).toMatchObject({
      model: 'model-b',
      stream: false,
      messages: [{ role: 'user', content: '请只回复：连接正常' }],
    })
  })

  it('health 503 明确返回 loading，不误报为普通连接失败', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ status: 'loading' }, 503)))

    await expect(detectLocalLlm('host')).resolves.toEqual({
      preset: 'host',
      baseUrl: 'http://host.docker.internal:8080/v1',
      models: [],
      model: null,
      state: 'loading',
      apiKeyConfigured: false,
    })
  })

  it('保存前完成探针，并使用 revision 触发后续网关热更新', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(jsonResponse({ status: 'ok' }))
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: 'model-a' }] }))
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: '连接正常' } }] })))
    db.upsert.mockResolvedValue({
      id: 'local',
      enabled: true,
      baseUrl: 'http://llama:8080/v1',
      model: 'model-a',
      revision: 2,
      lastVerifiedAt: new Date('2026-08-30T00:00:00Z'),
    })

    const result = await saveLocalLlmConfig('user-1', {
      enabled: true,
      baseUrl: 'http://llama:8080',
      model: 'model-a',
      apiKeyAction: 'keep',
    })

    expect(result).toMatchObject({ enabled: true, model: 'model-a', revision: 2, apiKeyConfigured: false })
    expect(db.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'local' },
      update: expect.objectContaining({
        revision: { increment: 1 },
        updatedByUserId: 'user-1',
      }),
    }))
  })

  it('拒绝从 UI 传入 API Key', async () => {
    await expect(probeLocalLlm({
      baseUrl: 'http://llama:8080/v1',
      model: 'model-a',
      apiKey: 'secret',
    })).rejects.toMatchObject({ code: 'LOCAL_LLM_API_KEY_NOT_SUPPORTED', statusCode: 400 })
  })
})

describe('llama.cpp 配置读写与状态检查', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.LOCAL_LLM_ALLOWED_ORIGINS = [
      'http://llama:8080',
      'http://host.docker.internal:8080',
      'http://127.0.0.1:8080',
    ].join(',')
  })

  afterEach(() => vi.unstubAllGlobals())

  it('getStoredLocalConfig 读取固定 id 的配置行', async () => {
    db.findUnique.mockResolvedValue({ id: 'local', enabled: false })
    const config = await getStoredLocalConfig()
    expect(db.findUnique).toHaveBeenCalledWith({ where: { id: 'local' } })
    expect(config.enabled).toBe(false)
  })

  it('serializeLocalConfig 对空配置返回未配置形态', () => {
    expect(serializeLocalConfig(null)).toEqual({
      enabled: false,
      baseUrl: null,
      model: null,
      revision: 0,
      lastVerifiedAt: null,
      apiKeyConfigured: false,
    })
  })

  it('serializeLocalConfig 永不暴露 apiKey 内容', () => {
    const serialized = serializeLocalConfig({
      enabled: true,
      baseUrl: 'http://llama:8080/v1',
      model: 'm1',
      revision: 3,
      lastVerifiedAt: new Date('2026-08-30T00:00:00Z'),
      apiKey: 'super-secret',
    })
    expect(serialized).toEqual({
      enabled: true,
      baseUrl: 'http://llama:8080/v1',
      model: 'm1',
      revision: 3,
      lastVerifiedAt: new Date('2026-08-30T00:00:00Z'),
      apiKeyConfigured: false,
    })
  })

  it('checkLocalLlmState 区分未配置、停用、就绪、加载中与异常', async () => {
    expect(await checkLocalLlmState(null)).toBe('not_configured')
    expect(await checkLocalLlmState({ enabled: false })).toBe('unavailable')

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ status: 'ok' })))
    expect(await checkLocalLlmState({ enabled: true, baseUrl: 'http://llama:8080/v1' })).toBe('ready')

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 503)))
    expect(await checkLocalLlmState({ enabled: true, baseUrl: 'http://llama:8080/v1' })).toBe('loading')

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 500)))
    expect(await checkLocalLlmState({ enabled: true, baseUrl: 'http://llama:8080/v1' })).toBe('unavailable')

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connection refused')))
    expect(await checkLocalLlmState({ enabled: true, baseUrl: 'http://llama:8080/v1' })).toBe('unavailable')
  })

  it('detectLocalLlm 拒绝未知 preset', async () => {
    await expect(detectLocalLlm('alien')).rejects.toMatchObject({
      code: 'INVALID_LOCAL_LLM_PRESET',
      statusCode: 400,
    })
  })

  it('health 不可达与非 503 错误都归为探针失败', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connection refused')))
    await expect(probeLocalLlm({ baseUrl: 'http://llama:8080/v1' })).rejects.toMatchObject({
      code: 'LOCAL_LLM_PROBE_FAILED',
      statusCode: 502,
    })

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 500)))
    await expect(probeLocalLlm({ baseUrl: 'http://llama:8080/v1' })).rejects.toMatchObject({
      code: 'LOCAL_LLM_PROBE_FAILED',
    })
  })

  it('models 为空或所选模型不在列表中分别报错', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(jsonResponse({ status: 'ok' }))
      .mockResolvedValueOnce(jsonResponse({ data: [] })))
    await expect(probeLocalLlm({ baseUrl: 'http://llama:8080/v1' })).rejects.toMatchObject({
      code: 'LOCAL_LLM_PROBE_FAILED',
    })

    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(jsonResponse({ status: 'ok' }))
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: 'model-a' }] })))
    await expect(probeLocalLlm({ baseUrl: 'http://llama:8080/v1', model: 'ghost' }))
      .rejects.toMatchObject({ code: 'LOCAL_LLM_MODEL_NOT_FOUND', statusCode: 400 })
  })

  it('chat 探针返回空内容视为失败', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(jsonResponse({ status: 'ok' }))
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: 'model-a' }] }))
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: '   ' } }] })))
    await expect(probeLocalLlm({ baseUrl: 'http://llama:8080/v1' })).rejects.toMatchObject({
      code: 'LOCAL_LLM_PROBE_FAILED',
    })
  })

  it('未指定模型时默认选用列表第一个模型', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ status: 'ok' }))
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: 'model-a' }, { id: 'model-b' }] }))
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: '连接正常' } }] }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await probeLocalLlm({ baseUrl: 'http://llama:8080/v1', model: '' })
    expect(result.model).toBe('model-a')
  })

  it('拒绝非法 apiKeyAction', async () => {
    await expect(probeLocalLlm({ baseUrl: 'http://llama:8080/v1', apiKeyAction: 'set' }))
      .rejects.toMatchObject({ code: 'LOCAL_LLM_API_KEY_NOT_SUPPORTED' })
  })

  it('保存启用配置时若模型仍在加载返回 409', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ status: 'loading' }, 503)))
    await expect(saveLocalLlmConfig('user-1', {
      enabled: true,
      baseUrl: 'http://llama:8080',
      model: 'model-a',
    })).rejects.toMatchObject({ code: 'LOCAL_LLM_LOADING', statusCode: 409 })
    expect(db.upsert).not.toHaveBeenCalled()
  })

  it('停用配置不做探针，enabled 必须是布尔值', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    db.upsert.mockResolvedValue({
      id: 'local',
      enabled: false,
      baseUrl: 'http://llama:8080/v1',
      model: 'model-a',
      revision: 4,
      lastVerifiedAt: null,
    })

    const result = await saveLocalLlmConfig('user-1', {
      enabled: false,
      baseUrl: 'http://llama:8080',
      model: 'model-a',
    })
    expect(result.enabled).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()

    await expect(saveLocalLlmConfig('user-1', { enabled: 'yes', baseUrl: 'http://llama:8080', model: 'm' }))
      .rejects.toMatchObject({ code: 'INVALID_LOCAL_LLM_CONFIG' })
  })
})
