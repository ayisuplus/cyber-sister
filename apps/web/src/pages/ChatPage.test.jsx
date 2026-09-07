import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../services/chatService', () => ({
  chatService: {
    getConversations: vi.fn(),
    getConversation: vi.fn(),
    createConversation: vi.fn(),
    streamMessage: vi.fn(),
    deleteConversation: vi.fn(),
  },
}))

// 让测试逐事件驱动流式响应；emit 推事件，finish 结束流
const controllableStream = () => {
  const control = {}
  chatService.streamMessage.mockImplementation(
    (conversationId, content, { onEvent }) => new Promise((resolve, reject) => {
      control.onEvent = onEvent
      control.resolve = resolve
      control.reject = reject
    })
  )
  return control
}

vi.mock('../services/complianceService', () => ({
  complianceService: {
    reportCrisis: vi.fn(),
    startUsage: vi.fn(),
    heartbeat: vi.fn(),
    endUsage: vi.fn(),
    getUsageStatus: vi.fn(),
  },
}))
vi.mock('../services/modelStatusService', () => ({
  modelStatusService: { getStatus: vi.fn() },
}))

vi.mock('../services/consentService', () => ({
  consentService: { get: vi.fn(), update: vi.fn() },
}))

vi.mock('../services/memoryService', () => ({
  memoryService: { getSuggestions: vi.fn(), create: vi.fn() },
}))

import { chatService } from '../services/chatService'
import { complianceService } from '../services/complianceService'
import { consentService } from '../services/consentService'
import { modelStatusService } from '../services/modelStatusService'
import { memoryService } from '../services/memoryService'
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
    modelStatusService.getStatus.mockResolvedValue({
      mode: 'external_primary',
      local: { configured: false, state: 'removed' },
      externalFallback: { configured: true, consent: true, version: 'qwen-fallback-v1' },
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

  it('streams a topic shortcut reply: deltas appear progressively, then persisted messages take over', async () => {
    const user = userEvent.setup()
    chatService.createConversation.mockResolvedValue({ id: 'c1' })
    const stream = controllableStream()
    renderPage()

    await user.click(await screen.findByRole('button', { name: '推荐个电影' }))

    expect(chatService.streamMessage).toHaveBeenCalledWith('c1', '推荐个电影', expect.objectContaining({
      onEvent: expect.any(Function),
    }))
    // 首个 delta 前由 TypingIndicator 承担进行中视觉
    expect(document.querySelectorAll('.typing-dot')).toHaveLength(3)

    stream.onEvent({ event: 'delta', text: '看《好东西》' })
    expect(await screen.findByText('看《好东西》')).toBeInTheDocument()
    expect(document.querySelectorAll('.typing-dot')).toHaveLength(0)

    // replace 整体替换此前已渲染的临时文本
    stream.onEvent({ event: 'replace', content: '看《流浪地球》吧' })
    expect(await screen.findByText('看《流浪地球》吧')).toBeInTheDocument()
    expect(screen.queryByText('看《好东西》')).not.toBeInTheDocument()

    // done 用持久化消息替换临时消息
    stream.onEvent({
      event: 'done',
      status: 'ok',
      source: 'local_template',
      userMessage: { id: 'u1', role: 'user', content: '推荐个电影' },
      aiMessage: { id: 'a1', role: 'assistant', content: '看《流浪地球》吧' },
    })
    stream.resolve()

    expect(await screen.findByText('本地安全模板')).toBeInTheDocument()
    expect(screen.getByText('推荐个电影')).toBeInTheDocument()
    expect(useChatStore.getState().messages.map(m => m.id)).toEqual(['u1', 'a1'])
  })

  it('surfaces a blocked intervention inside the crisis modal', async () => {
    const user = userEvent.setup()
    useChatStore.setState({ currentConversationId: 'c1' })
    chatService.streamMessage.mockImplementation((conversationId, content, { onEvent }) => {
      onEvent({
        event: 'blocked',
        status: 'blocked',
        userMessage: { id: 'u1', role: 'user', content: '危机输入' },
        intervention: { level: 'high', message: '我很担心你，请先确保安全', resources: [] },
      })
      return Promise.resolve()
    })
    renderPage()

    const input = screen.getByRole('textbox', { name: '聊天消息' })
    await user.type(input, '危机输入')
    await user.click(screen.getByRole('button', { name: '发送消息' }))

    expect(await screen.findByRole('alertdialog')).toBeInTheDocument()
    expect(within(screen.getByRole('alertdialog')).getByText('我很担心你，请先确保安全')).toBeInTheDocument()
    // 阻断不留临时 AI 占位
    expect(useChatStore.getState().messages.every(m => !m.id.startsWith('temp-'))).toBe(true)

    await user.click(screen.getByRole('button', { name: '我知道了' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it.each([
    [{ code: 'CLOUD_NOT_CONSENTED' }, '需要你先同意使用云端模型才能聊天：请到「我的」页面开启。原输入已保留。'],
    [{ code: 'LLM_UNAVAILABLE' }, '云端模型暂时不可用。原输入已保留，请稍后重试。'],
    [{ message: 'unknown failure' }, '消息发送失败，原输入已保留，请重试。'],
  ])('explains send failure %o without losing the draft', async (errorPayload, expectedMessage) => {
    const user = userEvent.setup()
    useChatStore.setState({ currentConversationId: 'c1' })
    // 流式错误直接携带 code；未知失败保持通用文案
    chatService.streamMessage.mockRejectedValue(errorPayload)
    renderPage()

    const input = screen.getByRole('textbox', { name: '聊天消息' })
    await user.type(input, '这条会失败')
    await user.click(screen.getByRole('button', { name: '发送消息' }))

    expect(await screen.findByText(expectedMessage)).toBeInTheDocument()
    // 发送失败时草稿保留，方便重试
    expect(input).toHaveValue('这条会失败')
    // 失败不留临时消息，页面可继续重试
    expect(useChatStore.getState().messages).toEqual([])
    expect(useChatStore.getState().isSending).toBe(false)
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
        { id: 'a1', role: 'assistant', content: '旧回答', source: 'qwen' },
      ],
    })

    renderPage()

    expect(screen.getByText('旧问题')).toBeInTheDocument()
    expect(screen.getByText('旧回答')).toBeInTheDocument()
    expect(screen.getByText('云端模型')).toBeInTheDocument()
  })
})

describe('ChatPage 帮我记住入口', () => {
  const persistedPair = [
    { id: 'u1', role: 'user', content: '我最近在看科幻片' },
    { id: 'a1', role: 'assistant', content: '推荐《流浪地球》', source: 'qwen' },
  ]

  beforeEach(() => {
    localStorage.setItem('cyber-sister-disclaimer-shown', 'true')
    useChatStore.setState({
      conversations: [],
      currentConversationId: 'c1',
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
    modelStatusService.getStatus.mockResolvedValue({
      mode: 'external_primary',
      local: { configured: false, state: 'removed' },
      externalFallback: { configured: true, consent: true, version: 'qwen-fallback-v1' },
    })
  })

  it('shows the entry on the latest normal assistant reply, keyed to the preceding user message', async () => {
    const user = userEvent.setup()
    memoryService.getSuggestions.mockResolvedValue({
      candidates: [{ type: 'semantic', content: '喜欢科幻电影', importance: 7, tags: ['电影'] }],
    })
    useChatStore.setState({ messages: persistedPair })
    renderPage()

    await user.click(await screen.findByRole('button', { name: /帮我记住/ }))

    // 建议接口以前置 user 消息 id 为对象
    expect(memoryService.getSuggestions).toHaveBeenCalledWith('u1')
    expect(await screen.findByDisplayValue('喜欢科幻电影')).toBeInTheDocument()
  })

  it('hides the entry while the reply is still streaming', () => {
    useChatStore.setState({
      messages: [
        persistedPair[0],
        { id: 'temp-ai-1', role: 'assistant', content: '生成中片段', streaming: true },
      ],
    })
    renderPage()

    expect(screen.queryByRole('button', { name: /帮我记住/ })).not.toBeInTheDocument()
  })

  it('hides the entry when the last message is a user message (blocked flow leaves no reply)', () => {
    useChatStore.setState({ messages: [persistedPair[0]] })
    renderPage()

    expect(screen.queryByRole('button', { name: /帮我记住/ })).not.toBeInTheDocument()
  })

  it('keeps chat messages untouched when suggestion generation fails', async () => {
    const user = userEvent.setup()
    memoryService.getSuggestions.mockRejectedValue(new Error('LOCAL_LLM_UNAVAILABLE'))
    useChatStore.setState({ messages: persistedPair })
    renderPage()

    await user.click(await screen.findByRole('button', { name: /帮我记住/ }))

    expect(await screen.findByRole('alert')).toHaveTextContent('暂时无法生成记忆建议，稍后再试')
    // 聊天消息与发送错误条均不受影响
    expect(useChatStore.getState().messages.map((message) => message.id)).toEqual(['u1', 'a1'])
    expect(screen.getByText('推荐《流浪地球》')).toBeInTheDocument()
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
describe('ChatPage 云端同意门', () => {
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

  const statusWith = ({ configured = true, consent = null } = {}) => ({
    mode: 'external_primary',
    local: { configured: false, state: 'removed' },
    externalFallback: { configured, consent, version: 'qwen-fallback-v1' },
  })

  it('prompts for consent when the cloud provider is configured but consent is undecided', async () => {
    const user = userEvent.setup()
    modelStatusService.getStatus.mockResolvedValue(statusWith())
    consentService.update.mockResolvedValue({ accepted: true })
    renderPage()

    expect(await screen.findByText('这个姐妹住在云端')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '同意并开始聊天' }))

    expect(consentService.update).toHaveBeenCalledWith(true)
    expect(screen.queryByText('这个姐妹住在云端')).not.toBeInTheDocument()
  })

  it('stays quiet when consent was already given', async () => {
    modelStatusService.getStatus.mockResolvedValue(statusWith({ consent: true }))
    renderPage()

    await act(async () => {})
    expect(screen.queryByText('这个姐妹住在云端')).not.toBeInTheDocument()
  })

  it('stays quiet when consent was already refused', async () => {
    modelStatusService.getStatus.mockResolvedValue(statusWith({ consent: false }))
    renderPage()

    await act(async () => {})
    expect(screen.queryByText('这个姐妹住在云端')).not.toBeInTheDocument()
  })

  it('stays quiet when no cloud provider is configured', async () => {
    modelStatusService.getStatus.mockResolvedValue(statusWith({ configured: false }))
    renderPage()

    await act(async () => {})
    expect(screen.queryByText('这个姐妹住在云端')).not.toBeInTheDocument()
  })

  it('fails silently when the status request itself fails', async () => {
    modelStatusService.getStatus.mockRejectedValue(new Error('network down'))
    renderPage()

    await act(async () => {})
    expect(screen.queryByText('这个姐妹住在云端')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '今天心情不好' })).toBeInTheDocument()
  })

  it('stays quiet for the rest of the session after 暂不', async () => {
    sessionStorage.setItem('cloudFallbackDismissed', 'true')
    modelStatusService.getStatus.mockResolvedValue(statusWith())
    renderPage()

    await act(async () => {})
    expect(modelStatusService.getStatus).not.toHaveBeenCalled()
    expect(screen.queryByText('这个姐妹住在云端')).not.toBeInTheDocument()
  })
})

