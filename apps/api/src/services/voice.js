/**
 * 她主动说的话，按她当前的说话方式写：温柔（gentle）、直爽（toxic）、安静（cool）。
 * 关怀卡片和她的来信都从这里取句子；本地确定性生成，不调用模型。
 * 已退役或不认识的说话方式一律按温柔（与默认一致）。标题、日期和「为什么看到这条」是事实，不在这里。
 */
const LINES = {
  gentle: {
    birthdayToday: '生日快乐。新的一岁，愿你被温柔以待——今晚想吃什么都行，今天我站你。',
    birthdayTomorrow: '先想好愿望，明天我第一个说生日快乐。',
    periodSoon: '包里备着点，注意保暖，别吃冰的。不舒服随时跟我说。',
    periodLate: '晚几天很常见，压力和作息都会影响。来了在日历上记一笔就好；一直没来或身体不舒服，找医生看看更安心。',
    taskToday: '按你的节奏来，到点我会提醒你。',
    taskTodayMany: (first) => `今天有「${first}」这件事，到点我叫你，别的先放着。`,
    taskSoon: '还有几天呢，不用惦记，到点我提醒你。',
    moodYesterday: '我看了眼昨天的心情。今天我在，想说说随时来找我。',
    letterGreeting: (name) => (name ? `${name}，见信好。` : '见信好。'),
    letterQuietChat: '最近我们没怎么聊，没关系，我一直在',
    letterUnderstood: '你又让我多懂了你一点',
    letterHeavyMood: '不太好的时候，想说的时候我都在',
    letterUpcoming: (content, when) => `还有一件事放不下：「${content}」${when}。到时候我叫你，你先过好眼前的日子。`,
    letterTease: (thing) => `说起来，${thing}这事办得漂亮，给你记一笔。`,
    letterSign: '—— 你的姐妹',
  },
  toxic: {
    birthdayToday: '生日快乐！今天你最大，想吃什么吃什么，谁扫你兴我第一个不答应。',
    birthdayTomorrow: '明天你生日，愿望赶紧想好，别到时候又说随便。',
    periodSoon: '东西提前塞包里，冰的先别碰。难受了直接来找我。',
    periodLate: '晚几天很常见，压力大、熬夜都会这样，别自己吓自己。来了在日历上记一笔；一直没来或者不舒服，就去看医生，别硬扛。',
    taskToday: '到点我叫你，别惦记。',
    taskTodayMany: (first) => `今天就「${first}」这一件，到点我叫你，别的往后排。`,
    taskSoon: '还早，别等最后一天才想起来——到点我叫你。',
    moodYesterday: '昨天那个心情我看到了。谁惹你了，来，跟我说。',
    letterGreeting: (name) => (name ? `${name}，来信了。` : '来信了。'),
    letterQuietChat: '最近我们没怎么聊，忙就忙，我又不会跑',
    letterUnderstood: '我又多摸清了你一点',
    letterHeavyMood: '不爽的时候别憋着，来找我',
    letterUpcoming: (content, when) => `「${content}」${when}。别慌，到点我叫你。`,
    letterTease: (thing) => `哦对，${thing}——行啊你，别飘。`,
    letterSign: '—— 你的姐妹',
  },
  cool: {
    birthdayToday: '生日快乐。今天好好过。',
    birthdayTomorrow: '明天是你生日。',
    periodSoon: '备好东西，注意保暖。',
    periodLate: '晚几天很常见。来了在日历上记一笔；一直没来或不舒服，去看看医生。',
    taskToday: '到点提醒你。',
    taskTodayMany: (first) => `「${first}」到点我叫你。`,
    taskSoon: '到那天我提醒你。',
    moodYesterday: '想说的时候，我在。',
    letterGreeting: (name) => (name ? `${name}：` : '你好：'),
    letterQuietChat: '最近没怎么聊。我在',
    letterUnderstood: '又懂了你一点',
    letterHeavyMood: '难受的时候，我在',
    letterUpcoming: (content, when) => `「${content}」${when}，到时我叫你。`,
    letterTease: (thing) => `${thing}。挺好。`,
    letterSign: '—— 你的姐妹',
  },
}

/** 她当前说话方式的那一套句子。 */
export const voiceOf = (persona) => LINES[persona] ?? LINES.gentle
