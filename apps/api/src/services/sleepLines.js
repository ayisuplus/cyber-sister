/**
 * 早安与晚安的句子（路线图 C28）：日程页睡眠卡的早安闹钟响时送一句，晚安提醒到点时留一张静音便签。
 *
 * 写作规则（能机械检查的在 sleepLines.test.js 里）：
 * - 不催、不打鸡血、不说教；不假设她睡得好、心情好（她昨晚可能哭过）；不评价身体和外貌。
 * - 不断言窗外的天气——说不准的就写成「若…」「去看一看」，或只放进对应季节。
 * - 古诗词只取公版（先秦至清），注明作者与篇名；只挑温和的句子，离别、悼亡、怀才不遇的不用。
 * - 现代作家与译文仍在版权期内，一概不用。
 * - 古诗词原文与出处逐条核对后才算冻结，核对状态记在 docs/02-设计/早安句库.md。
 *
 * 抽句不用随机数：按「用户 + 季节」把这一季的句子固定洗一次牌，第几天取第几句。
 * 看起来是随机的，一轮抽完之前不重复，同一天刷新也不变；论文里可以复现。
 * 句子不落库，谁需要谁按日期重算：对话便签、早安卡与「你今天主动对她说过」拿到的是同一句。
 * 三种说话方式共用一套：这是她自己定的提醒，不是她主动说的话。
 */
import { localClock } from './contextBlocks.js'

/** 睡眠卡的两类「安排」：晚安提醒与早安闹钟。 */
export const SLEEP_KINDS = ['bedtime', 'wake']
export const SLEEP_LABELS = { bedtime: '晚安提醒', wake: '早安闹钟' }

const DAY_MS = 24 * 60 * 60 * 1000
// 明早叫她：闹钟在晚安之后多少小时以内才算「明早」
const NEXT_MORNING_WITHIN_MS = 14 * 60 * 60 * 1000

const ANY = ['any']
const line = (id, text, seasons = ANY, source = null) => ({ id, text, seasons, ...(source ?? {}) })
const poem = (id, text, author, title, seasons = ANY) => line(id, text, seasons, { author, title })

export const MORNING_LINES = [
  // —— 原创：不分季节 ——
  line('m01', '不急着起来，先听一听外面有没有鸟。'),
  line('m02', '昨晚没说完的话，今天可以慢慢说。'),
  line('m03', '如果昨晚睡得不太好，今天就走得慢一点。'),
  line('m04', '今天不必很好，像你自己就好。'),
  line('m05', '先喝一口温水，别的事都可以等一等。'),
  line('m06', '天是一点一点亮的，人也可以一点一点醒。'),
  line('m07', '被子还暖着，再赖三十秒也不算迟。'),
  line('m08', '今天是一张还没写字的纸，写几行都行，空着也行。'),
  line('m09', '拉开窗帘之前，先对自己说一声早。'),
  line('m10', '慢慢来，今天会等你。'),
  line('m11', '醒来时若还有一点难过，就先带着它，不必急着放下。'),
  line('m12', '夜里的事留在夜里，早上只管早上。'),
  line('m13', '今天的第一件事，是好好地醒过来。'),
  line('m14', '去窗边看一看，今天的云是什么样子。'),
  line('m15', '做了什么梦？记不清也没关系。'),
  line('m16', '把昨天叠好放在枕边，今天换一件新的穿上。'),
  line('m17', '早饭不用丰盛，热的就好。'),
  line('m18', '深呼吸一下，今天从这一口气开始。'),
  line('m19', '醒了就好，别的都不急。'),
  line('m20', '世界比你早醒了一会儿，它会等你的。'),
  line('m21', '今天也许平平常常，平常也很好。'),
  line('m22', '醒来先别看消息，先看一眼天。'),
  line('m23', '今天出门，挑一件让自己舒服的衣服。'),
  // —— 原创：随季节 ——
  line('m24', '窗帘缝里漏进来的那一道光，是春天先来敲门了。', ['spring']),
  line('m25', '春天的早晨有青草的味道，出门时闻一闻。', ['spring']),
  line('m26', '趁太阳还不太晒，早晨的风最好。', ['summer']),
  line('m27', '夏天天亮得早，你不用和它比。', ['summer']),
  line('m28', '天亮得比上个月晚一点了，季节在悄悄走。', ['autumn']),
  line('m29', '秋天的早晨凉凉的，适合一杯热的。', ['autumn']),
  line('m30', '桂花开的时候，早晨的风是甜的。', ['autumn']),
  line('m31', '天还黑着也没关系，灯亮了，就算早晨。', ['winter']),
  line('m32', '冬天的被窝最难离开，允许自己多待一分钟。', ['winter']),
  line('m33', '窗上若起了雾，可以画一个小小的笑脸。', ['winter']),
  line('m34', '冷的早晨，先把手捂热，再慢慢起身。', ['winter']),

  // —— 古诗词：不分季节 ——
  poem('p01', '清晨入古寺，初日照高林。', '常建', '题破山寺后禅院'),
  poem('p02', '行到水穷处，坐看云起时。', '王维', '终南别业'),
  poem('p03', '此心安处是吾乡。', '苏轼', '定风波·南海归赠王定国侍人寓娘'),
  poem('p04', '莫听穿林打叶声，何妨吟啸且徐行。', '苏轼', '定风波·莫听穿林打叶声'),
  poem('p05', '人间有味是清欢。', '苏轼', '浣溪沙·细雨斜风作晓寒'),
  poem('p06', '女曰鸡鸣，士曰昧旦。', '', '诗经·郑风·女曰鸡鸣'),
  poem('p07', '天接云涛连晓雾，星河欲转千帆舞。', '李清照', '渔家傲·天接云涛连晓雾'),
  poem('p08', '朝辞白帝彩云间，千里江陵一日还。', '李白', '早发白帝城'),
  poem('p09', '水光潋滟晴方好，山色空蒙雨亦奇。', '苏轼', '饮湖上初晴后雨'),
  poem('p10', '苔痕上阶绿，草色入帘青。', '刘禹锡', '陋室铭'),
  poem('p11', '窗含西岭千秋雪，门泊东吴万里船。', '杜甫', '绝句'),
  poem('p12', '呦呦鹿鸣，食野之苹。', '', '诗经·小雅·鹿鸣'),
  // —— 古诗词：春 ——
  poem('p13', '晓看红湿处，花重锦官城。', '杜甫', '春夜喜雨', ['spring']),
  poem('p14', '竹外桃花三两枝，春江水暖鸭先知。', '苏轼', '惠崇春江晚景', ['spring']),
  poem('p15', '沾衣欲湿杏花雨，吹面不寒杨柳风。', '志南', '绝句', ['spring']),
  poem('p16', '知否，知否？应是绿肥红瘦。', '李清照', '如梦令·昨夜雨疏风骤', ['spring']),
  poem('p17', '天街小雨润如酥，草色遥看近却无。', '韩愈', '早春呈水部张十八员外', ['spring']),
  poem('p18', '小楼一夜听春雨，深巷明朝卖杏花。', '陆游', '临安春雨初霁', ['spring']),
  poem('p19', '迟日江山丽，春风花草香。', '杜甫', '绝句二首', ['spring']),
  poem('p20', '云霞出海曙，梅柳渡江春。', '杜审言', '和晋陵陆丞早春游望', ['spring']),
  poem('p21', '儿童急走追黄蝶，飞入菜花无处寻。', '杨万里', '宿新市徐公店', ['spring']),
  poem('p22', '山下兰芽短浸溪，松间沙路净无泥。', '苏轼', '浣溪沙·游蕲水清泉寺', ['spring']),
  poem('p23', '西塞山前白鹭飞，桃花流水鳜鱼肥。', '张志和', '渔歌子', ['spring']),
  // —— 古诗词：夏 ——
  poem('p24', '小荷才露尖尖角，早有蜻蜓立上头。', '杨万里', '小池', ['summer']),
  poem('p25', '接天莲叶无穷碧，映日荷花别样红。', '杨万里', '晓出净慈寺送林子方', ['summer']),
  poem('p26', '绿树阴浓夏日长，楼台倒影入池塘。', '高骈', '山亭夏日', ['summer']),
  poem('p27', '梅子黄时日日晴，小溪泛尽却山行。', '曾几', '三衢道中', ['summer']),
  poem('p28', '荷风送香气，竹露滴清响。', '孟浩然', '夏日南亭怀辛大', ['summer']),
  poem('p29', '和羞走，倚门回首，却把青梅嗅。', '李清照', '点绛唇·蹴罢秋千', ['summer']),
  poem('p30', '蝉噪林逾静，鸟鸣山更幽。', '王籍', '入若耶溪', ['summer']),
  poem('p31', '日长睡起无情思，闲看儿童捉柳花。', '杨万里', '闲居初夏午睡起', ['summer']),
  poem('p32', '叶上初阳干宿雨，水面清圆，一一风荷举。', '周邦彦', '苏幕遮·燎沉香', ['summer']),
  // —— 古诗词：秋 ——
  poem('p33', '蒹葭苍苍，白露为霜。', '', '诗经·秦风·蒹葭', ['autumn']),
  poem('p34', '自古逢秋悲寂寥，我言秋日胜春朝。', '刘禹锡', '秋词', ['autumn']),
  poem('p35', '晴空一鹤排云上，便引诗情到碧霄。', '刘禹锡', '秋词', ['autumn']),
  poem('p36', '一年好景君须记，最是橙黄橘绿时。', '苏轼', '赠刘景文', ['autumn']),
  poem('p37', '远上寒山石径斜，白云生处有人家。', '杜牧', '山行', ['autumn']),
  poem('p38', '何须浅碧深红色，自是花中第一流。', '李清照', '鹧鸪天·桂花', ['autumn']),
  poem('p39', '采菊东篱下，悠然见南山。', '陶渊明', '饮酒·其五', ['autumn']),
  // —— 古诗词：冬 ——
  poem('p40', '忽如一夜春风来，千树万树梨花开。', '岑参', '白雪歌送武判官归京', ['winter']),
  poem('p41', '墙角数枝梅，凌寒独自开。', '王安石', '梅花', ['winter']),
  poem('p42', '已讶衾枕冷，复见窗户明。', '白居易', '夜雪', ['winter']),
  poem('p43', '梅须逊雪三分白，雪却输梅一段香。', '卢梅坡', '雪梅', ['winter']),
  poem('p44', '海日生残夜，江春入旧年。', '王湾', '次北固山下', ['winter']),
]

// 晚安：静音便签，全部原创。不责备她还醒着，不催；睡不着也给一个出口。
export const BEDTIME_LINES = [
  line('b01', '今天就到这里吧，剩下的交给月亮。'),
  line('b02', '手机放远一点，让眼睛先睡。'),
  line('b03', '没做完的事，明天还在，它们不会跑。'),
  line('b04', '夜深了，把今天轻轻合上。'),
  line('b05', '想说的话还没说完，也可以留一点给明天。'),
  line('b06', '灯关了以后，房间会替你守着。'),
  line('b07', '睡不着也没关系，闭上眼睛躺着，也是在休息。'),
  line('b08', '今天辛苦了，现在可以什么都不想。'),
  line('b09', '把枕头拍松一点，今晚就到这里。'),
  line('b10', '窗外的灯一盏一盏灭了，你也可以。'),
  line('b11', '今天好不好，都已经过去了。'),
  line('b12', '被子盖好，脚也盖好。'),
  line('b13', '把心里的事先放在床头，明早再拿起来。'),
  line('b14', '晚安，今天的你已经够了。'),
  line('b15', '月亮上班了，你可以下班了。'),
  line('b16', '这会儿世界很安静，正适合睡着。'),
  line('b17', '眼睛酸了，是它在说想休息。'),
  line('b18', '最后一条消息看完，就把手机扣过来吧。'),
  line('b19', '夜里想的事容易变大，留到白天再想。'),
  line('b20', '如果还难过，就先抱一抱自己，再睡。'),
  line('b21', '床是软的，夜是长的，慢慢睡着就好。'),
  line('b22', '星星不一定看得见，但它们都在。'),
]

// 北京时间的季节：3-5 春、6-8 夏、9-11 秋、12-2 冬
export function seasonOf(month) {
  if (month >= 3 && month <= 5) return 'spring'
  if (month >= 6 && month <= 8) return 'summer'
  if (month >= 9 && month <= 11) return 'autumn'
  return 'winter'
}

const SEASON_START_MONTH = { spring: 3, summer: 6, autumn: 9, winter: 12 }

// FNV-1a：把「用户 + 季节」变成洗牌的种子
function hashOf(text) {
  let hash = 0x811c9dc5
  for (const char of String(text)) {
    hash ^= char.codePointAt(0)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash
}

// mulberry32：给定种子，每次得到同一串伪随机数
function sequenceOf(seed) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 按种子固定地洗一次牌（Fisher–Yates），不改原数组。 */
export function shuffledBy(list, seedText) {
  const next = sequenceOf(hashOf(seedText))
  const copy = [...list]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

/** 这一季能用的早安句：本季的加上不分季节的。 */
export const morningPoolFor = (season) => MORNING_LINES.filter((item) => item.seasons.includes(season) || item.seasons.includes('any'))

/** 某天早上的那一句（北京时间）：同一个人、同一天总是同一句，一季之内先轮完再重复。 */
export function morningLineFor(userId, at) {
  const clock = localClock(new Date(at))
  const season = seasonOf(clock.month)
  // 冬天跨年：12 月算下一年的冬天，1、2 月的起点是上一年 12 月 1 日
  const startYear = season === 'winter' && clock.month <= 2 ? clock.year - 1 : clock.year
  const seasonStart = Date.UTC(startYear, SEASON_START_MONTH[season] - 1, 1)
  const day = Math.round((clock.dayKey - seasonStart) / DAY_MS)
  const pool = shuffledBy(morningPoolFor(season), `${userId}|${startYear}-${season}`)
  return pool[day % pool.length]
}

/** 某天晚上的晚安句：一轮抽完换一副牌，同一天总是同一句。 */
export function bedtimeLineFor(userId, at) {
  const day = Math.round(localClock(new Date(at)).dayKey / DAY_MS)
  const round = Math.floor(day / BEDTIME_LINES.length)
  return shuffledBy(BEDTIME_LINES, `${userId}|bedtime|${round}`)[day % BEDTIME_LINES.length]
}

/** 出处：李清照《如梦令·昨夜雨疏风骤》；《诗经》不署作者，写作《诗经·秦风·蒹葭》。原创的没有出处。 */
export const sourceOf = (item) => (item?.title ? `${item.author ?? ''}《${item.title}》` : '')

/** 一句话怎么写在便签上：古诗词另起一行注出处。 */
export function formatLine(item) {
  if (!item) return ''
  const source = sourceOf(item)
  return source ? `${item.text}
——${source}` : item.text
}

const WEEKDAY_NAMES = ['日', '一', '二', '三', '四', '五', '六']

/** 睡眠卡那两条「哪几天」：每天 / 工作日 / 周末 / 周一、三、五。 */
export function describeSleepDays(reminder) {
  if (reminder?.freq === 'daily') return '每天'
  const days = [...(reminder?.weekdays ?? [])].sort((a, b) => a - b)
  if (days.join() === '1,2,3,4,5') return '工作日'
  if (days.join() === '0,6') return '周末'
  // 周一在前、周日在后，读起来顺
  const ordered = [...days.filter((day) => day !== 0), ...days.filter((day) => day === 0)]
  return `周${ordered.map((day) => WEEKDAY_NAMES[day]).join('、')}`
}

/**
 * 一条睡眠投递配的那句话：早安是当天早上的句子；晚安是当晚的句子，
 * 明早（14 小时内）开着闹钟就再补一句「明早 07:40 叫你。」。
 */
export function sleepLineFor(delivery, userId, wake = null) {
  const kind = delivery?.reminder?.kind
  if (kind === 'wake') return morningLineFor(userId, delivery.fireAt)
  if (kind !== 'bedtime') return null
  const item = bedtimeLineFor(userId, delivery.fireAt)
  const wakeAt = wake?.enabled && wake.nextFireAt ? new Date(wake.nextFireAt) - new Date(delivery.fireAt) : null
  return wakeAt !== null && wakeAt > 0 && wakeAt <= NEXT_MORNING_WITHIN_MS
    ? { ...item, text: `${item.text}明早 ${wake.time} 叫你。` }
    : item
}
