import { mkdtempSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  count: vi.fn(),
  findFirst: vi.fn(),
  findMany: vi.fn(),
  findUnique: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
}))
const transaction = vi.hoisted(() => vi.fn())
vi.mock('../prisma/client.js', () => ({ default: { modelProvider: db, $transaction: transaction } }))
vi.mock('../utils/logger.js', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))

import {
  MAX_PROVIDERS,
  createProvider,
  decryptApiKey,
  encryptApiKey,
  listProviders,
  listProvidersForGateway,
  reorderProviders,
  testProvider,
  updateProvider,
  validateBaseUrl,
} from './modelProviderService.js'

// 主密钥文件：内容不进快照、不进日志，只在临时目录里活一次
function withMasterKey(extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'amie-model-key-'))
  const file = join(dir, 'model_config_key')
  writeFileSync(file, `${randomBytes(32).toString('hex')}\n`)
  return { MODEL_CONFIG_KEY_FILE: file, ...extra }
}

// 校验只看服务端配置，从不相信浏览器：这里显式给一个 web 运行时
const WEB = { APP_DISTRIBUTION: 'web', BIND_ADDRESS: '10.8.0.2' }
const LOCAL = { APP_DISTRIBUTION: 'local', BIND_ADDRESS: '127.0.0.1' }
const PLAIN_KEY = 'sk-live-9f3c-never-print-me'

function rowOf(overrides = {}) {
  return {
    id: 'p-1',
    name: '甲家',
    baseUrl: 'https://api.jia.example/v1',
    model: 'jia-chat',
    apiKeyEncrypted: null,
    scenes: 'chat',
    priority: 1,
    enabled: true,
    updatedBy: null,
    createdAt: new Date('2026-09-22T00:00:00.000Z'),
    updatedAt: new Date('2026-09-22T00:00:00.000Z'),
    ...overrides,
  }
}

beforeEach(() => vi.clearAllMocks())

describe('供应商密钥加解密', () => {
  it('密文里看不出明文，换一把主密钥就解不开', () => {
    const env = withMasterKey()
    const cipher = encryptApiKey(PLAIN_KEY, env)
    expect(cipher.startsWith('v1:')).toBe(true)
    expect(cipher).not.toContain(PLAIN_KEY)
    expect(cipher).not.toContain('9f3c')
    // 每次一个新 IV：同一明文两次的密文不一样
    expect(encryptApiKey(PLAIN_KEY, env)).not.toBe(cipher)
    expect(decryptApiKey(cipher, env)).toBe(PLAIN_KEY)
    expect(decryptApiKey(encryptApiKey(PLAIN_KEY, env), env)).toBe(PLAIN_KEY)
    // 没密钥的供应商（自建端点）读出来就是空，不是报错
    expect(decryptApiKey(null, env)).toBe('')

    const other = withMasterKey()
    expect(() => decryptApiKey(cipher, other)).toThrow(/解不开/)
    expect(() => decryptApiKey(`${cipher.slice(0, -2)}aa`, env)).toThrow(/解不开/)
    expect(() => decryptApiKey('v9:a:b:c', env)).toThrow(/格式不对/)
  })

  it('主密钥缺失或格式不对时明确报错，不静默降级', () => {
    expect(() => encryptApiKey(PLAIN_KEY, {})).toThrow(/MODEL_CONFIG_KEY_FILE/)
    expect(() => encryptApiKey(PLAIN_KEY, { MODEL_CONFIG_KEY_FILE: join(tmpdir(), 'amie-not-here') })).toThrow(/读不到/)
    const shortKey = join(mkdtempSync(join(tmpdir(), 'amie-model-key-')), 'short')
    writeFileSync(shortKey, 'abcd')
    expect(() => encryptApiKey(PLAIN_KEY, { MODEL_CONFIG_KEY_FILE: shortKey })).toThrow(/64 位十六进制/)
    // 明文直接当密文用也不行
    expect(() => decryptApiKey(PLAIN_KEY, withMasterKey())).toThrow(/格式不对/)
  })
})

describe('接口地址校验', () => {
  it('只收 https、不得内嵌凭据、不得指向内网', () => {
    expect(validateBaseUrl('https://api.example.com/v1', WEB)).toBe('https://api.example.com/v1')
    // 末尾斜杠与片段会被规范化掉
    expect(validateBaseUrl('https://api.example.com/v1/#x', WEB)).toBe('https://api.example.com/v1')
    expect(() => validateBaseUrl('http://api.example.com/v1', WEB)).toThrow(/必须用 https/)
    expect(() => validateBaseUrl('https://sk-user:sk-pass@api.example.com/v1', WEB)).toThrow(/不能写账号密码/)
    expect(() => validateBaseUrl('', WEB)).toThrow(/必填/)
    expect(() => validateBaseUrl('不是地址', WEB)).toThrow(/完整的 URL/)

    for (const internal of [
      'https://127.0.0.1/v1',
      'https://127.0.0.1:11434/v1',
      'https://10.0.0.7/v1',
      'https://192.168.1.9/v1',
      'https://172.16.5.4/v1',
      'https://169.254.10.10/v1',
      'https://[::1]/v1',
      'https://[fd00::1]/v1',
      'https://localhost:8000/v1',
      'https://chat.internal/v1',
      'https://box.local/v1',
    ]) {
      expect(() => validateBaseUrl(internal, WEB)).toThrow(/不能指向本机或内网/)
    }
  })

  it('只有本机运行时允许回环明文地址，公网地址不受影响', () => {
    expect(validateBaseUrl('http://127.0.0.1:11434/v1', LOCAL)).toBe('http://127.0.0.1:11434/v1')
    expect(validateBaseUrl('https://api.example.com/v1', LOCAL)).toBe('https://api.example.com/v1')
    expect(() => validateBaseUrl('http://127.0.0.1:11434/v1', WEB)).toThrow(/必须用 https/)
  })
})

describe('供应商增删改查', () => {
  const env = withMasterKey()

  it('新增只把密文写进库，返回里只有 hasKey', async () => {
    db.count.mockResolvedValue(0)
    db.findFirst.mockResolvedValue(null)
    db.create.mockImplementation(({ data }) => rowOf({ ...data, id: 'p-new' }))
    const created = await createProvider('admin-1', {
      name: '甲家',
      baseUrl: 'https://api.jia.example/v1',
      model: 'jia-chat',
      scenes: ['chat', 'explain'],
      apiKey: PLAIN_KEY,
    }, env)

    const written = db.create.mock.calls[0][0].data
    expect(written.apiKeyEncrypted).not.toContain(PLAIN_KEY)
    expect(written.apiKeyEncrypted).toMatch(/^v1:/)
    expect(decryptApiKey(written.apiKeyEncrypted, env)).toBe(PLAIN_KEY)
    expect(written).toMatchObject({ name: '甲家', baseUrl: 'https://api.jia.example/v1', model: 'jia-chat', scenes: 'chat,explain', priority: 1, enabled: true, updatedBy: 'admin-1' })

    expect(created).toEqual({
      id: 'p-new',
      name: '甲家',
      baseUrl: 'https://api.jia.example/v1',
      model: 'jia-chat',
      scenes: ['chat', 'explain'],
      priority: 1,
      enabled: true,
      hasKey: true,
      updatedBy: 'admin-1',
      createdAt: expect.any(Date),
      updatedAt: expect.any(Date),
    })
    expect(JSON.stringify(created)).not.toContain(PLAIN_KEY)
    expect(created.apiKeyEncrypted).toBeUndefined()
  })

  it('校验失败的字段一次都不落库', async () => {
    db.count.mockResolvedValue(0)
    const base = { name: '甲家', baseUrl: 'https://api.jia.example/v1', model: 'jia-chat' }
    await expect(createProvider('admin-1', { ...base, baseUrl: 'http://api.jia.example/v1' }, env)).rejects.toMatchObject({ statusCode: 400 })
    await expect(createProvider('admin-1', { ...base, name: '   ' }, env)).rejects.toMatchObject({ statusCode: 400 })
    await expect(createProvider('admin-1', { ...base, model: '' }, env)).rejects.toMatchObject({ statusCode: 400 })
    await expect(createProvider('admin-1', { ...base, scenes: ['chat', 'sing'] }, env)).rejects.toMatchObject({ statusCode: 400 })
    await expect(createProvider('admin-1', { ...base, scenes: [] }, env)).rejects.toMatchObject({ statusCode: 400 })
    expect(db.create).not.toHaveBeenCalled()

    db.count.mockResolvedValue(MAX_PROVIDERS)
    await expect(createProvider('admin-1', base, env)).rejects.toMatchObject({ statusCode: 400 })
    expect(db.create).not.toHaveBeenCalled()
  })

  it('列表按优先级排，只回 hasKey', async () => {
    db.findMany.mockResolvedValue([
      rowOf({ id: 'p-1', apiKeyEncrypted: encryptApiKey(PLAIN_KEY, env) }),
      rowOf({ id: 'p-2', name: '乙家', apiKeyEncrypted: null }),
    ])
    const list = await listProviders()
    expect(db.findMany.mock.calls[0][0].orderBy).toEqual([{ priority: 'asc' }, { createdAt: 'asc' }])
    expect(list.map((provider) => provider.hasKey)).toEqual([true, false])
    expect(JSON.stringify(list)).not.toContain(PLAIN_KEY)
    expect(JSON.stringify(list)).not.toContain('v1:')
  })

  it('编辑只动传了的字段；apiKey 留空就是不改，传空串就是清掉', async () => {
    db.findUnique.mockResolvedValue(rowOf({ apiKeyEncrypted: encryptApiKey(PLAIN_KEY, env) }))
    db.update.mockImplementation(({ data }) => rowOf({ ...data }))

    await updateProvider('admin-1', 'p-1', { enabled: false }, env)
    expect(db.update.mock.calls[0][0].data).toEqual({ updatedBy: 'admin-1', enabled: false })

    await updateProvider('admin-1', 'p-1', { name: '甲家二店', apiKey: '' }, env)
    expect(db.update.mock.calls[1][0].data).toEqual({ updatedBy: 'admin-1', name: '甲家二店', apiKeyEncrypted: null })

    await updateProvider('admin-1', 'p-1', { apiKey: PLAIN_KEY }, env)
    expect(db.update.mock.calls[2][0].data.apiKeyEncrypted).toMatch(/^v1:/)
    expect(db.update.mock.calls[2][0].data.apiKeyEncrypted).not.toContain(PLAIN_KEY)

    await expect(updateProvider('admin-1', 'p-1', {}, env)).rejects.toMatchObject({ statusCode: 400 })
    await expect(updateProvider('admin-1', 'p-1', { enabled: 'yes' }, env)).rejects.toMatchObject({ statusCode: 400 })
    db.findUnique.mockResolvedValue(null)
    await expect(updateProvider('admin-1', 'missing', { name: 'x' }, env)).rejects.toMatchObject({ statusCode: 404 })
  })

  it('排序必须正好覆盖现有的全部供应商，按传入顺序写 priority', async () => {
    db.findMany.mockResolvedValue([{ id: 'p-1', name: '甲家' }, { id: 'p-2', name: '乙家' }])
    transaction.mockResolvedValue([])

    await reorderProviders('admin-1', ['p-2', 'p-1'])
    expect(db.update.mock.calls.map(([arguments_]) => [arguments_.where.id, arguments_.data.priority]))
      .toEqual([['p-2', 1], ['p-1', 2]])
    expect(db.update.mock.calls[0][0].data.updatedBy).toBe('admin-1')

    await expect(reorderProviders('admin-1', ['p-2'])).rejects.toMatchObject({ statusCode: 400 })
    await expect(reorderProviders('admin-1', ['p-2', 'p-2'])).rejects.toMatchObject({ statusCode: 400 })
    await expect(reorderProviders('admin-1', ['p-2', 'p-3'])).rejects.toMatchObject({ statusCode: 400 })
    expect(db.update).toHaveBeenCalledTimes(2)
  })
})

describe('试一下', () => {
  const env = withMasterKey()
  const publicLookup = vi.fn(() => [{ address: '93.184.216.34', family: 4 }])

  beforeEach(() => {
    publicLookup.mockClear()
    db.findUnique.mockResolvedValue(rowOf({ apiKeyEncrypted: encryptApiKey(PLAIN_KEY, env) }))
  })

  it('发一次最小真实请求，成功时给出模型名与用时', async () => {
    const fetchImpl = vi.fn(() => ({ ok: true, json: () => Promise.resolve({ choices: [{ message: { content: '好' } }] }) }))
    const result = await testProvider('p-1', { env, fetchImpl, lookupImpl: publicLookup })

    expect(result).toMatchObject({ ok: true, model: 'jia-chat', reply: '好' })
    expect(result.latencyMs).toBeGreaterThanOrEqual(0)
    const [url, options] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://api.jia.example/v1/chat/completions')
    expect(options.headers.authorization).toBe(`Bearer ${PLAIN_KEY}`)
    expect(JSON.parse(options.body)).toEqual({ model: 'jia-chat', messages: [{ role: 'user', content: '你好' }], max_tokens: 1, stream: false })
    expect(publicLookup).toHaveBeenCalledWith('api.jia.example', { all: true, verbatim: true })
  })

  it('失败只给稳定原因：状态码、连不上、格式不对、解析到内网', async () => {
    const failing = (fake) => testProvider('p-1', { env, fetchImpl: fake, lookupImpl: publicLookup })

    await expect(failing(vi.fn(() => ({ ok: false, status: 401, body: { cancel: () => Promise.resolve() } }))))
      .rejects.toMatchObject({ statusCode: 502, message: expect.stringContaining('401') })
    await expect(failing(vi.fn(() => { throw new Error('econnrefused to https://api.jia.example/v1') })))
      .rejects.toMatchObject({ statusCode: 502, message: '连不上这个接口地址' })
    await expect(failing(vi.fn(() => { throw Object.assign(new Error('timeout'), { name: 'TimeoutError' }) })))
      .rejects.toMatchObject({ statusCode: 502, message: expect.stringContaining('超时') })
    await expect(failing(vi.fn(() => ({ ok: true, json: () => Promise.resolve({ error: 'nope' }) }))))
      .rejects.toMatchObject({ statusCode: 502, message: expect.stringContaining('OpenAI 兼容') })

    const internal = vi.fn(() => [{ address: '10.0.0.9', family: 4 }])
    const fetchImpl = vi.fn()
    await expect(testProvider('p-1', { env, fetchImpl, lookupImpl: internal })).rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining('内网') })
    expect(fetchImpl).not.toHaveBeenCalled()

    db.findUnique.mockResolvedValue(null)
    await expect(testProvider('missing', { env, fetchImpl, lookupImpl: publicLookup })).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('给网关用的读取', () => {
  it('只取启用的，按优先级排，解出明文 key', async () => {
    const env = withMasterKey()
    const cipher = encryptApiKey(PLAIN_KEY, env)
    db.findMany.mockResolvedValue([rowOf({ apiKeyEncrypted: cipher }), rowOf({ id: 'p-2', apiKeyEncrypted: null, priority: 2 })])
    const providers = await listProvidersForGateway(env)
    expect(db.findMany.mock.calls[0][0]).toMatchObject({ where: { enabled: true }, orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }] })
    expect(providers[0]).toMatchObject({ id: 'p-1', name: '甲家', baseUrl: 'https://api.jia.example/v1', model: 'jia-chat', apiKey: PLAIN_KEY, scenes: ['chat'], priority: 1 })
    expect(providers[1]).toMatchObject({ id: 'p-2', apiKey: '' })
  })

  it('主密钥不在时直接抛出，不静默去掉一家人', async () => {
    db.findMany.mockResolvedValue([rowOf({ apiKeyEncrypted: 'v1:a:b:c' })])
    await expect(listProvidersForGateway({})).rejects.toMatchObject({ statusCode: 503 })
  })
})
