/**
 * 内容检测模块单元测试
 *
 * 危机检测是核心安全逻辑，本测试确保：
 * 1. 高/中风险词能正确识别并分级
 * 2. 风险优先级正确（high > medium）
 * 3. 情绪标签分类准确
 * 4. 边界输入（空、null、非字符串）不崩溃
 * 5. 关键词列表的完整性有快照保护，防止误删
 */
import { describe, it, expect } from 'vitest'
import {
  detectCrisis,
  detectEmotion,
  CRISIS_HIGH_RISK,
  CRISIS_MEDIUM_RISK,
  EMOTION_KEYWORDS,
  getCrisisIntervention,
} from './detection.js'

describe('detectCrisis 危机检测', () => {
  describe('高风险识别', () => {
    it('每个高风险关键词都应返回 high', () => {
      for (const word of CRISIS_HIGH_RISK) {
        expect(detectCrisis(word), `关键词「${word}」应识别为 high`).toBe('high')
      }
    })

    it('关键词嵌入在长句中也应识别', () => {
      expect(detectCrisis('我真的好想结束生命，撑不下去了')).toBe('high')
      expect(detectCrisis('今晚就想跳楼，一了百了')).toBe('high')
    })

    it.each([
      '今晚准备吃安眠药结束自己',
      '我已经准备好去死了',
      '我打算从天台跳下去',
      '我只是想结束这一切',
      '我 想 自 杀',
      '我想從天臺跳下去輕生',
      '看完电影我也想死',
      '电影里有人自杀，我也想死',
      '我看了自杀预防科普，但现在我想死',
    ])('冻结高风险改写：%s', (text) => {
      expect(detectCrisis(text)).toBe('high')
    })
  })

  describe('中风险识别', () => {
    it('每个中风险关键词都应返回 medium', () => {
      for (const word of CRISIS_MEDIUM_RISK) {
        expect(detectCrisis(word), `关键词「${word}」应识别为 medium`).toBe('medium')
      }
    })

    it('中风险关键词嵌入长句也应识别', () => {
      expect(detectCrisis('最近觉得活着好累，什么都不想干')).toBe('medium')
    })
  })

  describe('优先级', () => {
    it('同时包含高、中风险词时，应返回 high（高风险优先）', () => {
      const text = '活着好累，我干脆结束生命算了'
      expect(detectCrisis(text)).toBe('high')
    })
  })

  describe('无风险', () => {
    it('普通日常对话应返回 null', () => {
      expect(detectCrisis('今天天气真好，出去逛街了')).toBeNull()
      expect(detectCrisis('升职加薪了，太开心了')).toBeNull()
      expect(detectCrisis('医生说这个药要饭后吃药')).toBeNull()
      expect(detectCrisis('这个弹窗怎么消失')).toBeNull()
    })

    it('包含"死"字但非危机语境的常见误报需关注', () => {
      // "笑死我了"不含任何高风险关键词，应返回 null
      expect(detectCrisis('哈哈哈笑死我了')).toBeNull()
    })

    it.each([
      '我在做自杀预防科普',
      '这篇论文研究自残预防',
      '电影里的角色最后想死',
      '我没有想自杀，只是在回答问卷',
      '我不想自残，请不用担心',
    ])('明确非自伤语境不应误报：%s', (text) => {
      expect(detectCrisis(text)).toBeNull()
    })
  })

  describe('边界输入', () => {
    it('空字符串返回 null', () => {
      expect(detectCrisis('')).toBeNull()
    })

    it('null / undefined 不崩溃，返回 null', () => {
      expect(detectCrisis(null)).toBeNull()
      expect(detectCrisis(undefined)).toBeNull()
    })

    it('非字符串输入不崩溃，返回 null', () => {
      expect(detectCrisis(123)).toBeNull()
      expect(detectCrisis({})).toBeNull()
    })
  })
})

describe('detectEmotion 情绪检测', () => {
  it('每种情绪的代表性关键词都能正确分类', () => {
    expect(detectEmotion('气死我了，这人太过分')).toBe('angry')
    expect(detectEmotion('好难过，忍不住想哭')).toBe('sad')
    expect(detectEmotion('太棒了，终于脱单了')).toBe('happy')
    expect(detectEmotion('好焦虑，不知道怎么办')).toBe('anxious')
  })

  it('无明显情绪词时返回 neutral', () => {
    expect(detectEmotion('我今天吃了碗面')).toBe('neutral')
  })

  it('边界输入返回 neutral 且不崩溃', () => {
    expect(detectEmotion('')).toBe('neutral')
    expect(detectEmotion(null)).toBe('neutral')
    expect(detectEmotion(undefined)).toBe('neutral')
    expect(detectEmotion(42)).toBe('neutral')
  })
})

describe('关键词列表完整性（防误删保护）', () => {
  it('高风险关键词数量不应无故减少', () => {
    expect(CRISIS_HIGH_RISK.length).toBeGreaterThanOrEqual(10)
  })

  it('中风险关键词数量不应无故减少', () => {
    expect(CRISIS_MEDIUM_RISK.length).toBeGreaterThanOrEqual(6)
  })

  it('情绪关键词应覆盖四种情绪', () => {
    expect(Object.keys(EMOTION_KEYWORDS).sort()).toEqual(['angry', 'anxious', 'happy', 'sad'])
  })

  it('关键词不应为空字符串', () => {
    for (const w of [...CRISIS_HIGH_RISK, ...CRISIS_MEDIUM_RISK]) {
      expect(w.trim().length, `关键词「${w}」不应为空`).toBeGreaterThan(0)
    }
  })
})

describe('getCrisisIntervention 固定干预资源', () => {
  it('默认内容不包含未经核验的热线号码', () => {
    const intervention = getCrisisIntervention('high', {})
    expect(intervention.level).toBe('high')
    expect(intervention.resources.length).toBeGreaterThan(0)
    expect(JSON.stringify(intervention)).not.toMatch(/\b\d{5,}\b/)
  })

  it('仅接受结构完整的运营配置', () => {
    const approved = [{ type: 'local', label: '已核验资源', guidance: '已审批说明' }]
    expect(getCrisisIntervention('medium', {
      CRISIS_RESOURCES_JSON: JSON.stringify(approved),
    }).resources).toEqual(approved)

    expect(getCrisisIntervention('medium', { CRISIS_RESOURCES_JSON: '{}' }).resources)
      .not.toEqual([])
  })
})

describe('detectCrisis 归一化绕过与亲昵误判回归', () => {
  it.each([
    '我想自殘',
    '我自殘了',
    '準備自殺',
    '我計劃結束生命',
    '我已經決定了結自己',
    '現在就想跳樓',
    '準備吃安眠藥結束自己',
    '我打算從橋上跳下去',
  ])('繁体写法不绕过检测：%s', (text) => {
    expect(detectCrisis(text)).toBe('high')
  })

  it.each([
    '活著好累',
    '沒人愛我',
    '我是個廢物',
  ])('繁体中风险写法正确分级：%s', (text) => {
    expect(detectCrisis(text)).toBe('medium')
  })

  it.each([
    '自­杀',
    '自⁠杀',
    '自杀',
    '跳﻿楼',
    '自︀杀',
  ])('插入格式/组合字符不绕过检测', (text) => {
    expect(detectCrisis(text)).toBe('high')
  })

  it.each([
    '想死你了',
    '我想死你了',
    '想死你啦',
    '想死你们了',
  ])('亲昵口语「想死你了」不误判：%s', (text) => {
    expect(detectCrisis(text)).toBeNull()
  })

  it('亲昵语境不掩护同句的真实自我伤害表达', () => {
    expect(detectCrisis('想死你了，我也想自杀')).toBe('high')
  })
})
