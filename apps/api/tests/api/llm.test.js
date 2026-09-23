import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

const state = vi.hoisted(() => ({
  users: new Map(),
}))

vi.mock('../../src/prisma/client.js', () => ({
  default: {
    user: {
      findUnique: async ({ where, select }) => {
        const user = state.users.get(where.id) || null
        if (!user || !select) return user
        return Object.fromEntries(Object.keys(select)
          .filter((key) => select[key])
          .map((key) => [key, user[key]]))
      },
    },
    $queryRaw: async () => [{ '?column?': 1 }],
    $disconnect: async () => {},
  },
}))

vi.mock('../../src/utils/usageTracker.js', () => ({
  default: {
    start: () => ({}), heartbeat: () => ({}), end: () => ({}),
    getStatus: () => ({}), destroy: () => {},
  },
}))

import app from '../../src/app.js'
import { generateToken } from '../../src/middleware/auth.js'

// 云端切割（2026-09-07）：/api/llm/status 只有一条云端路径；
// /api/admin/llm/local 已随本地模型面删除（404）。
describe('云端模型 API 路由合同', () => {
  beforeEach(() => {
    state.users.clear()
    state.users.set('tester', {
      id: 'tester',
      phone: '13900139000',
      externalLlmConsent: false,
      externalLlmConsentVersion: 'cloud-primary-v4',
    })
    process.env.GATEWAY_QWEN_BASE_URL = 'https://example.invalid/v1'
    process.env.GATEWAY_QWEN_MODEL = 'qwen-model'
    process.env.GATEWAY_QWEN_API_KEY = 'k'
  })

  function token(userId, phone) {
    return { Authorization: `Bearer ${generateToken({ userId, phone }) }` }
  }

  it('已登录用户可查看不含内部地址的云端状态', async () => {
    const response = await request(app)
      .get('/api/llm/status')
      .set(token('tester', '13900139000'))

    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      mode: 'external_primary',
      embedding: { configured: false, model: null, mode: 'keyword', available: null },
      workGeneration: expect.objectContaining({ mode: 'mock', cloudConnected: false }),
      local: { configured: false, state: 'removed' },
      isInstanceAdmin: false,
      externalFallback: { configured: true, primary: true, consent: false, version: 'cloud-primary-v4', providers: [] },
    })
    expect(JSON.stringify(response.body)).not.toContain('baseUrl')
  })

  it('实例管理员在状态里多一个 true 标记（设置页据此显示模型供应商卡片）', async () => {
    state.users.set('admin', { id: 'admin', phone: '13800138000' })
    const response = await request(app)
      .get('/api/llm/status')
      .set(token('admin', '13800138000'))

    expect(response.status).toBe(200)
    expect(response.body.isInstanceAdmin).toBe(true)
  })

  it('管理接口对非管理员关闭，对未认证请求要求登录', async () => {
    const anonymous = await request(app).get('/api/admin/model-providers')
    expect(anonymous.status).toBe(401)

    const tester = await request(app)
      .get('/api/admin/model-providers')
      .set(token('tester', '13900139000'))
    expect(tester.status).toBe(403)
    expect(tester.body.code).toBe('INSTANCE_ADMIN_REQUIRED')
  })

  it('供应商未配置时 externalFallback.configured 为 false', async () => {
    delete process.env.GATEWAY_QWEN_BASE_URL
    delete process.env.GATEWAY_QWEN_MODEL
    delete process.env.GATEWAY_QWEN_API_KEY

    const response = await request(app)
      .get('/api/llm/status')
      .set(token('tester', '13900139000'))

    expect(response.status).toBe(200)
    expect(response.body.externalFallback.configured).toBe(false)
  })

  it('本地模型管理端点已删除（404）', async () => {
    const response = await request(app)
      .get('/api/admin/llm/local/config')
      .set(token('tester', '13900139000'))

    expect(response.status).toBe(404)
  })
})
