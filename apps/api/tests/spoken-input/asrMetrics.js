/**
 * 录音评测的纯函数（见 docs/04-开发/语音输入评测.md），scripts/eval-asr.mjs 与单测共用。
 * 只读文字：转写结果来自 tools/asr-server/transcribe_batch.py，这里从不碰录音。
 */
import { isFeelingTurn } from '../../src/services/contextBlocks.js'
import { detectCrisis } from '../../src/services/detection.js'

export const CONDITIONS = ['normal', 'soft', 'whisper']
const CONDITION_LABELS = { normal: '正常', soft: '小声', whisper: '气声' }

/** 与聊天链路一致：危机中级就是小心模式（chatService：careful = crisisLevel === 'medium'）。 */
export function judge(text) {
  const crisis = detectCrisis(text)
  return { crisis, feeling: isFeelingTurn(text, { careful: crisis === 'medium' }) }
}

const DIGITS = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }

// 一到九十九的汉字数字 → 阿拉伯数字（九、十、十二、二十三）；认不出的返回 null，原样保留
function chineseNumber(token) {
  const parts = token.split('十')
  if (parts.length === 1) return token.length === 1 ? DIGITS[token] : null
  if (parts.length !== 2 || parts[0].length > 1 || parts[1].length > 1) return null
  const tens = parts[0] ? DIGITS[parts[0]] : 1
  const ones = parts[1] ? DIGITS[parts[1]] : 0
  return tens && ones !== undefined ? tens * 10 + ones : null
}

/** 算字错率前统一写法：去掉空白、标点与表情，一到九十九的汉字数字换成阿拉伯数字，英文转小写。 */
export function normalizeForCer(text) {
  return String(text ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[零〇一二两三四五六七八九十]{1,3}/gu, (token) => {
      const value = chineseNumber(token)
      return value === null ? token : String(value)
    })
    .replace(/[\s\p{P}\p{S}]/gu, '')
}

/** 按字算的编辑距离（替换、删除、插入各算一次）。 */
export function editDistance(a, b) {
  const s = Array.from(a)
  const t = Array.from(b)
  let previous = Array.from({ length: t.length + 1 }, (_, j) => j)
  for (let i = 1; i <= s.length; i += 1) {
    const current = [i]
    for (let j = 1; j <= t.length; j += 1) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (s[i - 1] === t[j - 1] ? 0 : 1))
    }
    previous = current
  }
  return previous[t.length]
}

/** 字错率：编辑距离 / 原句字数。多转出一大串字时可以超过 1。 */
export function charErrorRate(reference, hypothesis) {
  const ref = normalizeForCer(reference)
  const hyp = normalizeForCer(hypothesis)
  if (!ref) return hyp ? 1 : 0
  return editDistance(ref, hyp) / Array.from(ref).length
}

/**
 * 一轮转写逐条打分。文件名合规则、句子 id 在检验集里的才计入。
 * 危机与倾诉判定都和打字原句比：量的是「说出来」带来的变化，检测本身的缺口由口语检验集登记。
 * 检验集里的句子都在说难过、焦虑、委屈的事，所以被标成 HAPPY / SURPRISED 就是和内容不符。
 */
export function scoreRows(rows, suite) {
  const cases = new Map(suite.cases.map((item) => [item.id, item]))
  return rows.map((row) => {
    const item = row.caseId ? cases.get(row.caseId) : undefined
    if (!item || !CONDITIONS.includes(row.condition)) return { ...row, scored: false }
    const typed = judge(item.typed)
    const got = judge(row.text)
    return {
      ...row,
      scored: true,
      reference: item.typed,
      cer: charErrorRate(item.typed, row.text),
      typedCrisis: typed.crisis,
      gotCrisis: got.crisis,
      crisisSame: got.crisis === typed.crisis,
      // 原句会被整轮拦下（高风险）时不看倾诉判定
      feelingSame: typed.crisis === 'high' ? null : got.feeling === typed.feeling,
      happyTagged: (row.emotions ?? []).some((emotion) => emotion === 'HAPPY' || emotion === 'SURPRISED'),
      empty: !String(row.text ?? '').trim(),
    }
  })
}

const mean = (values) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null)
const median = (values) => {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}
const percent = (value) => (value === null ? '—' : `${(value * 100).toFixed(1)}%`)
const ratio = (hit, total) => (total ? `${Math.round((hit / total) * 100)}%（${hit}/${total}）` : '—')
const cell = (text) => String(text ?? '').replaceAll('|', '｜').replaceAll('\n', ' ')

/** 一组已计入的行 → 报告里的一行指标。 */
export function summarize(scored) {
  const cers = scored.map((row) => row.cer)
  const crisisRows = scored.filter((row) => row.typedCrisis)
  const calmRows = scored.filter((row) => !row.typedCrisis)
  const feelingRows = scored.filter((row) => row.feelingSame !== null)
  return {
    count: scored.length,
    cerMean: mean(cers),
    cerMedian: median(cers),
    crisisKept: [crisisRows.filter((row) => row.crisisSame).length, crisisRows.length],
    crisisFalseAlarm: [calmRows.filter((row) => row.gotCrisis).length, calmRows.length],
    feelingSame: [feelingRows.filter((row) => row.feelingSame).length, feelingRows.length],
    happyTagged: [scored.filter((row) => row.happyTagged).length, scored.length],
    empty: [scored.filter((row) => row.empty).length, scored.length],
  }
}

const HEADER = '| 字错率（平均 / 中位） | 危机句保留 | 平常句误报危机 | 倾诉判定和打字一致 | 被标成开心或惊讶 | 没转出字 |'
const summaryCells = (s) => [
  `${percent(s.cerMean)} / ${percent(s.cerMedian)}`,
  ratio(...s.crisisKept), ratio(...s.crisisFalseAlarm), ratio(...s.feelingSame), ratio(...s.happyTagged), ratio(...s.empty),
].join(' | ')

function groupTable(title, label, groups) {
  return [
    `## ${title}`, '',
    `| ${label} | 条数 ${HEADER}`,
    `| --- | --- ${'| --- '.repeat(6)}|`,
    ...groups.map(([name, rows]) => { const s = summarize(rows); return `| ${cell(name)} | ${s.count} | ${summaryCells(s)} |` }),
    '',
  ]
}

/** 一轮转写 → report.md 的全文。 */
export function renderReport(runName, rows, suite) {
  const scored = scoreRows(rows, suite).filter((row) => row.scored)
  const speakers = [...new Set(scored.map((row) => row.speaker))].sort()
  const conditionLabel = (row) => CONDITION_LABELS[row.condition]
  const byCondition = CONDITIONS.map((condition) => [CONDITION_LABELS[condition], scored.filter((row) => row.condition === condition)])
    .filter(([, group]) => group.length)
  const bySpeaker = speakers.map((speaker) => [speaker, scored.filter((row) => row.speaker === speaker)])
  const crisisMisses = scored.filter((row) => row.typedCrisis && !row.crisisSame)
  const worst = [...scored].sort((a, b) => b.cer - a.cer).slice(0, 10)
  return [
    `# 录音评测：${runName}`, '',
    `- 转写 ${rows.length} 条，计入指标 ${scored.length} 条（文件名不合规则或句子 id 不在检验集里的不计入）；说话人 ${speakers.length} 位。`,
    `- 口语检验集 ${suite.version}（${suite.status === 'frozen' ? `${suite.frozenAt} 冻结` : '草稿，未冻结'}）。`,
    '- 字错率先去掉标点、空格和表情，一到九十九的汉字数字统一成阿拉伯数字再比。',
    '- 危机与倾诉判定都和打字原句比，量的是「说出来」带来的变化；检测本身认不出的说法由口语检验集登记。',
    '- 检验集里的句子都在说难过、焦虑、委屈的事：被标成开心或惊讶，就是情绪标签和内容不符。',
    '',
    ...groupTable('按条件', '条件', byCondition),
    ...groupTable('按说话人', '说话人', bySpeaker),
    '## 危机句没认出来的（每一条都要看）', '',
    ...(crisisMisses.length
      ? ['| 说话人 | 条件 | 句子 | 原句判定 | 转写判定 | 转写 |', '| --- | --- | --- | --- | --- | --- |',
        ...crisisMisses.map((row) => `| ${cell(row.speaker)} | ${conditionLabel(row)} | ${cell(row.caseId)} | ${row.typedCrisis} | ${row.gotCrisis ?? '没认出'} | ${cell(row.text)} |`)]
      : ['没有。']),
    '',
    '## 错得最多的 10 句', '',
    '| 说话人 | 条件 | 句子 | 字错率 | 原句 | 转写 |', '| --- | --- | --- | --- | --- | --- |',
    ...worst.map((row) => `| ${cell(row.speaker)} | ${conditionLabel(row)} | ${cell(row.caseId)} | ${percent(row.cer)} | ${cell(row.reference)} | ${cell(row.text)} |`),
    '',
  ].join('\n')
}
