import { readSkillResource } from './skillCatalog.js'

const read = (file) => readSkillResource('body-care', file)
const core = read('SKILL.md').split('## 核心行为')[1].split('## 方法取舍')[0].trim()
const sources = read('sources.md').split('## 一般健康信息复核')[1].split('## 不进入执行规则')[0].trim()
const topics = [
  { pattern: /避孕|怀孕|妊娠|人流|流产|同房|性传播|避孕套|安全套|无保护性行为/, file: 'ch05-protection.md' },
  { pattern: /白带|分泌物|私处.{0,8}(清洗|清洁|洗液|异味)|阴道冲洗/, file: 'ch01-discharge.md' },
  { pattern: /月经|痛经|经期|经前|大姨妈|卫生巾|卫生棉条|月经杯|停经|闭经/, file: 'ch02-period.md' },
  { pattern: /阴道炎|外阴炎|宫颈炎|宫颈糜烂|盆腔积液|尿路感染|外阴.{0,8}(痒|痛)/, file: 'ch03-inflammation.md' },
  { pattern: /妇科|宫颈|卵巢|多囊|肌瘤|囊肿|乳腺|子宫|盆腔|腹痛|腹部.{0,6}痛/, file: 'ch04-reports.md' },
  { pattern: /处女膜|处女检测|私处|阴道|阴唇|乳晕|阴毛|HPV|身体焦虑|卵巢保养/i, file: 'ch06-autonomy.md' },
].map((topic) => ({ ...topic, content: read(`chapters/${topic.file}`) }))
const appointment = read('patterns.md')

/** Static, reviewed product guidance. No database, cloud call or user-derived skill text. */
export function buildBodyCareContext(text, history = [], scene = 'chat') {
  if (scene !== 'chat' || typeof text !== 'string') return []
  let selected = topics.filter(({ pattern }) => pattern.test(text))
  // Only an explicit short follow-up may inherit the immediately preceding user topic.
  // Assistant guesses and old user history never activate the skill on a new subject.
  if (!selected.length && /^(那|那我|这个|这种情况|它)?(怎么办|怎么处理|需要检查吗|会痛吗|需要就医吗|还有呢|继续说)[？?。！!]*$/.test(text.trim())) {
    const lastUser = history.slice().reverse().find((message) => message?.role === 'user')
    if (typeof lastUser?.content === 'string') {
      selected = topics.filter(({ pattern }) => pattern.test(lastUser.content))
    }
  }
  if (!selected.length && !/身体呵护|女生呵护指南/.test(text)) return []
  const references = selected.slice(0, 2).map(({ content }) => content)
  if (/就诊|看医生|检查|报告/.test(text)) references.push(appointment)
  return [{
    role: 'system',
    content: `[Amie 内置技能：身体呵护 v1]\n选择性改编自六层楼《女生呵护指南》(2019)，不是作者本人或医疗服务。\n${core}\n\n${references.join('\n\n')}\n\n一般信息来源与复核 ${sources}`,
  }]
}
