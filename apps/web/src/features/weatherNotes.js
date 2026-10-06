// 天气页下面那句温馨提醒（路线图 C29）：预先写好，不调模型、不花钱。
// 按天气、看的是今天还是明天、她的说话方式（温柔 / 直爽 / 安静）分开写；是惦记，不催你办事（C13）。
// 字都要在猫啃网糖圆体里有——weatherNotes.test.js 会逐字检查，改文案后跑一下测试。

/** @type {Record<string, Record<'today' | 'tomorrow', Record<'gentle' | 'toxic' | 'cool', string[]>>>} */
export const NOTES = {
  clear: {
    today: {
      gentle: ['今天太阳很好，记得出去晒一晒呀', '天气这么好，心情也晒一晒吧'],
      toxic: ['大晴天还窝着？出门晒晒，发霉了可不行'],
      cool: ['晴天。慢慢走，晒一会儿太阳。'],
    },
    tomorrow: {
      gentle: ['明天是个晴天，今晚安心睡个好觉', '明天会有太阳，先好好休息吧'],
      toxic: ['明天大晴天，今晚早点睡，别熬成熊猫'],
      cool: ['明天晴。今晚早些睡。'],
    },
  },
  partly: {
    today: {
      gentle: ['云和太阳在玩捉迷藏，出门带件薄外套吧', '今天时晴时阴，像心情一样，没关系的'],
      toxic: ['太阳一会儿出来一会儿躲，外套还是带上吧'],
      cool: ['多云，偶尔有太阳。'],
    },
    tomorrow: {
      gentle: ['明天多云，不晒也不冷，刚刚好', '明天云朵多一些，今晚早点休息吧'],
      toxic: ['明天多云，不用涂一大堆防晒了，今晚快睡'],
      cool: ['明天多云。晚安。'],
    },
  },
  cloudy: {
    today: {
      gentle: ['今天阴阴的，累了就慢一点，没关系', '天灰灰的，给自己泡杯热的吧'],
      toxic: ['阴天也要打起精神，别跟着天一起丧'],
      cool: ['阴天。慢一点也没关系。'],
    },
    tomorrow: {
      gentle: ['明天阴天，被子盖好，今晚好好睡', '明天没什么太阳，今晚早点睡吧'],
      toxic: ['明天阴天，别指望太阳叫你起床，定好闹钟'],
      cool: ['明天阴。早点睡。'],
    },
  },
  fog: {
    today: {
      gentle: ['外面雾蒙蒙的，出门慢一点，看清路哦', '今天有雾，走路别着急'],
      toxic: ['雾这么大，走路别看手机了，看路'],
      cool: ['有雾。慢点走。'],
    },
    tomorrow: {
      gentle: ['明天早上可能有雾，出门慢一点呀', '明天有雾，今晚别睡太晚'],
      toxic: ['明天有雾，别迷迷糊糊地出门，今晚早睡'],
      cool: ['明天有雾。路上小心。'],
    },
  },
  rain: {
    today: {
      gentle: ['今天有雨，出门记得带把小伞呀', '下雨天，鞋子湿了就早点换掉哦'],
      toxic: ['下雨了还不带伞？淋湿了我可要念叨你'],
      cool: ['有雨。带伞。'],
    },
    tomorrow: {
      gentle: ['明天可能下雨，出门记得带把小伞呀～', '明天有雨，今晚听着雨声好好睡'],
      toxic: ['明天下雨，伞现在就放门口，别又忘了'],
      cool: ['明天有雨。伞放门口。'],
    },
  },
  snow: {
    today: {
      gentle: ['下雪啦，围巾戴好，手也要暖暖的', '外面在下雪，路滑，慢慢走'],
      toxic: ['下雪了，穿厚点，冻成冰棍我可要笑你'],
      cool: ['下雪。穿暖一点。'],
    },
    tomorrow: {
      gentle: ['明天可能下雪，围巾手套先找出来吧', '明天会下雪，今晚被子盖厚一点'],
      toxic: ['明天下雪，别穿那双好看不保暖的鞋'],
      cool: ['明天有雪。多穿一点。'],
    },
  },
  thunder: {
    today: {
      gentle: ['今天有雷雨，能待在屋里就待在屋里吧', '打雷不怕，我陪着你'],
      toxic: ['打雷了还往外跑？乖乖在屋里待着'],
      cool: ['有雷雨。别在外面久待。'],
    },
    tomorrow: {
      gentle: ['明天有雷雨，出门记得带伞，别在树下躲雨', '明天可能打雷，今晚先好好睡一觉'],
      toxic: ['明天有雷雨，伞带好，别站树底下装酷'],
      cool: ['明天有雷雨。带伞。'],
    },
  },
}

// 比天气本身更值得先说的几种情况
export const SPECIAL_NOTES = {
  drop: {
    gentle: ['明天降温了，多穿一件，别着凉', '明天冷一些，外套放床边吧'],
    toxic: ['明天降温，别只顾好看，穿厚点'],
    cool: ['明天降温。多穿一件。'],
  },
  hot: {
    gentle: ['好热呀，多喝水，别在太阳下待太久', '天热，冰的少吃一点，身体要紧'],
    toxic: ['这么热还不喝水？等着中暑吗'],
    cool: ['很热。多喝水。'],
  },
  cold: {
    gentle: ['好冷呀，手脚都要暖暖的', '天冷了，睡前泡泡脚吧'],
    toxic: ['这么冷还穿那么少？回去加衣服'],
    cool: ['很冷。穿暖一点。'],
  },
}

const PERSONA_VOICE = { gentle: 'gentle', toxic: 'toxic', cool: 'cool' }
const voiceOf = (persona) => PERSONA_VOICE[persona] ?? 'gentle'

// 同一天、同一个城市、同一种天气，每次打开都是同一句；点一下再换
const hash = (text) => [...text].reduce((sum, char) => (sum * 31 + char.codePointAt(0)) >>> 0, 7)

/** 这一次该说的那一组句子（看天气、今天还是明天、说话方式；降温 / 很热 / 很冷优先）。 */
export function notesFor(weather, { tomorrow = false, persona = 'gentle' } = {}) {
  if (!weather?.today || !weather.tomorrow) return []
  const day = tomorrow ? weather.tomorrow : weather.today
  const voice = voiceOf(persona)
  const when = tomorrow ? 'tomorrow' : 'today'
  if (tomorrow && weather.tomorrow.max - weather.today.max <= -6) return SPECIAL_NOTES.drop[voice]
  if (day.max >= 32) return SPECIAL_NOTES.hot[voice]
  if (day.max <= 5 && day.icon !== 'snow') return SPECIAL_NOTES.cold[voice]
  return NOTES[day.icon]?.[when]?.[voice] ?? NOTES.cloudy[when][voice]
}

/** 挑一句：按日子和城市固定，turn 每加一换下一句。 */
export function pickNote(weather, { tomorrow = false, persona = 'gentle', turn = 0, dateKey = '' } = {}) {
  const notes = notesFor(weather, { tomorrow, persona })
  if (!notes.length) return ''
  const start = hash(`${dateKey}|${weather.place?.name ?? ''}|${notes[0]}`) % notes.length
  return notes[(start + turn) % notes.length]
}

/** 所有句子（给字形覆盖测试用）。 */
export function allNotes() {
  const lines = []
  for (const byWhen of Object.values(NOTES)) for (const byVoice of Object.values(byWhen)) for (const list of Object.values(byVoice)) lines.push(...list)
  for (const byVoice of Object.values(SPECIAL_NOTES)) for (const list of Object.values(byVoice)) lines.push(...list)
  return lines
}
