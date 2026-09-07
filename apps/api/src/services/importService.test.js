import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  memoryFindMany: vi.fn(),
  memoryCreate: vi.fn(),
  userUpdate: vi.fn(),
}))

vi.mock('../prisma/client.js', () => ({
  default: {
    memory: { findMany: db.memoryFindMany, create: db.memoryCreate },
    user: { update: db.userUpdate },
  },
}))

vi.mock('../utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { applyImport, previewImport } from './importService.js'

const USER_ID = 'user-1'

const BUNDLE = {
  version: 1,
  product: '赛博姐妹 cyber-sister',
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

  it('自家导出包：角色/人格/记忆候选全部结构化，其余数据段如实标注不导入', async () => {
    const result = await previewImport(USER_ID, BUNDLE)

    expect(result.format).toBe('cyber-sister-export')
    expect(result.role).toMatchObject({ name: '同桌的你', ok: true })
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

  it('角色扮演命中恋人红线时 ok=false 并带原因，不阻断记忆候选', async () => {
    const result = await previewImport(USER_ID, {
      ...BUNDLE,
      user: { ...BUNDLE.user, roleName: '我的女朋友' },
    })

    expect(result.role).toMatchObject({ ok: false, error: expect.stringContaining('我是你姐妹，不是你对象') })
    expect(result.memoryCandidates).toHaveLength(2)
  })

  it('人格 id 非法时 ok=false 并带合法清单', async () => {
    const result = await previewImport(USER_ID, {
      ...BUNDLE,
      user: { ...BUNDLE.user, persona: 'wild' },
    })

    expect(result.persona).toMatchObject({ ok: false })
  })

  it('persona-text 格式：只产出角色候选，说明记忆走帮我记住', async () => {
    const result = await previewImport(USER_ID, {
      format: 'persona-text',
      roleName: '合租室友',
      roleSetting: '爱做饭，经常喊我一起吃饭',
    })

    expect(result.format).toBe('persona-text')
    expect(result.role).toMatchObject({ ok: true, name: '合租室友' })
    expect(result.memoryCandidates).toEqual([])
    expect(result.notes[0]).toContain('帮我记住')
  })

  it('persona-text 空人设 400；无法识别的格式 400', async () => {
    await expect(previewImport(USER_ID, { format: 'persona-text', roleName: '', roleSetting: '' }))
      .rejects.toMatchObject({ statusCode: 400, message: '人设文本不能为空' })
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

  it('角色扮演经恋人红线闸：命中即 400，不落任何内容', async () => {
    await expect(applyImport(USER_ID, { role: { name: '我的女朋友', setting: '温柔' }, memories: [{ type: 'semantic', content: 'x', importance: 5, tags: [] }] }))
      .rejects.toMatchObject({ statusCode: 400 })
    expect(db.userUpdate).not.toHaveBeenCalled()
    expect(db.memoryCreate).not.toHaveBeenCalled()
  })

  it('角色 + 人格 + 记忆全部落库并计数', async () => {
    const result = await applyImport(USER_ID, {
      role: { name: '同桌的你', setting: '爱吐槽但会帮我讲题' },
      persona: 'toxic',
      memories: [{ type: 'semantic', content: '喜欢火锅', importance: 8, tags: ['饮食'] }],
    })

    expect(result).toEqual({ roleApplied: true, personaApplied: true, memoriesApplied: 1, memoriesSkipped: 0 })
    expect(db.userUpdate).toHaveBeenCalledTimes(2)
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

    expect(result).toEqual({ roleApplied: false, personaApplied: false, memoriesApplied: 1, memoriesSkipped: 1 })
  })

  it('没有任何可导入内容时 400', async () => {
    await expect(applyImport(USER_ID, {})).rejects.toMatchObject({ statusCode: 400, message: '没有可导入的内容' })
    await expect(applyImport(USER_ID, null)).rejects.toMatchObject({ statusCode: 400 })
  })
})
