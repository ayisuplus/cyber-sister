import { describe, expect, it } from 'vitest'
import {
  IMMERSIONS,
  MAX_DISTILL_IMAGES,
  MAX_MATERIAL_CHARS,
  MAX_SAMPLES,
  PERSONA_CARD_LIMITS,
  PERSONA_FIELD_LABELS,
  TONES,
  DISTILL_KINDS,
  FRIEND_NEEDS_ATTESTATION,
  PUBLIC_FIGURE_NEEDS_NAME,
  blankHeuristic,
  blankModel,
  buildPersonaCard,
  canResearchKind,
  emptyPersonaCard,
  hasDepth,
  provenanceBadge,
  sampleLineOf,
  validateDistillSource,
  validatePersonaCard,
} from './personas'

const filled = (overrides = {}) => ({ ...emptyPersonaCard(), name: '小柔', speech: '有话直说。', ...overrides })

describe('人设卡常量与预校验', () => {
  it('字数/条数上限与字段标签来自共享包 persona-card（API 与 Web 同源）', () => {
    expect(PERSONA_CARD_LIMITS).toEqual({
      name: 20, identity: 300, relationship: 200, speech: 400, thinking: 400, decisions: 300, never: 300, sample: 80,
    })
    expect(MAX_SAMPLES).toBe(5)
    expect(MAX_MATERIAL_CHARS).toBe(5000)
    expect(MAX_DISTILL_IMAGES).toBe(4)
    expect(PERSONA_FIELD_LABELS).toEqual({
      name: '她叫什么',
      identity: '她是谁',
      relationship: '她和你什么关系',
      speech: '她怎么说话',
      thinking: '她怎么看事情',
      decisions: '她遇事怎么判断',
      never: '她绝不做什么',
    })
  })

  it('沉浸深度与口吻底子是共享包里的那三个枚举值', () => {
    expect(IMMERSIONS).toEqual(['low', 'medium', 'high'])
    expect(TONES).toEqual(['gentle', 'toxic', 'cool'])
  })

  it('必填与字数预校验跟服务端同口径', () => {
    expect(validatePersonaCard(emptyPersonaCard())).toBe('她叫什么不能为空')
    expect(validatePersonaCard(filled({ name: '' }))).toBe('她叫什么不能为空')
    expect(validatePersonaCard(filled({ speech: '  ' }))).toBe('她怎么说话不能为空')
    expect(validatePersonaCard(filled({ name: '她'.repeat(21) }))).toBe('她叫什么不能超过20个字符')
    expect(validatePersonaCard(filled({ identity: '她'.repeat(301) }))).toBe('她是谁不能超过300个字符')
    expect(validatePersonaCard(filled({ speech: '她'.repeat(401) }))).toBe('她怎么说话不能超过400个字符')
    expect(validatePersonaCard(filled())).toBeNull()
  })

  it('示例句最多 5 条、每条 80 字内（空行不算数）', () => {
    expect(validatePersonaCard(filled({ samples: ['1', '2', '3', '4', '5', '6'] }))).toBe('示例句最多5条')
    expect(validatePersonaCard(filled({ samples: ['她'.repeat(81)] }))).toBe('每条示例句不能超过80个字符')
    expect(validatePersonaCard(filled({ samples: ['', '  ', '1', '2', '3', '4', '5'] }))).toBeNull()
    expect(validatePersonaCard(filled({ samples: ['她'.repeat(80)] }))).toBeNull()
  })

  it('提交前归一：trim、示例句去空、枚举缺省回 medium/gentle', () => {
    expect(buildPersonaCard({
      name: ' 小柔 ', speech: ' 有话直说。 ', identity: '  ', samples: [' 抱抱你。 ', '', '   '],
      immersion: 'bogus', tone: '',
    })).toEqual({
      name: '小柔', identity: '', relationship: '', speech: '有话直说。',
      thinking: '', decisions: '', never: '', samples: ['抱抱你。'], immersion: 'medium', tone: 'gentle',
    })
    expect(buildPersonaCard(filled({ immersion: 'high', tone: 'toxic' })))
      .toMatchObject({ immersion: 'high', tone: 'toxic' })
  })

  it('列表里的一句示例句：先示例句第一条，没有就截「她怎么说话」第一句', () => {
    expect(sampleLineOf({ samples: [' 抱抱你。 ', '第二句。'], speech: '后面再说。' })).toBe('抱抱你。')
    expect(sampleLineOf({ samples: [], speech: '有话直说，护短。再多说一句。' })).toBe('有话直说，护短。')
    expect(sampleLineOf({ speech: '嗯，我在' })).toBe('嗯，我在')
    expect(sampleLineOf({ speech: '' })).toBe('')
    expect(sampleLineOf(undefined)).toBe('')
  })
})

describe('v2 深度字段（人设深度化 T3）', () => {
  const rules = [1, 2, 3].map((n) => ({ when: `情况${n}`, then: `回应${n}`, basis: 'source' }))
  const deep = filled({
    provenance: { kind: 'fiction', label: '某部小说' },
    heuristics: rules,
    tensions: ['嘴上说不在乎', '想独处，又怕被忘掉'],
    boundaries: ['不知道她私下怎么想', '不会预测她没经历过的事', '资料只到整理那一天'],
  })

  it('buildPersonaCard 把深度字段原样带上，旧草稿不会多出任何 v2 字段', () => {
    const card = buildPersonaCard(deep)
    expect(card.provenance).toEqual({ kind: 'fiction', label: '某部小说' })
    expect(card.heuristics).toEqual(rules)
    expect(Object.keys(buildPersonaCard(filled()))).toEqual(['name', 'identity', 'relationship', 'speech', 'thinking', 'decisions', 'never', 'samples', 'immersion', 'tone'])
  })

  it('预校验把深度字段的问题当场说出来，不用等服务端', () => {
    expect(validatePersonaCard(deep)).toBeNull()
    expect(validatePersonaCard({ ...deep, boundaries: ['只有一条'] })).toBe('蒸馏出来的她至少要写明3条做不到或不知道的事')
    expect(validatePersonaCard({ ...deep, heuristics: [...rules.slice(0, 2), { when: '她被夸时', then: '先不接话' }] })).toContain('要标明来源')
  })
})

describe('造她的来源类型（人设深度化 T6）', () => {
  it('四种来源，缺省的「自己想的」排第一', () => {
    expect(DISTILL_KINDS.map((item) => item.kind)).toEqual(['original', 'fiction', 'public_figure', 'friend'])
    for (const item of DISTILL_KINDS) expect(item.hint.length).toBeGreaterThan(0)
  })

  it('只有虚构角色与公众人物才有公开资料可查：自己想的不查，朋友绝不联网查人', () => {
    expect(canResearchKind('fiction')).toBe(true)
    expect(canResearchKind('public_figure')).toBe(true)
    expect(canResearchKind('original')).toBe(false)
    expect(canResearchKind('friend')).toBe(false)
    expect(canResearchKind(undefined)).toBe(false)
  })

  it('预校验与服务端同口径：公众人物要写明是谁，朋友要先声明，来源名不超长', () => {
    expect(validateDistillSource({ kind: 'original' })).toBeNull()
    expect(validateDistillSource({ kind: 'fiction', label: '' })).toBeNull()
    expect(validateDistillSource({ kind: 'public_figure', label: '  ' })).toBe(PUBLIC_FIGURE_NEEDS_NAME)
    expect(validateDistillSource({ kind: 'public_figure', label: '某位女作家' })).toBeNull()
    expect(validateDistillSource({ kind: 'friend', attested: false })).toBe(FRIEND_NEEDS_ATTESTATION)
    expect(validateDistillSource({ kind: 'friend' })).toBe(FRIEND_NEEDS_ATTESTATION)
    expect(validateDistillSource({ kind: 'friend', attested: true })).toBeNull()
    expect(validateDistillSource({ kind: 'fiction', label: '字'.repeat(31) })).toBe('来源名不能超过30个字符')
  })
})

describe('来源标注与深度的辅助函数（人设深度化 T6）', () => {
  it('provenanceBadge：虚构角色带作品名，公众人物写明「不代表本人」，朋友写明来自聊天记录，原创与旧卡没有', () => {
    expect(provenanceBadge({ provenance: { kind: 'fiction', label: '某部小说' } })).toBe('虚构角色 · 某部小说')
    expect(provenanceBadge({ provenance: { kind: 'fiction' } })).toBe('虚构角色')
    expect(provenanceBadge({ provenance: { kind: 'public_figure', label: '某位女作家' } })).toBe('受某位女作家公开言论启发的 AI，不代表本人')
    expect(provenanceBadge({ provenance: { kind: 'friend' } })).toBe('来自你提供的聊天记录')
    for (const card of [{}, null, undefined, { provenance: { kind: 'original' } }, { provenance: 'x' }]) expect(provenanceBadge(card)).toBe('')
  })

  it('hasDepth：来源标注不算深度；有判断规则、边界这些才算', () => {
    expect(hasDepth(filled())).toBe(false)
    expect(hasDepth(filled({ provenance: { kind: 'friend' } }))).toBe(false)
    expect(hasDepth(filled({ boundaries: ['不知道'] }))).toBe(true)
    expect(hasDepth(null)).toBe(false)
  })

  it('手加的新行来源默认「我写的」', () => {
    expect(blankHeuristic()).toEqual({ when: '', then: '', basis: 'authored' })
    expect(blankModel()).toEqual({ name: '', idea: '', failsWhen: '', basis: 'authored' })
  })
})
