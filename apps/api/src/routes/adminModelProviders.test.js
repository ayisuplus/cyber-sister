import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ phone: '13800138000' }))
const service = vi.hoisted(() => ({
  listProviders: vi.fn(),
  createProvider: vi.fn(),
  updateProvider: vi.fn(),
  deleteProvider: vi.fn(),
  reorderProviders: vi.fn(),
  testProvider: vi.fn(),
}))
const gateway = vi.hoisted(() => ({ loadCloudProviders: vi.fn(() => []) }))

vi.mock('../prisma/client.js', () => ({ default: { user: { findUnique: () => ({ phone: state.phone }) } } }))
vi.mock('../services/modelProviderService.js', () => service)
vi.mock('../services/llmService.js', () => gateway)
vi.mock('../utils/logger.js', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))

import adminModelProvidersRoutes from './adminModelProviders.js'
import { instanceAdminMiddleware } from '../middleware/instanceAdmin.js'

// 真实挂上权限中间件：非管理员被挡在路由之前，服务一个都不该被调用
const app = express()
app.use(express.json())
app.use((req, _res, next) => {
  req.user = { userId: 'admin-1' }
  next()
})
app.use('/', instanceAdminMiddleware, adminModelProvidersRoutes)

const provider = { id: 'p-1', name: '甲家', baseUrl: 'https://api.jia.example/v1', model: 'jia-chat', scenes: ['chat'], priority: 1, enabled: true, hasKey: true }
const bad = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode })

beforeEach(() => {
  vi.clearAllMocks()
  process.env.INSTANCE_ADMIN_PHONES = '13800138000'
  process.env.INTERNAL_TEST_PHONES = '13800138000,13900139000'
})

describe('模型供应商管理接口', () => {
  it('非管理员 403，一个都不许改；管理员才放行', async () => {
    state.phone = '13900139000'
    for (const [method, path] of [['get', '/'], ['post', '/'], ['put', '/p-1'], ['delete', '/p-1'], ['post', '/p-1/test'], ['put', '/order']]) {
      const response = await request(app)[method](path).send({})
      expect(response.status, `${method} ${path}`).toBe(403)
      expect(response.body.code).toBe('INSTANCE_ADMIN_REQUIRED')
    }
    expect(service.listProviders).not.toHaveBeenCalled()
    expect(service.createProvider).not.toHaveBeenCalled()
    expect(service.updateProvider).not.toHaveBeenCalled()
    expect(service.deleteProvider).not.toHaveBeenCalled()
    expect(service.testProvider).not.toHaveBeenCalled()
    expect(gateway.loadCloudProviders).not.toHaveBeenCalled()

    state.phone = '13800138000'
    service.listProviders.mockResolvedValue([provider])
    const allowed = await request(app).get('/')
    expect(allowed.status).toBe(200)
    expect(allowed.body).toEqual({ providers: [provider] })
  })

  it('新增/编辑/启停/排序/删除都带上管理员身份，改完就重建网关', async () => {
    service.createProvider.mockResolvedValue(provider)
    const created = await request(app).post('/').send({ name: '甲家', baseUrl: 'https://api.jia.example/v1', model: 'jia-chat', apiKey: 'sk-x' })
    expect(created.body).toEqual({ provider })
    expect(service.createProvider).toHaveBeenCalledWith('admin-1', { name: '甲家', baseUrl: 'https://api.jia.example/v1', model: 'jia-chat', apiKey: 'sk-x' })
    expect(gateway.loadCloudProviders).toHaveBeenCalledTimes(1)

    service.updateProvider.mockResolvedValue({ ...provider, enabled: false })
    const toggled = await request(app).put('/p-1').send({ enabled: false })
    expect(toggled.body).toEqual({ provider: { ...provider, enabled: false } })
    expect(service.updateProvider).toHaveBeenCalledWith('admin-1', 'p-1', { enabled: false })

    service.reorderProviders.mockResolvedValue([provider])
    const ordered = await request(app).put('/order').send({ ids: ['p-1'] })
    expect(ordered.body).toEqual({ providers: [provider] })
    expect(service.reorderProviders).toHaveBeenCalledWith('admin-1', ['p-1'])

    service.deleteProvider.mockResolvedValue()
    const removed = await request(app).delete('/p-1')
    expect(removed.body).toEqual({ success: true })
    expect(service.deleteProvider).toHaveBeenCalledWith('admin-1', 'p-1')

    // 四次改动都重建了一次网关
    expect(gateway.loadCloudProviders).toHaveBeenCalledTimes(4)
  })

  it('写成功但网关没能重装时，如实说明已经保存了，不谎报失败', async () => {
    service.updateProvider.mockRejectedValueOnce(new Error('prisma exploded at postgres://internal'))
    const broken = await request(app).put('/p-1').send({ name: '甲家' })
    expect(broken.status).toBe(500)
    expect(broken.body).toEqual({ error: '模型供应商没保存成功，请重试' })

    service.updateProvider.mockResolvedValueOnce({ ...provider, enabled: false })
    gateway.loadCloudProviders.mockRejectedValueOnce(bad('密钥解不开（主密钥换过或被改动），请重新保存一次密钥', 503))
    const saved = await request(app).put('/p-1').send({ enabled: false })
    expect(saved.status).toBe(200)
    expect(saved.body.provider).toEqual({ ...provider, enabled: false })
    expect(saved.body.warning).toContain('改动已经保存，但网关没能重装')
    expect(saved.body.warning).toContain('密钥解不开')
    expect(JSON.stringify(saved.body)).not.toContain('postgres://')
  })

  it('试一下原样带回结果与失败原因；没预料的错误只给一句通用的话', async () => {
    service.testProvider.mockResolvedValue({ ok: true, latencyMs: 210, model: 'jia-chat', reply: '好' })
    const passed = await request(app).post('/p-1/test')
    expect(passed.body).toEqual({ ok: true, latencyMs: 210, model: 'jia-chat', reply: '好' })
    expect(service.testProvider).toHaveBeenCalledWith('p-1')

    service.testProvider.mockRejectedValueOnce(bad('接口返回 401，请核对地址、模型名与密钥', 502))
    const rejected = await request(app).post('/p-1/test')
    expect(rejected.status).toBe(502)
    expect(rejected.body).toEqual({ error: '接口返回 401，请核对地址、模型名与密钥' })

    service.testProvider.mockRejectedValueOnce(new Error('boom at postgres://internal'))
    const broken = await request(app).post('/p-1/test')
    expect(broken.status).toBe(500)
    expect(broken.body).toEqual({ error: '试一下没通过，请核对配置' })
  })
})
