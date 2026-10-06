import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../components/chat/CompanionStatePanel', () => ({ default: () => <section aria-label="她的状态" /> }))
vi.mock('../components/her/HerJournal', () => ({ default: () => <section aria-label="她这几天" /> }))
vi.mock('./MemoriesPage', () => ({ default: () => <p>已记住列表</p> }))
vi.mock('../services/authService', () => ({ authService: { updatePersona: vi.fn() } }))
vi.mock('../services/userService', () => ({
  profileService: { get: vi.fn(), update: vi.fn() },
  personaService: { list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), distill: vi.fn() },
}))
vi.mock('../services/letterService', () => ({
  letterService: Object.fromEntries(['generate', 'list', 'get', 'read', 'decide'].map((name) => [name, vi.fn()])),
}))

import { authService } from '../services/authService'
import { personaService, profileService } from '../services/userService'
import { letterService } from '../services/letterService'
import {
  AT_LEAST_ONE_HER,
  DISTILL_FAILED,
  MALE_REFUSAL,
  PERSONA_SWITCHED,
} from '../features/personas'
import { useAuthStore } from '../stores/authStore'
import HerPage from './HerPage'

const LETTER = { id: 'l1', periodStart: '2026-09-09T00:00:00.000Z', content: '见信好。\n\n正文一段。', suggestions: [] }

const CARD_ONE = {
  name: '小柔', identity: '', relationship: '陪你聊天的姐妹', speech: '包容、耐心，慢慢听你说。',
  thinking: '', decisions: '', never: '', samples: ['抱抱，这事儿确实委屈你了。'], immersion: 'medium', tone: 'gentle',
}
const CARD_TWO = {
  name: '毒牙', identity: '', relationship: '骂醒你的闺蜜', speech: '有话直说，护短。',
  thinking: '', decisions: '', never: '', samples: ['你清醒一点。'], immersion: 'high', tone: 'toxic',
}
// 深度卡（人设深度化 T3）：七格之外带着来源、判断规则、矛盾与边界；表单还不认识它们，编辑与蒸馏回填也不能把它们丢掉
const DEEP_CARD = {
  ...CARD_TWO,
  name: '雾岛',
  provenance: { kind: 'fiction', label: '某部小说' },
  heuristics: [1, 2, 3].map((n) => ({ when: `她遇到第${n}种情况`, then: `她会这样回应${n}`, basis: 'source' })),
  tensions: ['嘴上说不在乎，心里记得很清楚', '想独处，又怕被忘掉'],
  boundaries: ['不知道她私下怎么想', '不会预测她没经历过的事', '资料只到整理那一天'],
}
const PERSONAS = [
  { id: 'p1', name: '小柔', card: CARD_ONE, active: true },
  { id: 'p2', name: '毒牙', card: CARD_TWO, active: false },
]

const renderPage = (url = '/her') => render(<MemoryRouter initialEntries={[url]}><HerPage /></MemoryRouter>)

describe('HerPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAuthStore.setState({ token: 't', isLoggedIn: true, user: { id: 'u1', persona: 'p1' } })
    profileService.get.mockResolvedValue({ letterFreqDays: 3 })
    profileService.update.mockImplementation(async (payload) => payload)
    personaService.list.mockResolvedValue({ personas: PERSONAS })
    letterService.generate.mockResolvedValue({ letter: LETTER, created: false, reason: 'not_due' })
    letterService.list.mockResolvedValue([LETTER])
    letterService.read.mockResolvedValue({ success: true })
  })

  it('人设库列出每个她（名字+一句示例句），当前启用的高亮', async () => {
    renderPage()

    const gentle = await screen.findByRole('button', { name: /抱抱，这事儿确实委屈你了。/ })
    const toxic = screen.getByRole('button', { name: /你清醒一点。/ })
    expect(gentle).toHaveTextContent('小柔')
    expect(toxic).toHaveTextContent('毒牙')
    expect(gentle).toHaveAttribute('aria-pressed', 'true')
    expect(toxic).toHaveAttribute('aria-pressed', 'false')
  })

  it('点一下就换她：PUT /user/persona 成功才说换好了', async () => {
    const user = userEvent.setup()
    authService.updatePersona.mockResolvedValue({ persona: 'p2' })
    renderPage()

    await user.click(await screen.findByRole('button', { name: /你清醒一点。/ }))

    expect(authService.updatePersona).toHaveBeenCalledWith('p2')
    expect(await screen.findByText(PERSONA_SWITCHED)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /你清醒一点。/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /抱抱，这事儿确实委屈你了。/ })).toHaveAttribute('aria-pressed', 'false')
  })

  it('造她：蒸馏出草稿填进表单，改好再保存建卡启用', async () => {
    const user = userEvent.setup()
    personaService.distill.mockResolvedValue({ card: CARD_ONE, researched: true })
    personaService.create.mockResolvedValue({ id: 'p3', name: '小柔', card: CARD_ONE, persona: 'p3' })
    renderPage()

    await user.click(await screen.findByRole('button', { name: '造一个她' }))
    await user.type(screen.getByRole('textbox', { name: /她的素材/ }), '她叫小柔，说话很软')
    await user.click(screen.getByRole('button', { name: '帮我整理' }))

    // 缺省是「我自己想的」：不联网查，也没有来源标注
    expect(personaService.distill).toHaveBeenCalledWith({ material: '她叫小柔，说话很软', images: [], research: false, kind: 'original', label: '', attested: false })
    // 草稿填进表单继续改：名字、示例句、沉浸深度与口吻底子都来自草稿
    expect(screen.getByRole('textbox', { name: '她叫什么' })).toHaveValue('小柔')
    expect(screen.getByRole('textbox', { name: '示例句第 1 条' })).toHaveValue('抱抱，这事儿确实委屈你了。')
    expect(screen.getByRole('radio', { name: /^中/ })).toBeChecked()
    expect(screen.getByRole('radio', { name: '温柔' })).toBeChecked()

    await user.click(screen.getByRole('button', { name: '建好她' }))
    expect(personaService.create).toHaveBeenCalledWith(CARD_ONE)
    expect(await screen.findByText('存好了，就用她陪你聊。')).toBeInTheDocument()
  })

  it('虚构角色默认顺手查公开资料，关掉开关就传 research: false', async () => {
    const user = userEvent.setup()
    personaService.distill.mockResolvedValue({ card: CARD_TWO, researched: false })
    renderPage()

    await user.click(await screen.findByRole('button', { name: '造一个她' }))
    await user.click(screen.getByRole('radio', { name: /虚构角色/ }))
    expect(screen.getByRole('checkbox', { name: '顺手查查公开资料' })).toBeChecked()
    await user.click(screen.getByRole('checkbox', { name: '顺手查查公开资料' }))
    await user.type(screen.getByRole('textbox', { name: /她的素材/ }), '她叫毒牙')
    await user.click(screen.getByRole('button', { name: '帮我整理' }))

    expect(personaService.distill).toHaveBeenCalledWith({ material: '她叫毒牙', images: [], research: false, kind: 'fiction', label: '', attested: false })
    expect(await screen.findByText('整理好了；你看看，改好再存。')).toBeInTheDocument()
  })

  describe('造她先选从哪来（人设深度化 T6）', () => {
    const openDistill = async (user) => user.click(await screen.findByRole('button', { name: '造一个她' }))
    const submit = (user) => user.click(screen.getByRole('button', { name: '帮我整理' }))

    it('四种来源；自己想的是缺省，不联网、没有「顺手查」', async () => {
      const user = userEvent.setup()
      renderPage()
      await openDistill(user)

      for (const title of ['我自己想的', '虚构角色', '公众人物']) expect(screen.getByRole('radio', { name: new RegExp(title) })).toBeEnabled()
      expect(screen.getByRole('radio', { name: /我自己想的/ })).toBeChecked()
      expect(screen.queryByRole('checkbox', { name: '顺手查查公开资料' })).not.toBeInTheDocument()
      expect(screen.getByLabelText('她的照片')).toBeInTheDocument()
    })

    it('朋友路径没开：如实写「还没开放」，选不了', async () => {
      const user = userEvent.setup()
      renderPage()
      await openDistill(user)

      const friend = screen.getByRole('radio', { name: /我的朋友/ })
      expect(friend).toBeDisabled()
      expect(screen.getByText('我的朋友（还没开放）')).toBeInTheDocument()
    })

    it('公众人物：先写明是谁；写了才发，来源名一起带上', async () => {
      const user = userEvent.setup()
      personaService.distill.mockResolvedValue({ card: DEEP_CARD, researched: false })
      renderPage()
      await openDistill(user)
      await user.click(screen.getByRole('radio', { name: /公众人物/ }))
      await user.type(screen.getByRole('textbox', { name: /她的素材/ }), '一位作家')
      await submit(user)

      expect(await screen.findByText('公众人物要写明是谁')).toBeInTheDocument()
      expect(personaService.distill).not.toHaveBeenCalled()

      await user.type(screen.getByRole('textbox', { name: /她是谁/ }), '某位女作家')
      await submit(user)
      expect(personaService.distill).toHaveBeenCalledWith({
        material: '一位作家', images: [], research: true, kind: 'public_figure', label: '某位女作家', attested: false,
      })
    })

    describe('朋友（服务端开着）', () => {
      beforeEach(() => {
        personaService.list.mockResolvedValue({ personas: PERSONAS, friendEnabled: true })
      })

      it('只收文字：没有照片入口，没有「顺手查」；不声明就不发', async () => {
        const user = userEvent.setup()
        personaService.distill.mockResolvedValue({ card: DEEP_CARD, researched: false })
        renderPage()
        await openDistill(user)
        await user.click(await screen.findByRole('radio', { name: /我的朋友/ }))

        expect(screen.queryByLabelText('她的照片')).not.toBeInTheDocument()
        expect(screen.queryByRole('checkbox', { name: '顺手查查公开资料' })).not.toBeInTheDocument()
        await user.type(screen.getByRole('textbox', { name: /聊天记录/ }), '她：今天好累\n我：抱抱')
        await submit(user)
        expect(await screen.findByText('朋友这条路要先声明：这是你有权使用的、在世朋友的聊天记录')).toBeInTheDocument()
        expect(personaService.distill).not.toHaveBeenCalled()

        await user.click(screen.getByRole('checkbox', { name: '我有权使用这些聊天记录，对方是在世的朋友' }))
        await submit(user)
        expect(personaService.distill).toHaveBeenCalledWith({
          material: '她：今天好累\n我：抱抱', images: [], research: false, kind: 'friend', label: '', attested: true,
        })
      })

      it('声明是每次造她都要重新勾的，不记住上一次', async () => {
        const user = userEvent.setup()
        renderPage()
        await openDistill(user)
        await user.click(await screen.findByRole('radio', { name: /我的朋友/ }))
        await user.click(screen.getByRole('checkbox', { name: /我有权使用这些聊天记录/ }))
        await user.click(screen.getByRole('button', { name: '先不了' }))

        await openDistill(user)
        await user.click(screen.getByRole('radio', { name: /我的朋友/ }))
        expect(screen.getByRole('checkbox', { name: /我有权使用这些聊天记录/ })).not.toBeChecked()
      })
    })
  })

  describe('她更深一点的样子（人设深度化 T6）', () => {
    it('手写的她：这一栏默认收起，不填就不会多出任何深度字段', async () => {
      const user = userEvent.setup()
      personaService.create.mockResolvedValue({ id: 'p9', name: '小雨', card: CARD_ONE, persona: 'p9' })
      renderPage()
      await user.click(await screen.findByRole('button', { name: '手写一个她' }))

      expect(screen.getByText('她更深一点的样子（可不填）').closest('details')).not.toHaveAttribute('open')
      await user.type(screen.getByRole('textbox', { name: '她叫什么' }), '小雨')
      await user.type(screen.getByRole('textbox', { name: '她怎么说话' }), '软软的')
      await user.click(screen.getByRole('button', { name: '建好她' }))
      const sent = personaService.create.mock.calls[0][0]
      for (const key of ['provenance', 'expression', 'heuristics', 'models', 'values', 'tensions', 'boundaries']) expect(key in sent).toBe(false)
    })

    it('蒸馏出来的深度卡：这一栏展开、来源标注与每条规则的来源都看得见，改来源与加边界会随保存送出', async () => {
      const user = userEvent.setup()
      personaService.distill.mockResolvedValue({ card: DEEP_CARD, researched: false })
      personaService.create.mockResolvedValue({ id: 'p4', name: '雾岛', card: DEEP_CARD, persona: 'p4' })
      renderPage()
      await user.click(await screen.findByRole('button', { name: '造一个她' }))
      await user.click(screen.getByRole('radio', { name: /虚构角色/ }))
      await user.type(screen.getByRole('textbox', { name: /她的素材/ }), '一部小说里的她')
      await user.click(screen.getByRole('button', { name: '帮我整理' }))

      expect(screen.getByText('她更深一点的样子（可不填）').closest('details')).toHaveAttribute('open')
      expect(screen.getByText('来源：虚构角色 · 某部小说')).toBeInTheDocument()
      expect(screen.getByText(/判断规则至少 3 条，内在矛盾至少 2 处，诚实边界至少 3 条/)).toBeInTheDocument()
      expect(screen.getByRole('textbox', { name: '判断规则第 2 条的如果' })).toHaveValue('她遇到第2种情况')
      expect(screen.getByRole('combobox', { name: '判断规则第 2 条的来源' })).toHaveValue('source')

      await user.selectOptions(screen.getByRole('combobox', { name: '判断规则第 2 条的来源' }), 'inferred')
      await user.click(within(screen.getByRole('group', { name: /诚实边界/ })).getByRole('button', { name: '加一条' }))
      await user.type(screen.getByRole('textbox', { name: '诚实边界第 4 条' }), '不知道她以后会怎么选')
      await user.click(screen.getByRole('button', { name: '建好她' }))

      const sent = personaService.create.mock.calls[0][0]
      expect(sent.provenance).toEqual({ kind: 'fiction', label: '某部小说' })
      // 只有被改的第 2 条变成推断，另两条仍是素材里有的
      expect(sent.heuristics.map((rule) => rule.basis)).toEqual(['source', 'inferred', 'source'])
      expect(sent.boundaries).toEqual([...DEEP_CARD.boundaries, '不知道她以后会怎么选'])
    })

    it('旧卡与深度卡一起列出，深度卡带着来源标注，原创卡没有', async () => {
      personaService.list.mockResolvedValue({
        personas: [...PERSONAS, { id: 'p3', name: '雾岛', card: DEEP_CARD, active: false }],
      })
      renderPage()
      expect(await screen.findByText('虚构角色 · 某部小说')).toBeInTheDocument()
      expect(screen.queryByText(/受.*公开言论启发/)).not.toBeInTheDocument()
    })

    it('改来源标注是不让的：编辑页只读显示，保存时原样带回', async () => {
      const user = userEvent.setup()
      personaService.list.mockResolvedValue({ personas: [...PERSONAS, { id: 'p3', name: '雾岛', card: DEEP_CARD, active: false }] })
      personaService.update.mockResolvedValue({ id: 'p3', name: '雾岛', card: DEEP_CARD, persona: 'p1' })
      renderPage()
      await user.click(await screen.findByRole('button', { name: '改一改「雾岛」' }))

      expect(screen.getByText('来源：虚构角色 · 某部小说')).toBeInTheDocument()
      expect(screen.queryByRole('radio', { name: /公众人物/ })).not.toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: '存好改动' }))
      expect(personaService.update.mock.calls[0][1].provenance).toEqual(DEEP_CARD.provenance)
    })
  })

  it('模型不造男性：照实说这是闺蜜产品，不开展男性的服务', async () => {
    const user = userEvent.setup()
    personaService.distill.mockResolvedValue({ refused: 'male' })
    renderPage()

    await user.click(await screen.findByRole('button', { name: '造一个她' }))
    await user.type(screen.getByRole('textbox', { name: /她的素材/ }), '我的男朋友')
    await user.click(screen.getByRole('button', { name: '帮我整理' }))

    expect(await screen.findByText(MALE_REFUSAL)).toBeInTheDocument()
  })

  it('蒸馏没整理出来：照实说，表单里已填的内容原样留着', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('button', { name: '手写一个她' }))
    await user.type(screen.getByRole('textbox', { name: '她叫什么' }), '小柔')
    await user.click(await screen.findByRole('button', { name: '造一个她' }))
    personaService.distill.mockRejectedValue({ response: { data: { error: DISTILL_FAILED } } })
    await user.type(screen.getByRole('textbox', { name: /她的素材/ }), '一堆素材')
    await user.click(screen.getByRole('button', { name: '帮我整理' }))

    expect(await screen.findByText(DISTILL_FAILED)).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '她叫什么' })).toHaveValue('小柔')
  })

  it('删到只剩一个她：服务端的「至少留一个她」照实说', async () => {
    const user = userEvent.setup()
    personaService.remove.mockRejectedValue({ response: { data: { error: AT_LEAST_ONE_HER } } })
    renderPage()

    await user.click(await screen.findByRole('button', { name: '删掉「毒牙」' }))

    expect(personaService.remove).toHaveBeenCalledWith('p2')
    expect(await screen.findByText(AT_LEAST_ONE_HER)).toBeInTheDocument()
  })

  it('表单字数预校验：超字数不发保存请求，错误口径跟服务端一致', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('button', { name: '手写一个她' }))
    await user.type(screen.getByRole('textbox', { name: '她叫什么' }), '她'.repeat(21))
    await user.type(screen.getByRole('textbox', { name: '她怎么说话' }), '好')
    await user.click(screen.getByRole('button', { name: '建好她' }))

    expect(await screen.findByText('她叫什么不能超过20个字符')).toBeInTheDocument()
    expect(personaService.create).not.toHaveBeenCalled()
  })

  it('改一改与删掉都在她自己的那张卡上', async () => {
    const user = userEvent.setup()
    personaService.update.mockResolvedValue({ id: 'p2', name: '毒牙', card: CARD_TWO, persona: 'p1' })
    renderPage()

    await user.click(await screen.findByRole('button', { name: '改一改「毒牙」' }))
    expect(screen.getByRole('textbox', { name: '她叫什么' })).toHaveValue('毒牙')
    await user.clear(screen.getByRole('textbox', { name: '她怎么说话' }))
    await user.type(screen.getByRole('textbox', { name: '她怎么说话' }), '有话直说，护短，也会骂醒你。')
    await user.click(screen.getByRole('button', { name: '存好改动' }))

    expect(personaService.update).toHaveBeenCalledWith('p2', expect.objectContaining({
      name: '毒牙',
      speech: '有话直说，护短，也会骂醒你。',
    }))
    expect(await screen.findByText('改好了。')).toBeInTheDocument()
  })

  it('改一改深度卡：七格改了，来源、判断规则、矛盾与边界原样带回去', async () => {
    const user = userEvent.setup()
    personaService.list.mockResolvedValue({ personas: [...PERSONAS, { id: 'p3', name: '雾岛', card: DEEP_CARD, active: false }] })
    personaService.update.mockResolvedValue({ id: 'p3', name: '雾岛', card: DEEP_CARD, persona: 'p1' })
    renderPage()

    await user.click(await screen.findByRole('button', { name: '改一改「雾岛」' }))
    await user.clear(screen.getByRole('textbox', { name: '她怎么说话' }))
    await user.type(screen.getByRole('textbox', { name: '她怎么说话' }), '话少，但每句都算数。')
    await user.click(screen.getByRole('button', { name: '存好改动' }))

    const [id, sent] = personaService.update.mock.calls[0]
    expect(id).toBe('p3')
    expect(sent.speech).toBe('话少，但每句都算数。')
    expect(sent.provenance).toEqual(DEEP_CARD.provenance)
    expect(sent.heuristics).toEqual(DEEP_CARD.heuristics)
    expect(sent.tensions).toEqual(DEEP_CARD.tensions)
    expect(sent.boundaries).toEqual(DEEP_CARD.boundaries)
  })

  it('蒸馏出来的深度卡填进表单后保存，深度字段随建卡一起送出', async () => {
    const user = userEvent.setup()
    personaService.distill.mockResolvedValue({ card: DEEP_CARD, researched: false })
    personaService.create.mockResolvedValue({ id: 'p4', name: '雾岛', card: DEEP_CARD, persona: 'p4' })
    renderPage()

    await user.click(await screen.findByRole('button', { name: '造一个她' }))
    await user.type(screen.getByRole('textbox', { name: /她的素材/ }), '一部小说里的她')
    await user.click(screen.getByRole('button', { name: '帮我整理' }))
    await user.click(await screen.findByRole('button', { name: '建好她' }))

    const sent = personaService.create.mock.calls[0][0]
    expect(sent.provenance).toEqual(DEEP_CARD.provenance)
    expect(sent.heuristics).toEqual(DEEP_CARD.heuristics)
    expect(sent.boundaries).toEqual(DEEP_CARD.boundaries)
  })

  it('进页面先到期就写信，再显示最新一封与频率三档', async () => {
    renderPage()

    expect(await screen.findByText('见信好。')).toBeInTheDocument()
    expect(letterService.generate).toHaveBeenCalled()
    expect(letterService.list).toHaveBeenCalled()
    for (const label of ['不写了', '三天一封', '七天一封']) {
      expect(screen.getByRole('radio', { name: label })).toBeInTheDocument()
    }
    expect(screen.getByRole('radio', { name: '三天一封' })).toBeChecked()
  })

  it('改频率立即保存（null|3|7），失败退回原选择', async () => {
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => expect(screen.getByRole('radio', { name: '三天一封' })).toBeChecked())

    await user.click(screen.getByRole('radio', { name: '七天一封' }))
    expect(profileService.update).toHaveBeenCalledWith({ letterFreqDays: 7 })
    expect(await screen.findByText('记下了，到了日子她会写。')).toBeInTheDocument()

    profileService.update.mockRejectedValueOnce(new Error('offline'))
    await user.click(screen.getByRole('radio', { name: '不写了' }))
    expect(await screen.findByText('没保存成功，请重试。')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: '七天一封' })).toBeChecked()
  })

  it('没开写信、还没到日子和沉默期各有各的空态', async () => {
    letterService.generate.mockResolvedValue({ letter: null, created: false, reason: 'not_due' })
    letterService.list.mockResolvedValue([])
    const { unmount } = renderPage()
    expect(await screen.findByText('她还没写好第一封，到了日子她会写的。')).toBeInTheDocument()
    unmount()

    letterService.generate.mockResolvedValue({ letter: null, created: false, reason: 'quiet' })
    renderPage()
    expect(await screen.findByText('这几天没什么可写的，她想攒点话再给你写。')).toBeInTheDocument()
  })

  it('keeps her rhythm, her letters and what she remembers on the same page; 旧的 tab 深链直接忽略', async () => {
    renderPage('/her?tab=pending')

    expect(screen.getByRole('region', { name: '她的状态' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '她的来信' })).toBeInTheDocument()
    expect(screen.getByText('已记住列表')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '待确认' })).not.toBeInTheDocument()
  })
})
