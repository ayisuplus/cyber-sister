/**
 * 说话方式提示词的守卫：名字承诺什么，提示词就得是什么。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getPersonaSystemPrompt, VALID_PERSONA_IDS } from './personas.js'

test('unknown speaking style falls back to gentle, the product default', () => {
  assert.equal(getPersonaSystemPrompt('no-such-style'), getPersonaSystemPrompt('gentle'))
  assert.equal(getPersonaSystemPrompt(undefined), getPersonaSystemPrompt('gentle'))
})

test('the quiet style is quiet, not cold or distant', () => {
  const quiet = getPersonaSystemPrompt('cool')
  assert.match(quiet, /安静/)
  for (const pushAway of ['高冷', '有距离感', '……随你']) {
    assert.ok(!quiet.includes(pushAway), `quiet style must not say ${pushAway}`)
  }
})

test('every style keeps the shared safety boundary', () => {
  for (const id of VALID_PERSONA_IDS) {
    assert.match(getPersonaSystemPrompt(id), /你是 AI，不是真人/)
  }
})

test('every style carries the shared layer for how she answers a girl', () => {
  const clauses = [
    '先接住情绪，再松动比较与灾难化的框架',
    '不评判她的身体与外貌',
    '不替那个人下诊断',
    '她的决定永远归她',
    '不让自己成为她唯一的出口',
    '她只是想被陪着的时候',
  ]
  for (const id of VALID_PERSONA_IDS) {
    const prompt = getPersonaSystemPrompt(id)
    for (const clause of clauses) assert.ok(prompt.includes(clause), `${id} is missing ${clause}`)
  }
})

test('the blunt style catches her feeling first, then roasts the thing, never her feeling', () => {
  // 2026-09-23 基线：「先怼回去让她清醒」和共用前言的「先接住情绪」互相矛盾，直爽方式先接住情绪的通过率最低
  const blunt = getPersonaSystemPrompt('toxic')
  assert.ok(!blunt.includes('先怼回去'), 'blunt style must not roast before catching her feeling')
  const body = blunt.slice(blunt.indexOf('\n人设：'))
  assert.ok(body.indexOf('先用一句话接住她的情绪') < body.indexOf('再去怼那件事'), 'catch first, roast after')
  assert.ok(body.includes('她的感受永远不是被怼的对象'))
})

test('the energetic style does not push her to act right now', () => {
  const prompt = getPersonaSystemPrompt('energetic')
  assert.ok(!prompt.includes('现在就做'), 'energetic style must not push 现在就做')
  assert.ok(prompt.includes('不催'), 'energetic style must say 不催')
})

test('the order is safety, then the shared layer, then the speaking style', () => {
  for (const id of VALID_PERSONA_IDS) {
    const prompt = getPersonaSystemPrompt(id)
    const safety = prompt.indexOf('你是 AI，不是真人')
    const shared = prompt.indexOf('先接住情绪，再松动比较与灾难化的框架')
    const style = prompt.indexOf('\n人设：')
    assert.ok(safety >= 0 && shared > safety && style > shared, `${id} keeps the wrong order`)
  }
})

test('without the shared layer a style keeps its safety boundary and its own voice', () => {
  for (const id of VALID_PERSONA_IDS) {
    const full = getPersonaSystemPrompt(id)
    const ablated = getPersonaSystemPrompt(id, { shared: false })
    assert.ok(!ablated.includes('她的决定永远归她'), `${id} still carries the shared layer`)
    assert.ok(ablated.startsWith('你是 Amie'), `${id} lost the safety boundary`)
    assert.ok(full.endsWith(ablated.slice(ablated.indexOf('\n人设：'))), `${id} changed its own voice`)
  }
})
