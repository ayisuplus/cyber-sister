import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  memoryFindMany: vi.fn(),
  memoryCreate: vi.fn(),
  userUpdate: vi.fn(),
}))

vi.mock('../prisma/client.js', () => {
  const client = {
    $queryRaw: vi.fn(async () => [{ id: 'user-1' }]),
    memoryRevision: { create: vi.fn() },
    memory: { findMany: db.memoryFindMany, create: db.memoryCreate },
    user: { update: db.userUpdate, findUnique: vi.fn(async () => ({ memoryEpoch: 0 })) },
  }
  client.$transaction = vi.fn((operation) => operation(client))
  return { default: client }
})

vi.mock('../utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { applyImport as applyWithPreview, previewImport } from './importService.js'
const applyImport = (userId, payload) => applyWithPreview(userId, payload && typeof payload === 'object' && !Array.isArray(payload)
  ? { expectedMemoryEpoch: 0, ...payload } : payload)

const USER_ID = 'user-1'

const BUNDLE = {
  version: 1,
  product: 'Amie cyber-sister',
  user: {
    nickname: '小赛',
    persona: 'toxic',
    roleName: '同桌的你',
    roleSetting: '爱吐槽但会帮我讲题',
    externalLlmConsent: true,
    externalLlmConsentVersion: 'qwen-fallback-v1',
  },
  memories: [
    { type: 'semantic', content: '用户喜欢吃火锅', importance: 8, tags: ['饮食'] },
    { type: 'episodic', content: '上周和老板吵架了', importance: 6, tags: [] },
  ],
  conversations: [{ title: 'x', messages: [{ role: 'user', content: 'hi' }] }],
}

describe('importService.previewImport', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    db.memoryFindMany.mockResolvedValue([])
  })

  it('v2 缺失版本段时拒绝降级成 v1 导入', async () => {
    await expect(previewImport(USER_ID, { ...BUNDLE, version: 2 })).rejects.toMatchObject({ statusCode: 400 })
  })

  it('自家导出包：人格/记忆候选结构化，旧角色值不再导入，其余数据段如实标注不导入', async () => {
    const result = await previewImport(USER_ID, BUNDLE)

    expect(result.format).toBe('cyber-sister-export')
    expect(result).not.toHaveProperty('role')
    expect(result.persona).toMatchObject({ id: 'toxic', ok: true })
    expect(result.memoryCandidates).toHaveLength(2)
    expect(result.memoriesSkipped).toBe(0)
    expect(result.notes.join('')).toContain('不导入')
    expect(result.notes.join('')).toContain('同意状态不会导入')
  })

  it('与现有记忆规范化去重（忽略首尾空白与大小写），候选之间也去重', async () => {
    db.memoryFindMany.mockResolvedValue([{ content: '用户喜欢吃火锅' }])
    const result = await previewImport(USER_ID, {
      ...BUNDLE,
      memories: [
        { type: 'semantic', content: '  用户喜欢吃火锅 ', importance: 8, tags: [] },
        { type: 'semantic', content: '用户每周五吃火锅', importance: 6, tags: [] },
        { type: 'semantic', content: '用户每周五吃火锅', importance: 9, tags: [] },
      ],
    })

    expect(result.memoryCandidates).toEqual([
      { type: 'semantic', content: '用户每周五吃火锅', importance: 6, tags: [] },
    ])
    expect(result.memoriesSkipped).toBe(2)
  })

  it('非法候选被丢弃并计入 skipped：类型越界/内容为空/importance 越界', async () => {
    const result = await previewImport(USER_ID, {
      ...BUNDLE,
      memories: [
        { type: 'diary', content: '类型非法', importance: 5, tags: [] },
        { type: 'semantic', content: '', importance: 5, tags: [] },
        { type: 'semantic', content: '重要程度越界', importance: 99, tags: [] },
      ],
    })

    expect(result.memoryCandidates).toEqual([])
    expect(result.memoriesSkipped).toBe(3)
  })

  it('人格 id 非法时 ok=false 并带合法清单', async () => {
    const result = await previewImport(USER_ID, {
      ...BUNDLE,
      user: { ...BUNDLE.user, persona: 'wild' },
    })

    expect(result.persona).toMatchObject({ ok: false })
  })

  it('外部人设文本（角色扮演）与无法识别的格式一律 400', async () => {
    await expect(previewImport(USER_ID, { format: 'persona-text', roleName: '合租室友', roleSetting: '爱做饭' }))
      .rejects.toMatchObject({ statusCode: 400, message: '无法识别的导入格式：只支持 Amie 导出包（JSON）' })
    await expect(previewImport(USER_ID, { hello: 'world' }))
      .rejects.toMatchObject({ statusCode: 400 })
  })
})

describe('importService.applyImport', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    db.memoryFindMany.mockResolvedValue([])
    db.userUpdate.mockImplementation(({ data }) => Promise.resolve(data))
    db.memoryCreate.mockImplementation(({ data }) => Promise.resolve(data))
  })

  it('人格 + 记忆落库并计数；即使负载里带旧角色也绝不写入角色字段', async () => {
    const result = await applyImport(USER_ID, {
      role: { name: '同桌的你', setting: '爱吐槽但会帮我讲题' },
      persona: 'toxic',
      memories: [{ type: 'semantic', content: '喜欢火锅', importance: 8, tags: ['饮食'] }],
    })

    expect(result).toEqual({ personaApplied: true, memoriesApplied: 1, memoriesSkipped: 0 })
    expect(db.userUpdate).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ roleName: expect.anything() }) }))
    expect(db.userUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { persona: 'toxic' } }))
    expect(db.userUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { memoryEpoch: { increment: 1 } } }))
    expect(db.memoryCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ type: 'semantic', content: '喜欢火锅' }),
    }))
  })

  it('记忆与现有内容去重：重复项按 skipped 计数不报错', async () => {
    db.memoryFindMany.mockResolvedValue([{ content: '喜欢火锅' }])
    const result = await applyImport(USER_ID, {
      memories: [
        { type: 'semantic', content: ' 喜欢火锅 ', importance: 8, tags: [] },
        { type: 'semantic', content: '喜欢日料', importance: 5, tags: [] },
      ],
    })

    expect(result).toEqual({ personaApplied: false, memoriesApplied: 1, memoriesSkipped: 1 })
  })

  it('没有任何可导入内容时 400', async () => {
    await expect(applyImport(USER_ID, {})).rejects.toMatchObject({ statusCode: 400, message: '没有可导入的内容' })
    await expect(applyImport(USER_ID, null)).rejects.toMatchObject({ statusCode: 400 })
  })
})
