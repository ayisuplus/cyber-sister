import { describe, expect, it } from 'vitest'
import {
  IMMERSIONS,
  MAX_DISTILL_IMAGES,
  MAX_MATERIAL_CHARS,
  MAX_SAMPLES,
  PERSONA_CARD_LIMITS,
  PERSONA_FIELD_LABELS,
  TONES,
  buildPersonaCard,
  emptyPersonaCard,
  sampleLineOf,
  validatePersonaCard,
} from './personas'

const filled = (overrides = {}) => ({ ...emptyPersonaCard(), name: '小柔', speech: '有话直说。', ...overrides })

describe('人设卡常量与预校验', () => {
  it('字数/条数上限与字段标签跟服务端 personaStudio 同值（漂移守卫）', () => {
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

  it('沉浸深度与口吻底子就是服务端那三个枚举值', () => {
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
