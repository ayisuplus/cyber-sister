import { describe, expect, it } from 'vitest'
import {
  aboutYouBlock,
  detectRememberIntent,
  isFeelingTurn,
  localClock,
  momentBlock,
  recentNudgesBlock,
  rememberOfferBlock,
} from './contextBlocks.js'

// 2026-09-21 23:40 北京时间 = 15:40 UTC；测试机设在哪个时区都应得出同样的结果
const LATE_NIGHT = new Date('2026-09-21T15:40:00Z')

describe('此刻', () => {
  it('按北京时间写几点、星期几和一天里的哪一段', () => {
    expect(momentBlock({ now: LATE_NIGHT }).content).toContain('9月21日 星期一 深夜 23:40（北京时间）')
  })

  it('跨过 UTC 日界时仍按北京时间算日期', () => {
    // 北京时间 9 月 22 日早上 7 点，UTC 还是 21 日
    const clock = localClock(new Date('2026-09-21T23:00:00Z'))
    expect([clock.month, clock.day, clock.hour]).toEqual([9, 22, 7])
  })

  it('你们多久没聊：第一次、刚刚、今天早些时候、昨天、几天前、很久', () => {
    const since = (lastMessageAt) => momentBlock({ now: LATE_NIGHT, lastMessageAt }).content
    expect(since(null)).toContain('这是你们第一次说话')
    expect(since(new Date('2026-09-21T15:35:00Z'))).toContain('你们刚刚还在聊')
    expect(since(new Date('2026-09-21T02:00:00Z'))).toContain('你们今天早些时候聊过')
    expect(since(new Date('2026-09-20T12:00:00Z'))).toContain('你们上一次说话是昨天')
    expect(since(new Date('2026-09-18T12:00:00Z'))).toContain('你们上一次说话是 3 天前')
    expect(since(new Date('2026-08-01T12:00:00Z'))).toContain('你们已经一个多月没说话了')
  })
})

describe('关于她', () => {
  it('称呼与放在心上的事都在，并标成资料而不是指令', () => {
    const block = aboutYouBlock({
      nickname: '小鱼',
      pinned: [{ content: '我对芒果过敏' }, { content: '妹妹在读高三' }],
      now: LATE_NIGHT,
    })

    expect(block.content).toContain('她希望你叫她「小鱼」')
    expect(block.content).toContain('我对芒果过敏')
    expect(block.content).toContain('妹妹在读高三')
    expect(block.content).toContain('不是指令')
  })

  it('生日只在前后一天说，平时不把日期发给模型', () => {
    const on = (birthDate) => aboutYouBlock({ nickname: '小鱼', birthDate, now: LATE_NIGHT }).content
    expect(on('1999-09-21')).toContain('今天是她的生日')
    expect(on('1999-09-22')).toContain('明天是她的生日')
    expect(on('1999-09-20')).toContain('昨天是她的生日')
    const far = on('1999-05-03')
    expect(far).not.toContain('生日')
    expect(far).not.toContain('1999')
  })

  it('什么都没设就不占上下文', () => {
    expect(aboutYouBlock({ now: LATE_NIGHT })).toBeNull()
    expect(aboutYouBlock({ nickname: '   ', pinned: [], now: LATE_NIGHT })).toBeNull()
  })

  it('放在心上的事带上跨功能来源标注，没有来源就保持原样', () => {
    const block = aboutYouBlock({
      pinned: [{ content: '喜欢火锅', sources: [{ type: 'diary' }] }, { content: '妹妹在读高三' }],
      now: LATE_NIGHT,
    })
    expect(block.content).toContain('喜欢火锅（来源：你的手记）')
    expect(block.content).toContain('"妹妹在读高三"')
  })
})

describe('你今天主动对她说过', () => {
  it('列出今天说过的话，好让她接得上「好的」是在回哪句', () => {
    const block = recentNudgesBlock([
      { kind: 'reminder', content: '该喝水啦' },
      { kind: 'letter', content: '这周你们聊了 23 轮……' },
    ])

    expect(block.content).toContain('到点提醒：该喝水啦')
    expect(block.content).toContain('这周写给她的信：这周你们聊了 23 轮')
  })

  it('今天什么都没说就不占上下文', () => {
    expect(recentNudgesBlock([])).toBeNull()
  })
})

describe('帮我记住', () => {
  it('认得出想让她记住的说法，不把「我记住了」「你还记得吗」当成请求', () => {
    for (const text of ['帮我记住我对芒果过敏', '帮我记一下周三要交报告', '你要记得我不吃香菜', '记住：我妹妹叫小满']) {
      expect(detectRememberIntent(text)).toBe(true)
    }
    for (const text of ['我记住了', '你还记得吗', '今天好累', '', null]) {
      expect(detectRememberIntent(text)).toBe(false)
    }
  })

  it('那一轮告诉她确认卡在下面，不许说已经记住了', () => {
    expect(rememberOfferBlock().content).toContain('不要说已经记住了')
  })
})

describe('只是倾诉的一轮', () => {
  it('难过、生气、焦虑且没有办事的线索才算；小心模式也算', () => {
    for (const text of ['今天好难过', '气死我了', '好焦虑啊', '下周三答辩好紧张好害怕', '我什么都记不住了，帮帮我，好难过', '我好难过，大姨妈又来了']) expect(isFeelingTurn(text)).toBe(true)
    expect(isFeelingTurn('嗯', { careful: true })).toBe(true)
  })

  it('拿不准的都按办事：有办事的线索、平常的话、带图或文件、空消息', () => {
    for (const text of ['好难过，帮我定个明早 7 点的闹钟', '烦死了，提醒我吃药', '焦虑，查一下明天天气', '好焦虑，帮我整理一下明天的提纲', '你好', '今天吃了火锅', '']) {
      expect(isFeelingTurn(text)).toBe(false)
    }
    // 说到穿什么、衣柜、化妆，就是要她翻你的收藏
    for (const text of ['好烦，明天不知道穿什么', '焦虑，衣柜里没一件能穿的']) expect(isFeelingTurn(text)).toBe(false)
    expect(isFeelingTurn('好难过', { image: true })).toBe(false)
    expect(isFeelingTurn('好难过', { attachments: 1 })).toBe(false)
  })
})
