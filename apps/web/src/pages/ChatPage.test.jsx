import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../services/chatService', () => ({
  chatService: {
    getConversations: vi.fn(),
    getConversation: vi.fn(),
    createConversation: vi.fn(),
    sendMessage: vi.fn(),
    deleteConversation: vi.fn(),
  },
}))

vi.mock('../services/complianceService', () => ({
  complianceService: {
    reportCrisis: vi.fn(),
    startUsage: vi.fn(),
    heartbeat: vi.fn(),
    endUsage: vi.fn(),
    getUsageStatus: vi.fn(),
  },
}))
vi.mock('../services/localModelService', () => ({
  localModelService: { getStatus: vi.fn() },
}))

vi.mock('../services/consentService', () => ({
  consentService: { get: vi.fn(), update: vi.fn() },
}))

import { chatService } from '../services/chatService'
import { complianceService } from '../services/complianceService'
import { consentService } from '../services/consentService'
import { localModelService } from '../services/localModelService'
import { useChatStore } from '../stores/chatStore'
import { useComplianceStore } from '../stores/complianceStore'
import ChatPage from './ChatPage'

const renderPage = () => render(<MemoryRouter><ChatPage /></MemoryRouter>)

describe('ChatPage', () => {
  beforeEach(() => {
    // 已确认过 AI 提示，避免弹窗遮挡交互
    localStorage.setItem('cyber-sister-disclaimer-shown', 'true')
    useChatStore.setState({
      conversations: [],
      currentConversationId: null,
      messages: [],
      isTyping: false,
      isSending: false,
    })
    useComplianceStore.setState({
      showCrisisModal: false,
      showUsageReminder: false,
      showAIDisclaimer: false,
      crisisLevel: null,
    })
    chatService.getConversations.mockResolvedValue([])
    sessionStorage.clear()
    localModelService.getStatus.mockResolvedValue({
      local: { configured: true, state: 'ready' },
      externalFallback: { configured: true, consent: null, version: 'qwen-fallback-v1' },
    })
  })

  it('shows the AI disclaimer dialog on the very first visit', async () => {
    const user = userEvent.setup()
    localStorage.removeItem('cyber-sister-disclaimer-shown')
    renderPage()

    expect(await screen.findByRole('dialog', { name: '我是AI，不是真人' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '我知道了' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(localStorage.getItem('cyber-sister-disclaimer-shown')).toBe('true')
  })

  it('greets with topic shortcuts on an empty conversation', async () => {
    renderPage()

    expect(await screen.findByText('嗨，我是你的赛博姐妹')).toBeInTheDocument()
    for (const topic of ['今天心情不好', '推荐个电影', '聊聊八卦', '帮我出主意']) {
      expect(screen.getByRole('button', { name: topic })).toBeInTheDocument()
    }
  })

  it('sends a topic shortcut and renders both sides of the reply', async () => {
    const user = userEvent.setup()
    chatService.createConversation.mockResolvedValue({ id: 'c1' })
    chatService.sendMessage.mockResolvedValue({
      status: 'ok',
      source: 'local_template',
      userMessage: { id: 'u1', role: 'user', content: '推荐个电影' },
      aiMessage: { id: 'a1', role: 'assistant', content: '看《好东西》吧' },
    })
    renderPage()

    await user.click(await screen.findByRole('button', { name: '推荐个电影' }))

    expect(await screen.findByText('看《好东西》吧')).toBeInTheDocument()
    expect(screen.getByText('推荐个电影')).toBeInTheDocument()
    expect(chatService.sendMessage).toHaveBeenCalledWith('c1', '推荐个电影')
  })

  it('surfaces a blocked intervention inside the crisis modal', async () => {
    const user = userEvent.setup()
    useChatStore.setState({ currentConversationId: 'c1' })
    chatService.sendMessage.mockResolvedValue({
      status: 'blocked',
      userMessage: { id: 'u1', role: 'user', content: '危机输入' },
      intervention: { level: 'high', message: '我很担心你，请先确保安全', resources: [] },
    })
    renderPage()

    const input = screen.getByRole('textbox', { name: '聊天消息' })
    await user.type(input, '危机输入')
    await user.click(screen.getByRole('button', { name: '发送消息' }))

    expect(await screen.findByRole('alertdialog')).toBeInTheDocument()
    expect(within(screen.getByRole('alertdialog')).getByText('我很担心你，请先确保安全')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '我知道了' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it.each([
    [{ code: 'LOCAL_LLM_NOT_CONFIGURED' }, '本地模型尚未连接，请前往“我的 → 本地模型”查看设置。原输入已保留。'],
    [{ code: 'LOCAL_LLM_UNAVAILABLE' }, '本地模型暂时不可用，且没有在未授权时转发到云端。原输入已保留，请稍后重试。'],
    [{ code: 'LLM_UNAVAILABLE' }, '本地模型与已授权的云端备用均不可用。原输入已保留，请稍后重试。'],
    [{ message: 'unknown failure' }, '消息发送失败，原输入已保留，请重试。'],
  ])('explains send failure %o without losing the draft', async (errorPayload, expectedMessage) => {
    const user = userEvent.setup()
    useChatStore.setState({ currentConversationId: 'c1' })
    chatService.sendMessage.mockRejectedValue({
      response: { data: { error: errorPayload } },
    })
    renderPage()

    const input = screen.getByRole('textbox', { name: '聊天消息' })
    await user.type(input, '这条会失败')
    await user.click(screen.getByRole('button', { name: '发送消息' }))

    expect(await screen.findByText(expectedMessage)).toBeInTheDocument()
    // 发送失败时草稿保留，方便重试
    expect(input).toHaveValue('这条会失败')
  })

  it('shows the typing indicator while the AI is composing', () => {
    useChatStore.setState({ isTyping: true, messages: [{ id: 'm1', role: 'user', content: '在吗' }] })

    const { container } = renderPage()

    expect(container.querySelectorAll('.typing-dot')).toHaveLength(3)
  })

  it('renders the persisted conversation history', () => {
    useChatStore.setState({
      messages: [
        { id: 'u1', role: 'user', content: '旧问题' },
        { id: 'a1', role: 'assistant', content: '旧回答', source: 'local_model' },
      ],
    })

    renderPage()

    expect(screen.getByText('旧问题')).toBeInTheDocument()
    expect(screen.getByText('旧回答')).toBeInTheDocument()
    expect(screen.getByText('本机模型')).toBeInTheDocument()
  })
})

describe('ChatPage usage session wiring', () => {
  beforeEach(() => {
    localStorage.setItem('cyber-sister-disclaimer-shown', 'true')
    useChatStore.setState({
      conversations: [],
      currentConversationId: null,
      messages: [],
      isTyping: false,
      isSending: false,
    })
    useComplianceStore.setState({
      showCrisisModal: false,
      showUsageReminder: false,
      showAIDisclaimer: false,
      crisisLevel: null,
      usageStartTime: null,
      usageMinutes: 0,
    })
    chatService.getConversations.mockResolvedValue([])
    complianceService.startUsage.mockResolvedValue({})
    complianceService.endUsage.mockResolvedValue({})
  })

  it('starts a usage session on mount and settles it on unmount', async () => {
    const { unmount } = renderPage()

    expect(complianceService.startUsage).toHaveBeenCalledTimes(1)
    await act(async () => {})
    expect(useComplianceStore.getState().usageStartTime).not.toBeNull()

    unmount()

    expect(complianceService.endUsage).toHaveBeenCalledTimes(1)
  })

  it('surfaces the two-hour reminder once the interval check trips', async () => {
    vi.useFakeTimers()
    try {
      renderPage()
      // 等 startSession 落定后，把会话起点拨到两小时前
      await act(async () => {})
      useComplianceStore.setState({ usageStartTime: Date.now() - 121 * 60_000 })

      act(() => { vi.advanceTimersByTime(60_000) })

      expect(screen.getByRole('dialog', { name: '已经聊了两个小时啦' })).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('stops checking after unmount', async () => {
    vi.useFakeTimers()
    try {
      const { unmount } = renderPage()
      await act(async () => {})
      unmount()

      act(() => { vi.advanceTimersByTime(10 * 60_000) })

      expect(useComplianceStore.getState().showUsageReminder).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})
describe('ChatPage 云端备用引导', () => {
  beforeEach(() => {
    localStorage.setItem('cyber-sister-disclaimer-shown', 'true')
    useChatStore.setState({
      conversations: [],
      currentConversationId: null,
      messages: [],
      isTyping: false,
      isSending: false,
    })
    useComplianceStore.setState({
      showCrisisModal: false,
      showUsageReminder: false,
      showAIDisclaimer: false,
      crisisLevel: null,
    })
    chatService.getConversations.mockResolvedValue([])
    sessionStorage.clear()
  })

  const statusWith = ({ state = 'ready', configured = true, consent = null } = {}) => ({
    local: { configured: true, state },
    externalFallback: { configured, consent, version: 'qwen-fallback-v1' },
  })

  it('prompts when the local model is unavailable and consent is undecided', async () => {
    const user = userEvent.setup()
    localModelService.getStatus.mockResolvedValue(statusWith({ state: 'unavailable' }))
    consentService.update.mockResolvedValue({ accepted: true })
    renderPage()

    expect(await screen.findByText('本地模型暂时不可用')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '允许云端备用' }))

    expect(consentService.update).toHaveBeenCalledWith(true)
    expect(screen.queryByText('本地模型暂时不可用')).not.toBeInTheDocument()
  })

  it('stays quiet when consent was already given', async () => {
    localModelService.getStatus.mockResolvedValue(statusWith({ state: 'unavailable', consent: true }))
    renderPage()

    await act(async () => {})
    expect(screen.queryByText('本地模型暂时不可用')).not.toBeInTheDocument()
  })

  it('stays quiet when consent was already refused', async () => {
    localModelService.getStatus.mockResolvedValue(statusWith({ state: 'unavailable', consent: false }))
    renderPage()

    await act(async () => {})
    expect(screen.queryByText('本地模型暂时不可用')).not.toBeInTheDocument()
  })

  it('stays quiet when no cloud fallback is configured', async () => {
    localModelService.getStatus.mockResolvedValue(statusWith({ state: 'unavailable', configured: false }))
    renderPage()

    await act(async () => {})
    expect(screen.queryByText('本地模型暂时不可用')).not.toBeInTheDocument()
  })

  it('stays quiet while the local model is ready', async () => {
    localModelService.getStatus.mockResolvedValue(statusWith({ state: 'ready' }))
    renderPage()

    await act(async () => {})
    expect(screen.queryByText('本地模型暂时不可用')).not.toBeInTheDocument()
  })

  it('fails silently when the status request itself fails', async () => {
    localModelService.getStatus.mockRejectedValue(new Error('network down'))
    renderPage()

    await act(async () => {})
    expect(screen.queryByText('本地模型暂时不可用')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '今天心情不好' })).toBeInTheDocument()
  })

  it('stays quiet for the rest of the session after 暂不', async () => {
    sessionStorage.setItem('cloudFallbackDismissed', 'true')
    localModelService.getStatus.mockResolvedValue(statusWith({ state: 'unavailable' }))
    renderPage()

    await act(async () => {})
    expect(localModelService.getStatus).not.toHaveBeenCalled()
    expect(screen.queryByText('本地模型暂时不可用')).not.toBeInTheDocument()
  })
})
