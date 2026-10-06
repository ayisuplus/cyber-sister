import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  personaFindFirst: vi.fn(),
  memoryFindMany: vi.fn(),
  conversationFindMany: vi.fn(),
  todoFindMany: vi.fn(),
  countdownFindMany: vi.fn(),
  periodFindMany: vi.fn(),
  reminderFindMany: vi.fn(),
  diaryFindMany: vi.fn(),
  habitFindMany: vi.fn(),
  bookFindMany: vi.fn(),
  studyFindMany: vi.fn(),
  inferenceFindMany: vi.fn(),
  makeupPresetFindMany: vi.fn(),
  wardrobeItemFindMany: vi.fn(),
  collectionFindMany: vi.fn(),
  plantFindMany: vi.fn(),
  letterFindMany: vi.fn(),
  workTaskFindMany: vi.fn(),
  scheduledTaskFindMany: vi.fn(),
  petFindMany: vi.fn(),
}))

vi.mock('../prisma/client.js', () => {
  const client = {
    user: { findUnique: db.userFindUnique },
    persona: { findFirst: db.personaFindFirst },
    memory: { findMany: async (args) => {
      const rows = await db.memoryFindMany(args)
      return args.include?.revisions ? rows.map((memory, index) => ({ ...memory, id: 'm' + index, portableId: 'portable' + index, revision: 1, revisions: [] })) : rows
    } },
    conversation: { findMany: db.conversationFindMany },
    todo: { findMany: db.todoFindMany },
    countdown: { findMany: db.countdownFindMany },
    periodRecord: { findMany: db.periodFindMany },
    reminder: { findMany: db.reminderFindMany },
    diaryEntry: { findMany: db.diaryFindMany },
    habit: { findMany: db.habitFindMany },
    book: { findMany: db.bookFindMany },
    studySession: { findMany: db.studyFindMany },
    inference: { findMany: db.inferenceFindMany },
    makeupPreset: { findMany: db.makeupPresetFindMany },
    wardrobeItem: { findMany: db.wardrobeItemFindMany },
    collectionItem: { findMany: db.collectionFindMany },
    plantEntry: { findMany: db.plantFindMany },
    letter: { findMany: db.letterFindMany },
    workTask: { findMany: db.workTaskFindMany },
    scheduledReminder: { findMany: db.scheduledTaskFindMany },
    pet: { findMany: db.petFindMany },
  }
  client.$transaction = vi.fn((operation) => operation(client))
  return { default: client }
})

vi.mock('../utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { buildUserExport, EXPORT_VERSION } from './exportService.js'

// 新契约（2026-09-29 人设库）：users.persona 指向 Persona.id，导出的 user.persona 是整张人设卡（查不到则 null）
const PERSONA_CARD = {
  name: '小毒舌',
  identity: '嘴上不饶人，心里一直护着你',
  relationship: '跟你互怼多年的闺蜜',
  speech: '先损你两句，再把事给你说明白。',
  thinking: '',
  decisions: '',
  never: '不拿你的痛处开玩笑。',
  samples: ['这都能踩坑？来，我给你捋捋。'],
  immersion: 'high',
  tone: 'toxic',
}

describe('exportService.buildUserExport', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    db.userFindUnique.mockResolvedValue({
      nickname: '小赛',
      persona: 'persona-1',
      roleName: '同桌的你',
      roleSetting: '爱吐槽但会帮我讲题',
      birthDate: null,
      externalLlmConsent: true,
      externalLlmConsentVersion: 'cloud-primary-v3',
      periodConsentAt: new Date('2026-09-01T00:00:00.000Z'),
      periodToneAt: null,
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
    })
    for (const key of [
      'memoryFindMany', 'conversationFindMany', 'todoFindMany', 'countdownFindMany',
      'periodFindMany', 'reminderFindMany', 'diaryFindMany', 'habitFindMany',
      'bookFindMany', 'studyFindMany', 'inferenceFindMany',
      'makeupPresetFindMany', 'wardrobeItemFindMany', 'collectionFindMany', 'plantFindMany', 'letterFindMany', 'workTaskFindMany',
      'scheduledTaskFindMany', 'petFindMany',
    ]) {
      db[key].mockResolvedValue([])
    }
    db.personaFindFirst.mockResolvedValue({ card: PERSONA_CARD })
  })

  it('导出包带版本号与产品标识，user 段不含内部 id 与凭据字段', async () => {
    const bundle = await buildUserExport('user-1')

    expect(bundle.version).toBe(EXPORT_VERSION)
    expect(bundle.product).toBe('Amie cyber-sister')
    expect(typeof bundle.exportedAt).toBe('string')
    expect(bundle.user).toMatchObject({ nickname: '小赛', persona: PERSONA_CARD, roleName: '同桌的你', periodConsentAt: '2026-09-01T00:00:00.000Z', periodToneAt: null })
    // persona 是整张人设卡：按当前用户 + users.persona 从 Persona 表取 card，不再是 id 字符串
    expect(db.personaFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'persona-1', userId: 'user-1' }),
    }))
    expect(JSON.stringify(bundle.user)).not.toContain('phone')
    expect(JSON.stringify(bundle.user)).not.toContain('password')
    expect(JSON.stringify(bundle)).not.toContain('refreshToken')
  })

  it('角色成长与正式记忆分节导出，消息保留数值经历依据', async () => {
    db.userFindUnique.mockResolvedValue({ companionRevision: 3, companionState: { schemaVersion: 1, experienceCount: 3 } })
    db.conversationFindMany.mockResolvedValue([{ messages: [{ role: 'assistant', content: '好的', companionExperience: { revision: 3, observation: { positive: 1 } } }] }])
    const bundle = await buildUserExport('user-1')
    expect(bundle.companion).toEqual({ revision: 3, state: { schemaVersion: 1, experienceCount: 3 } })
    expect(bundle.conversations[0].messages[0].companionExperience).toMatchObject({ revision: 3 })
    expect(bundle.memories).toEqual([])
    // users.persona 为空时不查 Persona 表，user.persona 如实为 null
    expect(bundle.user.persona).toBeNull()
    expect(db.personaFindFirst).not.toHaveBeenCalled()
  })

  it('全部 19 张表按当前用户过滤查询', async () => {
    await buildUserExport('user-1')

    for (const key of [
      'memoryFindMany', 'conversationFindMany', 'todoFindMany', 'countdownFindMany',
      'periodFindMany', 'reminderFindMany', 'diaryFindMany', 'habitFindMany',
      'bookFindMany', 'studyFindMany', 'inferenceFindMany',
      'makeupPresetFindMany', 'wardrobeItemFindMany', 'collectionFindMany', 'plantFindMany', 'letterFindMany', 'workTaskFindMany',
      'scheduledTaskFindMany', 'personaFindFirst', 'petFindMany',
    ]) {
      expect(db[key]).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ userId: 'user-1' }),
      }))
    }
  })

  it('工作文件正文跟随所属消息导出，不只留下不可迁移的下载 id', async () => {
    const artifact = { id: 'a1', title: '任务报告', format: 'md', content: '# 报告', sizeBytes: 8, createdAt: new Date('2026-09-15T00:00:00Z') }
    db.conversationFindMany.mockResolvedValue([{ mode: 'work', messages: [{ role: 'assistant', content: '已交付', workArtifacts: [artifact] }] }])
    const bundle = await buildUserExport('user-1')
    expect(bundle.conversations[0].messages[0].workArtifacts).toEqual([{ ...artifact, createdAt: '2026-09-15T00:00:00.000Z' }])
  })

  it('待完成任务保留用户上传内容，导出查询排除执行令牌与模型检查点', async () => {
    const attachment = { title: '输入', format: 'csv', content: 'value\n425', encoding: 'utf8' }
    db.workTaskFindMany.mockResolvedValue([{ content: '分析文件', status: 'failed', attachments: [attachment], createdAt: new Date('2026-09-15T00:00:00Z') }])
    const bundle = await buildUserExport('user-1')
    expect(bundle.workTasks[0]).toMatchObject({ status: 'failed', attachments: [attachment], createdAt: '2026-09-15T00:00:00.000Z' })
    const select = db.workTaskFindMany.mock.calls[0][0].select
    for (const key of ['leaseToken', 'requestKey', 'requestHash', 'checkpoint']) expect(select).not.toHaveProperty(key)
  })

  it('妆容预设全字段导出；衣柜只导出单品元数据（二进制资产走 v1 边界）', async () => {
    db.makeupPresetFindMany.mockResolvedValue([
      { name: '日常', smooth: 30, whiten: 20, slim: 10, eye: 10, createdAt: new Date('2026-09-08T00:00:00.000Z'), updatedAt: new Date('2026-09-08T01:00:00.000Z') },
    ])
    db.wardrobeItemFindMany.mockResolvedValue([
      { name: '黑色风衣', createdAt: new Date('2026-09-08T02:00:00.000Z') },
    ])

    const bundle = await buildUserExport('user-1')

    expect(bundle.makeupPresets).toEqual([
      { name: '日常', smooth: 30, whiten: 20, slim: 10, eye: 10, createdAt: '2026-09-08T00:00:00.000Z', updatedAt: '2026-09-08T01:00:00.000Z' },
    ])
    expect(bundle.wardrobeItems).toEqual([{ name: '黑色风衣', createdAt: '2026-09-08T02:00:00.000Z' }])
    expect(JSON.stringify(bundle.wardrobeItems)).not.toContain('sourceExt')
  })

  it('装扮里的收藏随包导出：文字与链接都在，照片只记有没有', async () => {
    db.collectionFindMany.mockResolvedValue([
      { shelf: 'makeup', category: '唇妆', name: '雾面唇釉', note: '色号 03', status: 'want', link: 'https://m.tb.cn/h.abc', imageExt: null, createdAt: new Date('2026-09-21T00:00:00.000Z'), updatedAt: new Date('2026-09-21T01:00:00.000Z') },
      { shelf: 'wardrobe', category: null, name: '白衬衫', note: null, status: 'have', link: null, imageExt: '.jpg', createdAt: new Date('2026-09-21T02:00:00.000Z'), updatedAt: new Date('2026-09-21T02:00:00.000Z') },
    ])

    const bundle = await buildUserExport('user-1')

    expect(bundle.collection).toEqual([
      { shelf: 'makeup', category: '唇妆', name: '雾面唇釉', note: '色号 03', status: 'want', link: 'https://m.tb.cn/h.abc', hasPhoto: false, createdAt: '2026-09-21T00:00:00.000Z', updatedAt: '2026-09-21T01:00:00.000Z' },
      { shelf: 'wardrobe', category: null, name: '白衬衫', note: null, status: 'have', link: null, hasPhoto: true, createdAt: '2026-09-21T02:00:00.000Z', updatedAt: '2026-09-21T02:00:00.000Z' },
    ])
    expect(JSON.stringify(bundle.collection)).not.toContain('imageExt')
  })

  it('花草图鉴随包导出：名字、识别时的候选与讲解都在，照片只记有没有', async () => {
    db.plantFindMany.mockResolvedValue([
      {
        name: '栀子花', scientificName: 'Gardenia jasminoides', family: '茜草科', status: 'met', note: '楼下花坛',
        candidates: [{ name: '栀子花', likelihood: '很像' }], explanation: { what: '夏天开的白花。' }, caution: null,
        promptVersion: 'plant-id-v1', identifiedBy: 'qwen-vl-max', imageExt: '.jpg',
        createdAt: new Date('2026-09-26T00:00:00.000Z'), updatedAt: new Date('2026-09-26T00:00:00.000Z'),
      },
    ])

    const bundle = await buildUserExport('user-1')

    expect(bundle.garden).toEqual([{
      name: '栀子花', scientificName: 'Gardenia jasminoides', family: '茜草科', status: 'met', note: '楼下花坛',
      candidates: [{ name: '栀子花', likelihood: '很像' }], explanation: { what: '夏天开的白花。' }, caution: null, reference: null,
      promptVersion: 'plant-id-v1', identifiedBy: 'qwen-vl-max', hasPhoto: true,
      createdAt: '2026-09-26T00:00:00.000Z', updatedAt: '2026-09-26T00:00:00.000Z',
    }])
    expect(JSON.stringify(bundle.garden)).not.toContain('imageExt')
  })

  it('来信随包导出，连同她的建议和你怎么处理的', async () => {
    db.letterFindMany.mockResolvedValue([
      {
        periodStart: new Date('2026-09-07T00:00:00.000Z'), freqDays: 7, content: '信的内容', createdAt: new Date('2026-09-09T08:00:00.000Z'),
        suggestions: [{ kind: 'delete_memory', title: '这条过时了', decided: 'accepted' }], readAt: new Date('2026-09-09T09:00:00.000Z'),
      },
    ])

    const bundle = await buildUserExport('user-1')

    // 来信连同她的建议和你怎么处理的一起带走
    expect(bundle.letters).toEqual([
      {
        periodStart: '2026-09-07T00:00:00.000Z', freqDays: 7, content: '信的内容', createdAt: '2026-09-09T08:00:00.000Z',
        suggestions: [{ kind: 'delete_memory', title: '这条过时了', decided: 'accepted' }], readAt: '2026-09-09T09:00:00.000Z',
      },
    ])
  })

  it('她整理的也归你：关系、理解、惦记的事、前情摘要与页边批注随包导出，不带内部 id（路线图 C23）', async () => {
    db.inferenceFindMany.mockImplementation((args) => Promise.resolve(args?.where?.kind === 'relation' ? [] : [
      {
        kind: 'relation', content: '「喜欢火锅」与「每周五吃火锅」有关', status: 'active', outcome: null,
        payload: { fromMemoryId: 'm1', toMemoryId: 'm2', relation: 'related', confidence: 'high' },
        basis: [{ type: 'memory', id: 'm1', revision: 1, quote: '喜欢火锅' }],
        dueOn: null, expiresAt: null, letteredAt: null, createdAt: new Date('2026-09-09T00:00:00.000Z'),
      },
      {
        kind: 'followup', content: '面试顺利吗？', status: 'active', outcome: null,
        payload: { about: '周五面试', ask: '面试顺利吗？' },
        basis: [{ type: 'message', id: 'msg-1', quote: '周五要面试了' }],
        dueOn: new Date('2026-09-26T00:00:00.000Z'), expiresAt: new Date('2026-09-29T00:00:00.000Z'), letteredAt: null, createdAt: new Date('2026-09-20T00:00:00.000Z'),
      },
    ]))
    db.conversationFindMany.mockResolvedValue([{
      title: 'Amie', mode: 'chat', summary: '她最近在准备面试', summaryUpToAt: new Date('2026-09-19T00:00:00.000Z'),
      messages: [{ role: 'assistant', content: '先接住你', bookNotes: [{ book: '情绪急救', chapter: '被拒绝' }] }],
    }])

    const bundle = await buildUserExport('user-1')

    // 你删掉的（否决）不导出
    expect(db.inferenceFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'user-1', status: { not: 'vetoed' } } }))
    expect(bundle.inferences).toEqual([
      {
        kind: 'relation', content: '「喜欢火锅」与「每周五吃火锅」有关', relation: 'related', confidence: 'high', because: ['喜欢火锅'],
        status: 'active', outcome: null, dueOn: null, expiresAt: null, letteredAt: null, createdAt: '2026-09-09T00:00:00.000Z',
      },
      {
        kind: 'followup', content: '面试顺利吗？', about: '周五面试', ask: '面试顺利吗？', because: ['周五要面试了'],
        status: 'active', outcome: null, dueOn: '2026-09-26T00:00:00.000Z', expiresAt: '2026-09-29T00:00:00.000Z', letteredAt: null, createdAt: '2026-09-20T00:00:00.000Z',
      },
    ])
    expect(JSON.stringify(bundle.inferences)).not.toMatch(/msg-1|"m1"|"m2"/)
    expect(bundle.conversations[0]).toMatchObject({ summary: '她最近在准备面试', summaryUpToAt: '2026-09-19T00:00:00.000Z' })
    expect(bundle.conversations[0].messages[0].bookNotes).toEqual([{ book: '情绪急救', chapter: '被拒绝' }])
  })

  it('记忆 tags 由 JSON 字符串还原为数组，日期序列化为 ISO 字符串', async () => {
    db.memoryFindMany.mockResolvedValue([
      { type: 'semantic', content: '喜欢火锅', importance: 8, tags: '["饮食","周末"]', origin: 'promoted', pinned: true, createdAt: new Date('2026-09-01T00:00:00.000Z') },
      { type: 'episodic', content: '无标签', importance: 5, tags: null, origin: 'manual', createdAt: new Date('2026-09-02T00:00:00.000Z') },
    ])

    const bundle = await buildUserExport('user-1')

    expect(bundle.memories).toEqual([
      { type: 'semantic', content: '喜欢火锅', importance: 8, tags: ['饮食', '周末'], origin: 'promoted', pinned: true, createdAt: '2026-09-01T00:00:00.000Z' },
      { type: 'episodic', content: '无标签', importance: 5, tags: [], origin: 'manual', pinned: false, createdAt: '2026-09-02T00:00:00.000Z' },
    ])
  })

  it('对话与消息嵌套导出，toolRuns 缺省为 null', async () => {
    db.conversationFindMany.mockResolvedValue([{
      title: 'Amie',
      mode: 'chat',
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
      updatedAt: new Date('2026-09-02T00:00:00.000Z'),
      messages: [
        { role: 'user', content: '', emotion: null, source: null, importance: 3, toolRuns: null, imageExt: '.jpg', createdAt: new Date('2026-09-01T01:00:00.000Z') },
        { role: 'assistant', content: '记好了', emotion: 'neutral', source: 'qwen', importance: 3, toolRuns: [{ tool: 'add_todo', ok: true, summary: '已添加' }], createdAt: new Date('2026-09-01T01:00:01.000Z') },
      ],
    }])

    const bundle = await buildUserExport('user-1')

    expect(bundle.conversations).toHaveLength(1)
    expect(bundle.conversations[0].messages).toHaveLength(2)
    // 图片消息：导出只带 hasImage 标记，二进制不落包（v1 边界）
    expect(bundle.conversations[0].messages[0]).toMatchObject({ content: '', hasImage: true })
    expect(bundle.conversations[0].messages[0].imageExt).toBeUndefined()
    expect(bundle.conversations[0].messages[1]).toMatchObject({
      role: 'assistant',
      source: 'qwen',
      toolRuns: [{ tool: 'add_todo', ok: true, summary: '已添加' }],
      hasImage: false,
    })
  })

  it('安排连同到点记录导出，旧日程与倒数日作为历史照旧导出', async () => {
    db.scheduledTaskFindMany.mockResolvedValue([{
      content: '妈妈生日', instruction: null, freq: 'yearly', time: '09:00',
      fireAt: new Date('2026-10-01T01:00:00.000Z'), weekdays: [], monthDay: null,
      nextFireAt: new Date('2026-10-01T01:00:00.000Z'), status: 'active',
      createdAt: new Date('2026-09-15T00:00:00.000Z'), updatedAt: new Date('2026-09-15T00:00:00.000Z'),
      deliveries: [{ fireAt: new Date('2025-10-01T01:00:00.000Z'), status: 'shown', result: null, createdAt: new Date('2025-10-01T01:00:05.000Z') }],
    }])
    db.todoFindMany.mockResolvedValue([{ content: '交房租', dueDate: null, dueTime: null, isDone: true, createdAt: new Date('2026-09-01T00:00:00.000Z') }])

    const bundle = await buildUserExport('user-1')

    expect(bundle.scheduledTasks).toEqual([{
      content: '妈妈生日', instruction: null, freq: 'yearly', time: '09:00',
      fireAt: '2026-10-01T01:00:00.000Z', weekdays: [], monthDay: null,
      nextFireAt: '2026-10-01T01:00:00.000Z', status: 'active', kind: 'plain',
      createdAt: '2026-09-15T00:00:00.000Z', updatedAt: '2026-09-15T00:00:00.000Z',
      deliveries: [{ fireAt: '2025-10-01T01:00:00.000Z', status: 'shown', result: null, createdAt: '2025-10-01T01:00:05.000Z' }],
    }])
    expect(bundle.todos).toEqual([{ content: '交房租', dueDate: null, dueTime: null, isDone: true, createdAt: '2026-09-01T00:00:00.000Z' }])
    const select = db.scheduledTaskFindMany.mock.calls[0][0].select
    expect(select).not.toHaveProperty('id')
    expect(select).not.toHaveProperty('userId')
  })

  it('手帐打卡与阅读按嵌套结构导出', async () => {
    db.habitFindMany.mockResolvedValue([{
      name: '喝水',
      icon: 'droplets',
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
      checkins: [{ day: new Date('2026-09-03T00:00:00.000Z'), createdAt: new Date('2026-09-03T08:00:00.000Z') }],
    }])
    db.bookFindMany.mockResolvedValue([{
      title: '活着',
      author: '余华',
      status: 'reading',
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
      notes: [{ content: '有庆那段看得心里发紧', aiComment: '我在', createdAt: new Date('2026-09-02T00:00:00.000Z') }],
    }])

    const bundle = await buildUserExport('user-1')

    expect(bundle.habits[0].checkins).toHaveLength(1)
    expect(bundle.books[0].notes[0]).toMatchObject({ content: '有庆那段看得心里发紧' })
    expect(bundle.books[0]).toMatchObject({ serverIndex: null, passages: [] })
  })

  it('她上传给 Amie 的书：分段正文随导出带走，向量不导', async () => {
    db.bookFindMany.mockResolvedValue([{
      title: '被讨厌的勇气',
      status: 'reading',
      serverIndex: 'ready',
      indexedAt: new Date('2026-09-25T00:00:00.000Z'),
      createdAt: new Date('2026-09-20T00:00:00.000Z'),
      notes: [],
      passages: [{ chapterIndex: 1, chapter: '课题分离', locator: '1:0', content: '这是第一段。' }],
    }])

    const bundle = await buildUserExport('user-1')

    expect(bundle.books[0]).toMatchObject({ serverIndex: 'ready', indexedAt: '2026-09-25T00:00:00.000Z' })
    expect(bundle.books[0].passages).toEqual([{ chapterIndex: 1, chapter: '课题分离', locator: '1:0', content: '这是第一段。' }])
    expect(db.bookFindMany.mock.calls[0][0].select.passages.select).not.toHaveProperty('vector')
  })

  it('用户不存在时 user 段为 null 但包仍完整', async () => {
    db.userFindUnique.mockResolvedValue(null)

    const bundle = await buildUserExport('ghost')

    expect(bundle.user).toBeNull()
    expect(bundle.memories).toEqual([])
    expect(bundle.version).toBe(EXPORT_VERSION)
  })
})
