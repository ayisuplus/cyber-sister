import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../services/chatService', () => ({
  chatService: {
    getConversations: vi.fn(),
    getConversation: vi.fn(),
    createConversation: vi.fn(),
    streamMessage: vi.fn(),
    deleteConversation: vi.fn(),
    setArchived: vi.fn(),
  },
}))

import { chatService } from '../../services/chatService'
import { useChatStore } from '../../stores/chatStore'
import ConversationList from './ConversationList'
import AppSidebar from './AppSidebar'

const CONVERSATIONS = [
  {
    id: 'c1',
    title: '深夜倾诉',
    updatedAt: '2026-09-05T08:00:00.000Z',
    messages: [{ id: 'm2', role: 'assistant', content: '我在呢，慢慢说' }],
  },
  {
    id: 'c2',
    title: '周末计划',
    updatedAt: '2026-08-30T10:00:00.000Z',
    messages: [{ id: 'm1', role: 'user', content: '帮我安排一下周末' }],
  },
]

describe('ConversationList', () => {
  beforeEach(() => {
    useChatStore.setState({
      conversations: CONVERSATIONS,
      currentConversationId: 'c1',
      messages: [],
      isTyping: false,
      isSending: false,
      chatMode: 'chat',
    })
  })

  it('renders the conversation list with title, preview and time', () => {
    render(<MemoryRouter><ConversationList /></MemoryRouter>)

    expect(screen.getByRole('button', { name: /^深夜倾诉/ })).toBeInTheDocument()
    expect(screen.getByText('我在呢，慢慢说')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^周末计划/ })).toBeInTheDocument()
    expect(screen.getByText('帮我安排一下周末')).toBeInTheDocument()
    expect(screen.getByText('8月30日')).toBeInTheDocument()
  })

  it('archives without deleting messages and exposes archive and settings navigation', async () => {
    chatService.setArchived.mockResolvedValue({ success: true })
    render(<MemoryRouter><ConversationList /></MemoryRouter>)
    expect(screen.getByRole('link', { name: '对话归档' })).toHaveAttribute('href', '/chat/archives')
    expect(screen.getByRole('link', { name: '设置' })).toHaveAttribute('href', '/settings')
    await userEvent.click(screen.getByRole('button', { name: '归档会话 周末计划' }))
    expect(chatService.setArchived).toHaveBeenCalledWith('c2', true)
    await waitFor(() => expect(screen.queryByRole('button', { name: /^周末计划/ })).not.toBeInTheDocument())
    expect(chatService.deleteConversation).not.toHaveBeenCalled()
  })

  it('keeps a failed archive visible and prevents archiving an in-flight conversation', async () => {
    chatService.setArchived.mockRejectedValue(new Error('offline'))
    useChatStore.setState({ isSending: true })
    render(<MemoryRouter><ConversationList /></MemoryRouter>)
    expect(screen.getByRole('button', { name: '归档会话 深夜倾诉' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: '归档会话 周末计划' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('归档失败')
    expect(screen.getByRole('button', { name: /^周末计划/ })).toBeInTheDocument()
  })

  it('highlights the current conversation and switches on click', async () => {
    const user = userEvent.setup()
    chatService.getConversation.mockResolvedValue({ id: 'c2', messages: [] })
    render(<MemoryRouter><ConversationList /></MemoryRouter>)

    const current = screen.getByRole('button', { name: /^深夜倾诉/ })
    expect(current).toHaveAttribute('aria-current', 'true')
    expect(current).toHaveClass('text-action-primary')

    await user.click(screen.getByRole('button', { name: /^周末计划/ }))

    expect(chatService.getConversation).toHaveBeenCalledWith('c2')
    await waitFor(() => {
      expect(useChatStore.getState().currentConversationId).toBe('c2')
    })
  })

  it('calls onNavigate when a non-current conversation is clicked', async () => {
    const user = userEvent.setup()
    const onNavigate = vi.fn()
    chatService.getConversation.mockResolvedValue({ id: 'c2', messages: [] })
    render(<MemoryRouter><ConversationList onNavigate={onNavigate} /></MemoryRouter>)

    await user.click(screen.getByRole('button', { name: /^周末计划/ }))

    expect(onNavigate).toHaveBeenCalledTimes(1)
  })

  it('creates a new conversation from the footer button', async () => {
    const user = userEvent.setup()
    chatService.createConversation.mockResolvedValue({ id: 'c3', title: 'Amie' })
    render(<MemoryRouter><ConversationList /></MemoryRouter>)

    await user.click(screen.getByRole('button', { name: '新会话' }))

    expect(chatService.createConversation).toHaveBeenCalledTimes(1)
    await waitFor(() => {
      expect(useChatStore.getState().currentConversationId).toBe('c3')
    })
  })

  it('calls onNavigate after creating a conversation', async () => {
    const user = userEvent.setup()
    const onNavigate = vi.fn()
    chatService.createConversation.mockResolvedValue({ id: 'c3', title: 'Amie' })
    render(<MemoryRouter><ConversationList onNavigate={onNavigate} /></MemoryRouter>)

    await user.click(screen.getByRole('button', { name: '新会话' }))

    await waitFor(() => {
      expect(onNavigate).toHaveBeenCalledTimes(1)
    })
  })

  it('deletes a conversation only after in-app confirmation', async () => {
    const user = userEvent.setup()
    chatService.deleteConversation.mockResolvedValue({ success: true })
    render(<MemoryRouter><ConversationList /></MemoryRouter>)

    await user.click(screen.getByRole('button', { name: '删除会话 周末计划' }))
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument()
    expect(chatService.deleteConversation).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(chatService.deleteConversation).not.toHaveBeenCalled()
    expect(useChatStore.getState().conversations).toHaveLength(2)

    await user.click(screen.getByRole('button', { name: '删除会话 周末计划' }))
    await user.click(await screen.findByRole('button', { name: '确认删除' }))

    await waitFor(() => {
      expect(chatService.deleteConversation).toHaveBeenCalledWith('c2')
    })
    await waitFor(() => {
      expect(useChatStore.getState().conversations.map(c => c.id)).toEqual(['c1'])
    })
  })
  it('filters the list by current chat mode and shows the work empty state', () => {
    useChatStore.setState({
      conversations: [
        { id: 'c1', mode: 'chat', title: '深夜倾诉', updatedAt: '2026-09-05T08:00:00.000Z', messages: [] },
        { id: 'w1', mode: 'work', title: '季度汇报', updatedAt: '2026-09-05T09:00:00.000Z', messages: [] },
      ],
      chatMode: 'work',
      currentConversationId: null,
    })

    const { unmount } = render(<MemoryRouter><ConversationList /></MemoryRouter>)

    expect(screen.getByRole('button', { name: /^季度汇报/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^深夜倾诉/ })).toBeNull()
    unmount()

    useChatStore.setState({ conversations: [] })
    render(<MemoryRouter><ConversationList /></MemoryRouter>)
    expect(screen.getByText('工作云端尚未接通，可先预览功能')).toBeInTheDocument()
  })
})

describe('AppSidebar', () => {
  it('renders brand and the conversation list together', () => {
    chatService.getConversations.mockResolvedValue(CONVERSATIONS)
    useChatStore.setState({
      conversations: CONVERSATIONS,
      currentConversationId: 'c1',
      chatMode: 'chat',
    })
    render(<MemoryRouter><AppSidebar /></MemoryRouter>)

    expect(screen.getByText('Amie')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^深夜倾诉/ })).toBeInTheDocument()
  })
})
