// 花草图鉴的字面：与服务端 gardenService.STATUSES、plantIdentification 的字段同一份清单。

export const STATUS_LABELS = { met: '路上遇见', grow: '我养的' }

/** 她讲解的五段，按这个顺序念；没有的那段就不写 */
export const EXPLANATION_SECTIONS = [
  ['what', '它是'],
  ['howToTell', '怎么认出来的'],
  ['season', '什么时候最好看'],
  ['lore', '民间说法'],
  ['care', '想养的话'],
]

/** 「她说，很像是栀子花」：像不像只有三档，不写百分比 */
export const LIKELIHOOD_PHRASES = { 很像: '很像是', 可能是: '可能是', 拿不准: '拿不准，有点像' }

export const HONEST_NOTE = '她认得不一定准；拿不准的时候，多看两眼再下结论。'

/** 认一认没成：按原因说清楚，没同意云端的给一条去设置的路。 */
export function identifyFailure(failure) {
  const code = failure?.response?.data?.code
  if (code === 'CLOUD_NOT_CONSENTED') {
    return { message: '认一认要用云端模型：这张照片会发给已配置的模型供应商。到「设置 → 聊天模型」里同意之后再来；不认也可以自己写名字收进来。', toSettings: true }
  }
  if (code === 'LLM_UNAVAILABLE') return { message: '这会儿没认出来，过一会儿再试试；也可以先自己写名字收进来。' }
  if (code === 'PLANT_ID_UNREADABLE') return { message: '她这次没说清楚，再认一次吧。' }
  return { message: failure?.response?.data?.error || '这会儿没认出来，过一会儿再试试。' }
}

/** 图鉴里一共几种：同名的算一种 */
export const kindsOf = (entries) => new Set(entries.map((entry) => entry.name)).size

export const dayLabel = (value) => new Date(value).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })
