import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  gatewayComplete: vi.fn(),
  researchTurn: vi.fn(),
  researchNotes: '',
}))

vi.mock('../prisma/client.js', () => ({ default: { user: { findUnique: vi.fn() } } }))
vi.mock('./consents.js', () => ({
  CONSENT_FIELDS: {},
  consentsOf: () => ({ cloud: { allowExternal: true, authorizeExternal: vi.fn() } }),
}))
vi.mock('./llmService.js', () => ({
  assertCloudCallable: vi.fn(),
  getGateway: () => ({ complete: mocks.gatewayComplete }),
  generateResponse: vi.fn(),
  imagePart: (image) => ({ type: 'image_url', image_url: { url: `data:${image.mime};base64,xxx` } }),
}))
vi.mock('./agentTurn.js', () => ({
  createAgentTurn: mocks.researchTurn,
  runAgentLoop: async function* () { yield { type: 'done', content: mocks.researchNotes } },
}))

import {
  DEFAULT_PERSONA_CARD,
  DISTILL_FAILED,
  LEGACY_PERSONA_IDS,
  MALE_REFUSAL,
  MAX_MATERIAL_CHARS,
  VULGAR_REFUSAL,
  createPersona,
  distillPersona,
  legacyPersonaCard,
  listPersonas,
  personaCardPrompt,
  personaContextOf,
  removePersona,
  resolvePersona,
  resolvePersonaByNameOrId,
  updatePersonaCard,
  validatePersonaCard,
} from './personaStudio.js'

const CARD = {
  name: '小柔',
  identity: '大学同宿舍的姐妹',
  relationship: '认识七年的闺蜜',
  speech: '轻声细语，先抱抱再讲道理',
  thinking: '先想她开不开心',
  decisions: '大事站她这边',
  never: '不催她',
  samples: ['抱抱，我在。'],
  immersion: 'medium',
  tone: 'gentle',
}

/** 内存版 prisma：personas 表 + users.persona 指针，事务直接跑在自己身上。 */
function fakeDb(personas = [], active = null) {
  const state = { personas: personas.map((persona, index) => ({ id: persona.id ?? `p${index + 1}`, userId: 'u1', createdAt: new Date(2026, 0, index + 1), ...persona })), active }
  const db = {
    $queryRaw: vi.fn(() => Promise.resolve([{ id: 'u1' }])),
    persona: {
      findFirst: vi.fn(({ where }) => {
        const match = (persona) => (!where.id || persona.id === where.id)
          && (!where.userId || persona.userId === where.userId)
          && (!where.OR || where.OR.some((clause) => (clause.id && clause.id === persona.id) || (clause.name && clause.name === persona.name)))
        return state.personas.find(match) ?? null
      }),
      findMany: vi.fn(() => state.personas),
      create: vi.fn(({ data }) => {
        const persona = { id: `p${state.personas.length + 1}`, userId: data.userId, createdAt: new Date(2026, 0, 9), name: data.name, card: data.card }
        state.personas.push(persona)
        return persona
      }),
      update: vi.fn(({ where, data }) => {
        const persona = state.personas.find((item) => item.id === where.id)
        Object.assign(persona, data)
        return persona
      }),
      delete: vi.fn(({ where }) => {
        state.personas = state.personas.filter((item) => item.id !== where.id)
      }),
    },
    user: {
      findUnique: vi.fn(() => ({ persona: state.active })),
      update: vi.fn(({ data }) => {
        state.active = data.persona
        return { persona: state.active }
      }),
    },
    $transaction: (operation) => operation(db),
  }
  return { db, state }
}

beforeEach(() => vi.clearAllMocks())

describe('validatePersonaCard：只做女孩子的她，不设风格门槛', () => {
  it('必填与字数上限逐条拦：她叫什么、她怎么说话', () => {
    expect(() => validatePersonaCard({ ...CARD, name: '' })).toThrow('她叫什么不能为空')
    expect(() => validatePersonaCard({ ...CARD, speech: '  ' })).toThrow('她怎么说话不能为空')
    expect(() => validatePersonaCard({ ...CARD, name: 'x'.repeat(21) })).toThrow('她叫什么不能超过20个字符')
    expect(() => validatePersonaCard({ ...CARD, speech: 'x'.repeat(401) })).toThrow('她怎么说话不能超过400个字符')
  })

  it('示例句最多 5 条、每条 80 字内，空句丢掉', () => {
    expect(() => validatePersonaCard({ ...CARD, samples: ['一', '二', '三', '四', '五', '六'] })).toThrow('示例句最多5条')
    expect(() => validatePersonaCard({ ...CARD, samples: ['x'.repeat(81)] })).toThrow('每条示例句不能超过80个字符')
    expect(validatePersonaCard({ ...CARD, samples: [' 在听 ', ''] }).samples).toEqual(['在听'])
  })

  it('沉浸深度与口吻底子只认枚举，缺省 medium / gentle', () => {
    expect(() => validatePersonaCard({ ...CARD, immersion: 'ultra' })).toThrow('沉浸深度必须是以下值之一')
    expect(() => validatePersonaCard({ ...CARD, tone: 'wild' })).toThrow('口吻底子必须是以下值之一')
    const card = validatePersonaCard({ ...CARD, immersion: '', tone: '' })
    expect(card.immersion).toBe('medium')
    expect(card.tone).toBe('gentle')
  })

  it('只做女孩子的她：男性指称拒掉', () => {
    expect(() => validatePersonaCard({ ...CARD, identity: '这是个男人' })).toThrow(MALE_REFUSAL)
  })

  // 男性闸只拦「明说这个角色是男性」，不拦单独提到男人（2026-10-06 计划 T2：原先的「男人」「男性」会误伤正常闺蜜设定）
  it.each(['我是男生', '我是个男生', '人设是男的', '男闺蜜', '她是个男人', '角色是男性'])('明说是男性的角色拒掉：%s', (identity) => {
    expect(() => validatePersonaCard({ ...CARD, identity })).toThrow(MALE_REFUSAL)
  })

  it.each([
    '她很会分析男人的心思，帮我看看对方到底什么意思',
    '不喜欢男人，只爱吃甜点的都市女孩',
    '她是个女生，对男性话题很敏感',
    '她不是男的',
    '毒舌闺蜜，专门吐槽渣男',
    '我是男生们的好闺蜜',
    '我是男生的好闺蜜',
    '她是个男人堆里长大的女生',
  ])('只是提到男人的正常闺蜜设定放行：%s', (identity) => {
    expect(() => validatePersonaCard({ ...CARD, identity })).not.toThrow()
    expect(() => validatePersonaCard({ ...CARD, speech: identity })).not.toThrow()
  })

  it('拒绝低俗、允许暧昧：露骨的性内容拒掉', () => {
    expect(() => validatePersonaCard({ ...CARD, speech: '陪她做爱' })).toThrow(VULGAR_REFUSAL)
    expect(() => validatePersonaCard({ ...CARD, speech: '撒娇、贴贴、有点暧昧' })).not.toThrow()
  })

  it.each(['约炮', '脱光衣服', '想上你'])('重复和交错提交始终拒绝：%s', (speech) => {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      expect(() => validatePersonaCard({ ...CARD, speech })).toThrow(VULGAR_REFUSAL)
      expect(() => validatePersonaCard({ ...CARD, speech })).toThrow(VULGAR_REFUSAL)
      expect(() => validatePersonaCard(CARD)).not.toThrow()
    }
  })

  it('落库前 trim，空字符串补齐结构', () => {
    const card = validatePersonaCard({ name: ' 小柔 ', speech: ' 轻声细语 ' })
    expect(card.name).toBe('小柔')
    expect(card.identity).toBe('')
    expect(card.samples).toEqual([])
  })
})

describe('personaCardPrompt：人设层文本', () => {
  it('固定格式，空字段整行省略，示例句带引号', () => {
    const prompt = personaCardPrompt(validatePersonaCard(CARD))
    expect(prompt).toContain('人设：小柔。'.normalize('NFKC'))
    expect(prompt).toContain('身份：大学同宿舍的姐妹'.normalize('NFKC'))
    expect(prompt).toContain('怎么说话：轻声细语，先抱抱再讲道理'.normalize('NFKC'))
    expect(prompt).toContain('示例句：「抱抱，我在。」'.normalize('NFKC'))
    expect(prompt).not.toContain('怎么想：\n'.normalize('NFKC'))

    const minimal = personaCardPrompt(validatePersonaCard({ name: '小柔', speech: '轻声细语' }))
    expect(minimal).toBe('人设：小柔。\n怎么说话：轻声细语'.normalize('NFKC'))
  })
})

describe('legacyPersonaCard：旧说话方式 → 人设卡', () => {
  it.each(LEGACY_PERSONA_IDS)('%s 折成一张卡：名字按映射表、口吻取底子、正文取内置人设段', (id) => {
    const card = legacyPersonaCard(id)
    expect(card.name).toBeTruthy()
    expect(['gentle', 'toxic', 'cool']).toContain(card.tone)
    expect(card.speech).toContain('人设：')
    expect(card.immersion).toBe('medium')
  })

  it('不认识的 id 没有卡', () => {
    expect(legacyPersonaCard('wild')).toBeNull()
    expect(legacyPersonaCard(undefined)).toBeNull()
  })
})

describe('personaContextOf：模型与句库要用的她', () => {
  it('命中卡：人设层是这张卡、沉浸档与口吻跟着卡走', async () => {
    const { db } = fakeDb([{ id: 'p1', name: '小柔', card: validatePersonaCard(CARD) }])
    const persona = await personaContextOf('u1', 'p1', db)
    expect(persona.tone).toBe('gentle')
    expect(persona.immersion).toBe('medium')
    expect(persona.personaBody).toContain('人设：小柔。'.normalize('NFKC'))
  })

  it('卡不一致时按默认卡兜底，不炸聊天', async () => {
    const { db } = fakeDb([])
    const persona = await personaContextOf('u1', 'gone', db)
    expect(persona.tone).toBe('gentle')
    expect(persona.card).toEqual(DEFAULT_PERSONA_CARD)
    expect(persona.personaBody).toContain(`人设：${DEFAULT_PERSONA_CARD.name}。`.normalize('NFKC'))
  })

  it('发给模型的人设副本脱敏，存储的卡不变', async () => {
    const card = validatePersonaCard({ ...CARD, identity: '电话13912345678，邮箱synthetic@example.test' })
    const { db } = fakeDb([{ id: 'p1', name: card.name, card }])
    const persona = await personaContextOf('u1', 'p1', db)
    expect(persona.card.identity).toBe(card.identity)
    expect(persona.personaBody).toContain('[手机号]')
    expect(persona.personaBody).toContain('[邮箱]')
    expect(persona.personaBody).not.toContain('13912345678')
    expect(persona.personaBody).not.toContain('synthetic@example.test')
  })
})

describe('人设库增删改查', () => {
  it('建卡并立即启用', async () => {
    const { db, state } = fakeDb()
    const created = await createPersona('u1', CARD, db)
    expect(created.name).toBe('小柔')
    expect(created.persona).toBe(created.id)
    expect(state.active).toBe(created.id)
  })

  it('在别人的交互事务里（itx 客户端没有 $transaction）同样能建卡启用', async () => {
    const { db, state } = fakeDb()
    const itx = { ...db }
    delete itx.$transaction
    const created = await createPersona('u1', CARD, itx)
    expect(created.name).toBe('小柔')
    expect(state.active).toBe(created.id)
    expect(itx.persona.create).toHaveBeenCalled()
  })

  it('列表按创建先后，active 标出当前启用的', async () => {
    const { db } = fakeDb([{ name: '一', card: DEFAULT_PERSONA_CARD }, { name: '二', card: DEFAULT_PERSONA_CARD }], 'p2')
    const list = await listPersonas('u1', db)
    expect(list.map((persona) => persona.name)).toEqual(['一', '二'])
    expect(list.map((persona) => persona.active)).toEqual([false, true])
  })

  it('改一改这张卡，不改变谁在启用', async () => {
    const { db, state } = fakeDb([{ name: '小柔', card: DEFAULT_PERSONA_CARD }], 'p1')
    const updated = await updatePersonaCard('u1', 'p1', { ...CARD, name: '小棉' }, db)
    expect(updated.name).toBe('小棉')
    expect(updated.persona).toBe('p1')
    expect(state.active).toBe('p1')
  })

  it('删她：只剩一个不给删；删掉启用中的就启用最早建的', async () => {
    const { db, state } = fakeDb([{ name: '一', card: DEFAULT_PERSONA_CARD }], 'p1')
    await expect(removePersona('u1', 'p1', db)).rejects.toMatchObject({ statusCode: 400, message: '至少留一个她' })

    const { db: db2, state: state2 } = fakeDb([
      { name: '一', card: DEFAULT_PERSONA_CARD },
      { name: '二', card: DEFAULT_PERSONA_CARD },
      { name: '三', card: DEFAULT_PERSONA_CARD },
    ], 'p2')
    const result = await removePersona('u1', 'p2', db2)
    expect(state2.personas.map((persona) => persona.name)).toEqual(['一', '三'])
    expect(state2.active).toBe('p1')
    expect(result.personas.map((persona) => persona.active)).toEqual([true, false])
    expect(state.personas).toHaveLength(1)
  })

  it('她不属于这个用户就是没有这个她', async () => {
    const { db } = fakeDb([{ name: '小柔', card: DEFAULT_PERSONA_CARD }])
    await expect(resolvePersona('u2', 'p1', db)).rejects.toMatchObject({ statusCode: 404, message: '没有这个她' })
  })

  it('按 id 或名字找她', async () => {
    const { db } = fakeDb([{ name: '小柔', card: DEFAULT_PERSONA_CARD }])
    await expect(resolvePersonaByNameOrId('u1', 'p1', db)).resolves.toMatchObject({ name: '小柔' })
    await expect(resolvePersonaByNameOrId('u1', '小柔', db)).resolves.toMatchObject({ id: 'p1' })
    await expect(resolvePersonaByNameOrId('u1', '不认识', db)).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('蒸馏「造一个她」', () => {
  beforeEach(() => {
    mocks.gatewayComplete.mockResolvedValue({ content: JSON.stringify({ ...CARD }) })
  })

  it('素材外发前脱敏，含图片时文本也用同一个脱敏副本', async () => {
    for (const images of [[], [{ buffer: Buffer.from('a'), mime: 'image/jpeg' }]]) {
      await distillPersona('u1', { material: '电话13912345678，邮箱synthetic@example.test', images, research: false })
      const request = mocks.gatewayComplete.mock.calls.at(-1)[0]
      const sent = JSON.stringify(request.messages)
      expect(sent).toContain('[手机号]')
      expect(sent).toContain('[邮箱]')
      expect(sent).not.toContain('13912345678')
      expect(sent).not.toContain('synthetic@example.test')
      expect(request.authorizeExternal).toBeTypeOf('function')
    }
  })

  it('联网素材与调研笔记的发送副本都脱敏', async () => {
    vi.stubEnv('SEARCH_ENABLED', 'true')
    mocks.researchTurn.mockImplementation((turn) => turn)
    mocks.researchNotes = '调研中的电话13912345678与synthetic@example.test'
    try {
      await distillPersona('u1', { material: '联系13912345678与synthetic@example.test', research: true })
      const material = mocks.researchTurn.mock.calls[0][0].currentText
      const prompt = JSON.stringify(mocks.gatewayComplete.mock.calls[0][0].messages)
      expect(prompt).toContain('调研中的电话[手机号]与[邮箱]')
      for (const sent of [material, prompt]) {
        expect(sent).toContain('[手机号]')
        expect(sent).toContain('[邮箱]')
        expect(sent).not.toContain('13912345678')
        expect(sent).not.toContain('synthetic@example.test')
      }
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('素材都不给就先要素材；超长也拦', async () => {
    await expect(distillPersona('u1', {})).rejects.toMatchObject({ statusCode: 400, message: '先给点她的素材' })
    await expect(distillPersona('u1', { material: 'x'.repeat(MAX_MATERIAL_CHARS + 1) })).rejects.toMatchObject({ statusCode: 400 })
    expect(mocks.gatewayComplete).not.toHaveBeenCalled()
  })

  it('模型只出草稿不落库；图片最多 4 张随首轮带上', async () => {
    const images = [{ buffer: Buffer.from('a'), mime: 'image/jpeg' }, { buffer: Buffer.from('b'), mime: 'image/png' }]
    const draft = await distillPersona('u1', { material: '她叫小柔', images, research: false })
    expect(draft.researched).toBe(false)
    expect(draft.card.name).toBe('小柔')
    const content = mocks.gatewayComplete.mock.calls[0][0].messages[0].content
    expect(Array.isArray(content)).toBe(true)
    expect(content.filter((part) => part.type === 'image_url')).toHaveLength(2)
  })

  it('素材的主角是男生 → refused: male，不落卡', async () => {
    mocks.gatewayComplete.mockResolvedValue({ content: '{"refuse":"male"}' })
    await expect(distillPersona('u1', { material: '一个男生', research: false })).resolves.toEqual({ refused: 'male' })
  })

  it('整理不出来 → 502 让她自己动手写；露骨的卡 → 400', async () => {
    mocks.gatewayComplete.mockResolvedValue({ content: '今天天气不错' })
    await expect(distillPersona('u1', { material: '素材', research: false })).rejects.toMatchObject({ statusCode: 502, message: DISTILL_FAILED })

    mocks.gatewayComplete.mockResolvedValue({ content: JSON.stringify({ ...CARD, speech: '陪她做爱' }) })
    await expect(distillPersona('u1', { material: '素材', research: false })).rejects.toMatchObject({ statusCode: 400, message: VULGAR_REFUSAL })
  })

  it('模型直接越男性线（没走 refuse）也按 refused: male 回', async () => {
    mocks.gatewayComplete.mockResolvedValue({ content: JSON.stringify({ ...CARD, identity: '这是个男人' }) })
    await expect(distillPersona('u1', { material: '素材', research: false })).resolves.toEqual({ refused: 'male' })
  })
})
