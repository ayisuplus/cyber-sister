import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'

const state = vi.hoisted(() => ({
  users: new Map(),
  memories: [],
  nextMemoryId: 1,
}))

vi.mock('../../src/prisma/client.js', () => {
  function selectRecord(record, select) {
    if (!record || !select) return record
    return Object.fromEntries(Object.keys(select).filter((key) => select[key]).map((key) => [key, record[key]]))
  }

  const client = {
    user: {
      findUnique: async ({ where, select }) => selectRecord(state.users.get(where.id) || null, select),
      update: async ({ where, data, select }) => {
        const user = state.users.get(where.id)
        if (!user) throw new Error('missing user')
        Object.assign(user, data, { updatedAt: new Date() })
        return selectRecord(user, select)
      },
    },
    memory: {
      create: async ({ data }) => {
        const now = new Date()
        const memory = {
          id: `memory-${state.nextMemoryId++}`,
          entities: null,
          expiresAt: null,
          createdAt: now,
          updatedAt: now,
          ...data,
        }
        state.memories.push(memory)
        return memory
      },
      findMany: async ({ where, skip, take }) => state.memories
        .filter((memory) => memory.userId === where.userId)
        .filter((memory) => !where.type || memory.type === where.type)
        .filter((memory) => !where.content || memory.content.includes(where.content.contains))
        .sort((a, b) => b.importance - a.importance)
        .slice(skip, skip + take),
      count: async ({ where }) => state.memories
        .filter((memory) => memory.userId === where.userId)
        .filter((memory) => !where.type || memory.type === where.type)
        .filter((memory) => !where.content || memory.content.includes(where.content.contains))
        .length,
      findFirst: async ({ where }) => state.memories.find(
        (memory) => memory.id === where.id && memory.userId === where.userId,
      ) || null,
      update: async ({ where, data }) => {
        const memory = state.memories.find((item) => item.id === where.id)
        Object.assign(memory, data, { updatedAt: new Date() })
        return memory
      },
      delete: async ({ where }) => {
        const index = state.memories.findIndex((memory) => memory.id === where.id)
        return state.memories.splice(index, 1)[0]
      },
      deleteMany: async ({ where }) => {
        const before = state.memories.length
        state.memories = state.memories.filter((memory) => memory.userId !== where.userId)
        return { count: before - state.memories.length }
      },
    },
    $queryRaw: async () => [{ '?column?': 1 }],
    $disconnect: async () => {},
  }
  client.$transaction = async (callback) => callback(client)
  return { default: client }
})

vi.mock('../../src/utils/usageTracker.js', () => ({
  default: {
    start: () => ({ minutes: 0, shouldRemind: false }),
    heartbeat: () => ({ minutes: 0, shouldRemind: false }),
    end: () => ({ minutes: 0, shouldRemind: false }),
    getStatus: () => ({ minutes: 0, shouldRemind: false, isActive: false }),
    destroy: () => {},
  },
}))

import app from '../../src/app.js'
import { generateToken } from '../../src/middleware/auth.js'

describe('用户、同意与显式记忆 API', () => {
  let accessToken

  beforeEach(() => {
    state.users.clear()
    state.memories = []
    state.nextMemoryId = 1
    state.users.set('user-1', {
      id: 'user-1',
      phone: '13800138000',
      nickname: '内测用户',
      persona: 'toxic',
      externalLlmConsent: null,
      externalLlmConsentVersion: null,
      externalLlmConsentUpdatedAt: null,
      isVip: false,
      vipExpireAt: null,
      avatarUrl: null,
      birthDate: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    state.users.set('user-2', {
      id: 'user-2',
      phone: '13900139000',
      persona: 'toxic',
      externalLlmConsent: null,
      externalLlmConsentVersion: null,
      externalLlmConsentUpdatedAt: null,
      isVip: false,
    })
    accessToken = generateToken({ userId: 'user-1', phone: '13800138000' })
  })

  const authed = () => ({ Authorization: `Bearer ${accessToken}` })

  it('同意状态初始为未选择，并可记录拒绝与接受', async () => {
    const initial = await request(app)
      .get('/api/user/external-llm-consent')
      .set(authed())
    const declined = await request(app)
      .put('/api/user/external-llm-consent')
      .set(authed())
      .send({ accepted: false })
    const accepted = await request(app)
      .put('/api/user/external-llm-consent')
      .set(authed())
      .send({ accepted: true })

    expect(initial.body).toEqual({ accepted: null, version: 'cloud-primary-v1', updatedAt: null })
    expect(declined.body).toMatchObject({ accepted: false, version: 'cloud-primary-v1' })
    expect(accepted.body).toMatchObject({ accepted: true, version: 'cloud-primary-v1' })
    expect(state.users.get('user-1').externalLlmConsent).toBe(true)
  })

  it('旧版本同意会自动回到未选择状态', async () => {
    Object.assign(state.users.get('user-1'), {
      externalLlmConsent: true,
      externalLlmConsentVersion: 'qwen-data-v0',
      externalLlmConsentUpdatedAt: new Date(),
    })

    const res = await request(app)
      .get('/api/user/external-llm-consent')
      .set(authed())

    expect(res.body).toEqual({ accepted: null, version: 'cloud-primary-v1', updatedAt: null })
  })

  it('人格只接受 toxic、gentle 和 rational', async () => {
    const valid = await request(app)
      .put('/api/user/persona')
      .set(authed())
      .send({ persona: 'rational' })
    const invalid = await request(app)
      .put('/api/user/persona')
      .set(authed())
      .send({ persona: 'wild' })

    expect(valid.status).toBe(200)
    expect(valid.body.persona).toBe('rational')
    expect(invalid.status).toBe(400)
  })

  it('新用户记忆为空且不会注入虚构数据', async () => {
    const res = await request(app).get('/api/memories').set(authed())

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ data: [], total: 0, page: 1, limit: 20 })
    expect(state.memories).toHaveLength(0)
  })

  it('用户可创建、编辑和删除自己的显式记忆', async () => {
    const created = await request(app)
      .post('/api/memories')
      .set(authed())
      .send({ type: 'semantic', content: ' 我不吃香菜 ', importance: 8, tags: ['饮食', '饮食'] })
    const updated = await request(app)
      .put(`/api/memories/${created.body.id}`)
      .set(authed())
      .send({ type: 'procedural', importance: 9, tags: ['偏好'] })
    const deleted = await request(app)
      .delete(`/api/memories/${created.body.id}`)
      .set(authed())

    expect(created.status).toBe(201)
    expect(created.body).toMatchObject({ content: '我不吃香菜', importance: 8, tags: ['饮食'] })
    expect(updated.body).toMatchObject({ type: 'procedural', importance: 9, tags: ['偏好'] })
    expect(deleted.body).toEqual({ success: true })
    expect(state.memories).toHaveLength(0)
  })

  it('拒绝非法记忆字段并阻止跨用户资源修改', async () => {
    const invalid = await request(app)
      .post('/api/memories')
      .set(authed())
      .send({ type: 'unknown', content: '内容', importance: 11, tags: [] })
    state.memories.push({
      id: 'other-memory',
      userId: 'user-2',
      type: 'semantic',
      content: '其他用户的数据',
      importance: 5,
      tags: '[]',
      entities: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    const crossUser = await request(app)
      .put('/api/memories/other-memory')
      .set(authed())
      .send({ content: '越权修改' })

    expect(invalid.status).toBe(400)
    expect(crossUser.status).toBe(404)
    expect(state.memories[0].content).toBe('其他用户的数据')
  })

  it('会员写接口明确返回未开放，不执行伪购买', async () => {
    const res = await request(app)
      .post('/api/user/membership/subscribe')
      .set(authed())

    expect(res.status).toBe(409)
    expect(res.body.code).toBe('FEATURE_NOT_AVAILABLE')
  })
})
