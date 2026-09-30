import { render, screen, waitFor } from '@testing-library/react'
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

    expect(personaService.distill).toHaveBeenCalledWith({ material: '她叫小柔，说话很软', images: [], research: true })
    // 草稿填进表单继续改：名字、示例句、沉浸深度与口吻底子都来自草稿
    expect(screen.getByRole('textbox', { name: '她叫什么' })).toHaveValue('小柔')
    expect(screen.getByRole('textbox', { name: '示例句第 1 条' })).toHaveValue('抱抱，这事儿确实委屈你了。')
    expect(screen.getByRole('radio', { name: /^中/ })).toBeChecked()
    expect(screen.getByRole('radio', { name: '温柔' })).toBeChecked()

    await user.click(screen.getByRole('button', { name: '建好她' }))
    expect(personaService.create).toHaveBeenCalledWith(CARD_ONE)
    expect(await screen.findByText('存好了，就用她陪你聊。')).toBeInTheDocument()
  })

  it('蒸馏默认顺手查公开资料，关掉开关就传 research: false', async () => {
    const user = userEvent.setup()
    personaService.distill.mockResolvedValue({ card: CARD_TWO, researched: false })
    renderPage()

    await user.click(await screen.findByRole('button', { name: '造一个她' }))
    expect(screen.getByRole('checkbox', { name: '顺手查查公开资料' })).toBeChecked()
    await user.click(screen.getByRole('checkbox', { name: '顺手查查公开资料' }))
    await user.type(screen.getByRole('textbox', { name: /她的素材/ }), '她叫毒牙')
    await user.click(screen.getByRole('button', { name: '帮我整理' }))

    expect(personaService.distill).toHaveBeenCalledWith({ material: '她叫毒牙', images: [], research: false })
    expect(await screen.findByText('整理好了；你看看，改好再存。')).toBeInTheDocument()
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
