import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEPTH_KEYS,
  DEPTH_LIMITS,
  DISTILLED_KINDS,
  HONESTY_MINIMUMS,
  checkPersonaCard,
  collectCardText,
  pickDepth,
} from './card.js'

const V1 = { name: '小雨', speech: '软软的', identity: '', relationship: '陪你聊天的姐妹', samples: ['好呀'], immersion: 'high', tone: 'cool' }

const rule = (n, basis = 'source') => ({ when: `她遇到第${n}种情况`, then: `她会这样回应${n}`, basis })
const heuristics = (n = 3, basis) => Array.from({ length: n }, (_, index) => rule(index + 1, basis))
const honest = (kind = 'fiction', extra = {}) => ({
  ...V1,
  provenance: { kind, label: kind === 'public_figure' ? '某位女作家' : '某部小说' },
  heuristics: heuristics(3),
  tensions: ['嘴上说不在乎，心里记得很清楚', '想独处，又怕被忘掉'],
  boundaries: ['不知道她私下怎么想', '不会预测她没经历过的事', '资料只到整理那一天'],
  ...extra,
})

test('a v1 card is untouched: no v2 key appears, so stored cards and their prompts stay byte-identical', () => {
  const { card, error } = checkPersonaCard(V1)
  assert.equal(error, undefined)
  assert.deepEqual(Object.keys(card), ['name', 'identity', 'relationship', 'speech', 'thinking', 'decisions', 'never', 'samples', 'immersion', 'tone'])
  for (const key of DEPTH_KEYS) assert.ok(!(key in card), key)
  // 给了一堆全空的 v2 字段，也等于没给
  const blank = checkPersonaCard({ ...V1, provenance: { kind: 'original' }, expression: {}, heuristics: [{}, { when: '  ' }], models: [], values: ['', '  '], tensions: [], boundaries: [] })
  assert.deepEqual(blank.card, card)
})

test('provenance: original leaves no trace; other kinds are kept; unknown kind and bad shape are refused', () => {
  assert.ok(!('provenance' in checkPersonaCard({ ...V1, provenance: { kind: 'original', label: '自己' } }).card))
  assert.ok(!('provenance' in checkPersonaCard({ ...V1, provenance: {} }).card))
  assert.equal(checkPersonaCard({ ...V1, provenance: { kind: 'celebrity' } }).error, '来源类型必须是以下值之一: original, fiction, public_figure, friend')
  assert.equal(checkPersonaCard({ ...V1, provenance: 'fiction' }).error, '来源格式不对')
  assert.equal(checkPersonaCard({ ...V1, provenance: { kind: 'public_figure' } }).error, '公众人物要写明是谁')
  assert.equal(checkPersonaCard({ ...V1, provenance: { kind: 'fiction', label: '字'.repeat(31) } }).error, '来源名不能超过30个字符')
  assert.deepEqual(checkPersonaCard(honest('friend', { provenance: { kind: 'friend' } })).card.provenance, { kind: 'friend' })
})

test('expression: only filled dimensions are kept, each at most 80 characters', () => {
  const { card } = checkPersonaCard({ ...V1, expression: { sentence: ' 短句多 ', rhythm: '', humor: '冷幽默' } })
  assert.deepEqual(card.expression, { sentence: '短句多', humor: '冷幽默' })
  assert.equal(checkPersonaCard({ ...V1, expression: { vocabulary: '字'.repeat(81) } }).error, '表达·用词不能超过80个字符')
  assert.equal(checkPersonaCard({ ...V1, expression: 'x' }).error, '表达风格格式不对')
})

test('heuristics: complete if/then rows with a basis; blank rows are dropped; at most 8', () => {
  const ok = checkPersonaCard({ ...V1, heuristics: [rule(1, 'authored'), {}, rule(2, 'inferred')] })
  assert.deepEqual(ok.card.heuristics.map((row) => row.basis), ['authored', 'inferred'])
  assert.equal(checkPersonaCard({ ...V1, heuristics: [{ when: '她累了', basis: 'source' }] }).error, '判断规则第1条要写完整：「如果……就……」')
  assert.equal(checkPersonaCard({ ...V1, heuristics: [{ when: '她累了', then: '先陪着' }] }).error, '判断规则第1条要标明来源：来自素材、推断、我写的')
  assert.equal(checkPersonaCard({ ...V1, heuristics: [{ when: '她累了', then: '先陪着', basis: 'rumour' }] }).error, '判断规则第1条要标明来源：来自素材、推断、我写的')
  assert.equal(checkPersonaCard({ ...V1, heuristics: [{ ...rule(1), when: '字'.repeat(61) }] }).error, '判断规则第1条的「如果」不能超过60个字符')
  assert.equal(checkPersonaCard({ ...V1, heuristics: [{ ...rule(1), then: '字'.repeat(101) }] }).error, '判断规则第1条的「就」不能超过100个字符')
  assert.equal(checkPersonaCard({ ...V1, heuristics: heuristics(DEPTH_LIMITS.maxHeuristics + 1) }).error, '判断规则最多8条')
  assert.ok(checkPersonaCard({ ...V1, heuristics: heuristics(DEPTH_LIMITS.maxHeuristics) }).card)
})

test('models: name, one-line idea AND when it does not apply are all required, plus a basis', () => {
  const model = { name: '先接住再梳理', idea: '情绪没落地之前，道理听不进去', failsWhen: '她明确说只要方案时', basis: 'inferred' }
  assert.deepEqual(checkPersonaCard({ ...V1, models: [model] }).card.models, [model])
  assert.equal(checkPersonaCard({ ...V1, models: [{ ...model, failsWhen: '' }] }).error, '心智模型第1个要写完整：名字、一句话说明、什么时候不适用')
  assert.equal(checkPersonaCard({ ...V1, models: [{ ...model, basis: '' }] }).error, '心智模型第1个要标明来源：来自素材、推断、我写的')
  assert.equal(checkPersonaCard({ ...V1, models: [{ ...model, name: '字'.repeat(21) }] }).error, '心智模型第1个的名字不能超过20个字符')
  assert.equal(checkPersonaCard({ ...V1, models: Array.from({ length: 5 }, () => model) }).error, '心智模型最多4个')
})

test('values, tensions and boundaries: counted after dropping blanks, each item length-limited', () => {
  assert.equal(checkPersonaCard({ ...V1, values: ['a', 'b', 'c', 'd'] }).error, '价值观最多3条')
  assert.ok(checkPersonaCard({ ...V1, values: ['a', '', 'b', ' ', 'c'] }).card)
  assert.equal(checkPersonaCard({ ...V1, tensions: ['字'.repeat(121)] }).error, '每条内在矛盾不能超过120个字符')
  assert.equal(checkPersonaCard({ ...V1, boundaries: Array.from({ length: 7 }, (_, i) => `第${i}条`) }).error, '诚实边界最多6条')
  assert.deepEqual(checkPersonaCard({ ...V1, boundaries: ['  不知道  ', ''] }).card.boundaries, ['不知道'])
})

test('honesty is a hard requirement for every distilled kind, and only for them', () => {
  for (const kind of DISTILLED_KINDS) {
    assert.ok(checkPersonaCard(honest(kind)).card, `${kind} meeting the minimums passes`)
    assert.equal(checkPersonaCard(honest(kind, { heuristics: heuristics(HONESTY_MINIMUMS.heuristics - 1) })).error, '蒸馏出来的她至少要有3条判断规则')
    assert.equal(checkPersonaCard(honest(kind, { tensions: ['只有一处'] })).error, '蒸馏出来的她至少要写出2处自相矛盾的地方')
    assert.equal(checkPersonaCard(honest(kind, { boundaries: ['一', '二'] })).error, '蒸馏出来的她至少要写明3条做不到或不知道的事')
  }
  // 手写的原创卡：什么深度字段都不写，或只写一部分，都行
  assert.ok(checkPersonaCard({ ...V1, boundaries: ['只写一条也行'] }).card)
  assert.ok(checkPersonaCard({ ...V1, provenance: { kind: 'original' }, heuristics: [rule(1, 'authored')] }).card)
})

test('every distilled item must carry a basis, so nothing is passed off as sourced without being marked', () => {
  const missing = honest('fiction', { heuristics: [rule(1), rule(2), { when: '她被夸时', then: '先不接话' }] })
  assert.equal(checkPersonaCard(missing).error, '判断规则第3条要标明来源：来自素材、推断、我写的')
})

test('pickDepth copies only the v2 keys that are present, so editing never drops them', () => {
  const card = { ...V1, ...honest('fiction'), extra: 'x' }
  const picked = pickDepth(card)
  assert.deepEqual(Object.keys(picked), ['provenance', 'heuristics', 'tensions', 'boundaries'])
  assert.deepEqual(pickDepth(V1), {})
  assert.deepEqual(pickDepth(null), {})
  // 经过 pickDepth 再校验，得到同一张卡
  assert.deepEqual(checkPersonaCard({ ...V1, ...picked }).card, checkPersonaCard(card).card)
})

test('collectCardText gathers every string a content check must see, v1 and v2 alike', () => {
  const text = collectCardText({
    ...honest('public_figure'),
    expression: { humor: '冷幽默' },
    models: [{ name: '先接住', idea: '情绪先落地', failsWhen: '只要方案时', basis: 'source' }],
    values: ['诚实'],
  })
  for (const part of ['小雨', '软软的', '好呀', '某位女作家', '冷幽默', '她遇到第1种情况', '她会这样回应3', '先接住', '情绪先落地', '只要方案时', '诚实', '嘴上说不在乎', '不知道她私下怎么想']) {
    assert.ok(text.includes(part), `missing: ${part}`)
  }
  assert.equal(collectCardText(undefined), '')
})
