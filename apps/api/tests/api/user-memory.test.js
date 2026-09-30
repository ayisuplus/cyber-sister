import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'

const state = vi.hoisted(() => ({
  users: new Map(),
  memories: [],
  personas: [],
  nextMemoryId: 1,
}))

vi.mock('../../src/prisma/client.js', () => {
  function selectRecord(record, select) {
    if (!record || !select) return record
    return Object.fromEntries(Object.keys(select).filter((key) => select[key]).map((key) => [key, record[key]]))
  }

  const client = {
    memoryRevision: { create: async () => ({}), findMany: async () => [] },
    inference: { updateMany: async () => ({}), deleteMany: async () => ({}) },
    embedding: { deleteMany: async () => ({}) },
    memoryIndexJob: { updateMany: async () => ({}) },
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
          revision: 1,
          expiresAt: null,
          createdAt: now,
          updatedAt: now,
          ...data,
        }
        state.memories.push(memory)
        return memory
      },
      findMany: async ({ where, skip = 0, take = state.memories.length }) => state.memories
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
        Object.assign(memory, data, { revision: data.revision?.increment ? memory.revision + data.revision.increment : memory.revision, updatedAt: new Date() })
        return memory
      },
      delete: async ({ where }) => {
        const index = state.memories.findIndex((memory) => memory.id === where.id)
        return state.memories.splice(index, 1)[0]
      },
      deleteMany: async ({ where }) => {
        const before = state.memories.length
        state.memories = state.memories.filter((memory) => memory.userId !== where.userId || (where.id?.in && !where.id.in.includes(memory.id)))
        return { count: before - state.memories.length }
      },
    },
    persona: {
      findFirst: async ({ where }) => state.personas.find(
        (persona) => persona.id === where.id && persona.userId === where.userId,
      ) || null,
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
    state.personas = []
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

    expect(initial.body).toEqual({ accepted: null, version: 'cloud-primary-v4', updatedAt: null })
    expect(declined.body).toMatchObject({ accepted: false, version: 'cloud-primary-v4' })
    expect(accepted.body).toMatchObject({ accepted: true, version: 'cloud-primary-v4' })
    expect(state.users.get('user-1').externalLlmConsent).toBe(true)
  })

  it('已接受 v3 的用户也必须重新选择 v4', async () => {
    Object.assign(state.users.get('user-1'), {
      externalLlmConsent: true,
      externalLlmConsentVersion: 'cloud-primary-v3',
      externalLlmConsentUpdatedAt: new Date(),
    })

    const res = await request(app)
      .get('/api/user/external-llm-consent')
      .set(authed())

    expect(res.body).toEqual({ accepted: null, version: 'cloud-primary-v4', updatedAt: null })
  })

  it('人格切到她的某张人设卡；没有这个她就是 404', async () => {
    state.personas.push(
      { id: 'persona-1', userId: 'user-1', name: '小柔', card: { name: '小柔', tone: 'gentle' } },
      { id: 'persona-2', userId: 'user-2', name: '别家的她', card: { name: '别家的她', tone: 'cool' } },
    )

    const missing = await request(app)
      .put('/api/user/persona')
      .set(authed())
      .send({})
    const valid = await request(app)
      .put('/api/user/persona')
      .set(authed())
      .send({ persona: 'persona-1' })
    const foreign = await request(app)
      .put('/api/user/persona')
      .set(authed())
      .send({ persona: 'persona-2' })
    const absent = await request(app)
      .put('/api/user/persona')
      .set(authed())
      .send({ persona: 'persona-404' })

    // 现在收 Persona.id，必填：缺 id 拦在参数校验层（不再是旧的枚举校验）
    expect(missing.status).toBe(400)
    expect(missing.body.error).toBe('参数验证失败')
    // 切到该用户的这张卡：返回与落库的 persona 都是这张卡的 id
    expect(valid.status).toBe(200)
    expect(valid.body.persona).toBe('persona-1')
    expect(state.users.get('user-1').persona).toBe('persona-1')
    // 不属于这个用户的卡、不存在的卡都是「没有这个她」
    expect(foreign.status).toBe(404)
    expect(foreign.body).toEqual({ error: '没有这个她' })
    expect(absent.status).toBe(404)
    expect(absent.body).toEqual({ error: '没有这个她' })
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
      .send({ type: 'procedural', importance: 9, tags: ['偏好'], expectedRevision: created.body.revision })
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
})
