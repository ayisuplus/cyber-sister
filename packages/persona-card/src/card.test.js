import test from 'node:test'
import assert from 'node:assert/strict'
import {
  IMMERSIONS,
  MAX_DISTILL_IMAGES,
  MAX_MATERIAL_CHARS,
  MAX_SAMPLES,
  PERSONA_CARD_LIMITS,
  PERSONA_FIELD_LABELS,
  REQUIRED_FIELDS,
  TONES,
  checkPersonaCard,
} from './card.js'

const BASE = { name: '小雨', speech: '软软的，爱用颜文字' }

test('limits, labels and enums are the single source API and web both import', () => {
  assert.deepEqual({ ...PERSONA_CARD_LIMITS }, {
    name: 20, identity: 300, relationship: 200, speech: 400, thinking: 400, decisions: 300, never: 300, sample: 80,
  })
  assert.equal(MAX_SAMPLES, 5)
  assert.equal(MAX_MATERIAL_CHARS, 5000)
  assert.equal(MAX_DISTILL_IMAGES, 4)
  assert.deepEqual([...IMMERSIONS], ['low', 'medium', 'high'])
  assert.deepEqual([...TONES], ['gentle', 'toxic', 'cool'])
  assert.deepEqual([...REQUIRED_FIELDS], ['name', 'speech'])
  assert.deepEqual(Object.keys(PERSONA_FIELD_LABELS), ['name', 'identity', 'relationship', 'speech', 'thinking', 'decisions', 'never'])
})

test('a minimal card passes and is normalised: trimmed, empty samples dropped, enums defaulted', () => {
  const { card, error } = checkPersonaCard({ ...BASE, name: '  小雨  ', samples: ['  好呀  ', '', '   '] })
  assert.equal(error, undefined)
  assert.equal(card.name, '小雨')
  assert.deepEqual(card.samples, ['好呀'])
  assert.equal(card.immersion, 'medium')
  assert.equal(card.tone, 'gentle')
  assert.equal(card.identity, '')
})

test('non-object input is an empty card, so the required fields fail first', () => {
  for (const input of [null, undefined, 'x', 7, [], [BASE]]) {
    assert.equal(checkPersonaCard(input).error, '她叫什么不能为空')
  }
})

test('required fields and per-field limits report the first failure in field order', () => {
  assert.equal(checkPersonaCard({ speech: '嗯' }).error, '她叫什么不能为空')
  assert.equal(checkPersonaCard({ name: '小雨' }).error, '她怎么说话不能为空')
  assert.equal(checkPersonaCard({ ...BASE, name: '字'.repeat(21) }).error, '她叫什么不能超过20个字符')
  assert.equal(checkPersonaCard({ ...BASE, never: '字'.repeat(301) }).error, '她绝不做什么不能超过300个字符')
  // name 先于 speech：两个都不对时报 name
  assert.equal(checkPersonaCard({ name: '字'.repeat(21), speech: '' }).error, '她叫什么不能超过20个字符')
  // 恰好在上限上不算超
  assert.ok(checkPersonaCard({ ...BASE, speech: '字'.repeat(400) }).card)
})

test('samples: at most 5, each at most 80 characters, counted after trimming and dropping empties', () => {
  const six = Array.from({ length: 6 }, (_, index) => `第${index}句`)
  assert.equal(checkPersonaCard({ ...BASE, samples: six }).error, '示例句最多5条')
  assert.ok(checkPersonaCard({ ...BASE, samples: [...six.slice(0, 5), '', '  '] }).card)
  assert.equal(checkPersonaCard({ ...BASE, samples: ['字'.repeat(81)] }).error, '每条示例句不能超过80个字符')
  assert.ok(checkPersonaCard({ ...BASE, samples: ['字'.repeat(80)] }).card)
  assert.deepEqual(checkPersonaCard({ ...BASE, samples: 'not-an-array' }).card.samples, [])
})

test('enums: strict on the server, lenient for the form', () => {
  assert.equal(checkPersonaCard({ ...BASE, immersion: 'wild' }).error, '沉浸深度必须是以下值之一: low, medium, high')
  assert.equal(checkPersonaCard({ ...BASE, tone: 'wild' }).error, '口吻底子必须是以下值之一: gentle, toxic, cool')
  const lenient = checkPersonaCard({ ...BASE, immersion: 'wild', tone: 'wild' }, { lenient: true })
  assert.equal(lenient.card.immersion, 'medium')
  assert.equal(lenient.card.tone, 'gentle')
  assert.equal(checkPersonaCard({ ...BASE, immersion: 'high', tone: 'cool' }).card.immersion, 'high')
  // 空串当缺省
  assert.equal(checkPersonaCard({ ...BASE, immersion: '', tone: '' }).card.tone, 'gentle')
})
