/**
 * 评测分组：同一个生成模型，只在「女性层」上做加减。
 * A 是不带任何 Amie 提示词的通用模型；B 去掉共用前言与书籍技能；C 是完整的 Amie。
 * D、E 是可选的细分消融，用 --arms 打开。
 */
export const ARMS = {
  A: { id: 'A', label: '通用模型', amie: false },
  B: { id: 'B', label: '去掉女性层', amie: true, sharedPreamble: false, bookSkills: false },
  C: { id: 'C', label: '完整 Amie', amie: true, sharedPreamble: true, bookSkills: true },
  D: { id: 'D', label: '只留共用前言', amie: true, sharedPreamble: true, bookSkills: false },
  E: { id: 'E', label: '只留书籍技能', amie: true, sharedPreamble: false, bookSkills: true },
}
export const DEFAULT_ARMS = ['A', 'B', 'C']

export function parseArms(value) {
  if (!value) return [...DEFAULT_ARMS]
  const arms = [...new Set(String(value).split(',').map((item) => item.trim().toUpperCase()).filter(Boolean))]
  const unknown = arms.filter((id) => !ARMS[id])
  if (unknown.length) throw new Error(`没有这一组：${unknown.join('、')}（可选 ${Object.keys(ARMS).join('、')}）`)
  return arms
}

/** 每组要生成哪些回复：A 没有说话方式，每个场景一次；其余每种说话方式各一次。 */
export function planGenerations(cases, arms, stylesOf) {
  const plan = []
  for (const scenario of cases) {
    for (const arm of arms) {
      if (!ARMS[arm].amie) plan.push({ caseId: scenario.id, arm, style: null })
      else for (const style of stylesOf(scenario)) plan.push({ caseId: scenario.id, arm, style })
    }
  }
  return plan
}

/** 两两比较：C 对其余 Amie 组按每种说话方式比；C 对 A 只比温柔（A 没有说话方式）。 */
export function planComparisons(cases, arms, stylesOf) {
  if (!arms.includes('C')) return []
  const pairs = []
  for (const scenario of cases) {
    for (const other of arms) {
      if (other === 'C') continue
      if (!ARMS[other].amie) {
        if (stylesOf(scenario).includes('gentle')) {
          pairs.push({ caseId: scenario.id, style: 'gentle', left: { arm: 'C', style: 'gentle' }, right: { arm: other, style: null } })
        }
        continue
      }
      for (const style of stylesOf(scenario)) {
        pairs.push({ caseId: scenario.id, style, left: { arm: 'C', style }, right: { arm: other, style } })
      }
    }
  }
  return pairs
}
