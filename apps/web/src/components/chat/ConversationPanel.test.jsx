import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../services/chatService', () => ({
  chatService: {
    getConversations: vi.fn(),
    getConversation: vi.fn(),
    createConversation: vi.fn(),
    streamMessage: vi.fn(),
    deleteConversation: vi.fn(),
  },
}))

import { chatService } from '../../services/chatService'
import { useChatStore } from '../../stores/chatStore'
import ConversationPanel from './ConversationPanel'

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

describe('ConversationPanel', () => {
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
    render(<ConversationPanel />)

    expect(screen.getByRole('button', { name: /^深夜倾诉/ })).toBeInTheDocument()
    expect(screen.getByText('我在呢，慢慢说')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^周末计划/ })).toBeInTheDocument()
    expect(screen.getByText('帮我安排一下周末')).toBeInTheDocument()
    expect(screen.getByText('8月30日')).toBeInTheDocument()
  })

  it('highlights the current conversation and switches on click', async () => {
    const user = userEvent.setup()
    chatService.getConversation.mockResolvedValue({ id: 'c2', messages: [] })
    render(<ConversationPanel />)

    const current = screen.getByRole('button', { name: /^深夜倾诉/ })
    expect(current).toHaveAttribute('aria-current', 'true')
    expect(current).toHaveClass('text-action-primary')

    await user.click(screen.getByRole('button', { name: /^周末计划/ }))

    expect(chatService.getConversation).toHaveBeenCalledWith('c2')
    await waitFor(() => {
      expect(useChatStore.getState().currentConversationId).toBe('c2')
    })
  })

  it('creates a new conversation from the footer button', async () => {
    const user = userEvent.setup()
    chatService.createConversation.mockResolvedValue({ id: 'c3', title: '赛博姐妹' })
    render(<ConversationPanel />)

    await user.click(screen.getByRole('button', { name: '新会话' }))

    expect(chatService.createConversation).toHaveBeenCalledTimes(1)
    await waitFor(() => {
      expect(useChatStore.getState().currentConversationId).toBe('c3')
    })
  })

  it('deletes a conversation only after in-app confirmation', async () => {
    const user = userEvent.setup()
    chatService.deleteConversation.mockResolvedValue({ success: true })
    render(<ConversationPanel />)

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

    const { unmount } = render(<ConversationPanel />)

    expect(screen.getByRole('button', { name: /^季度汇报/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^深夜倾诉/ })).toBeNull()
    unmount()

    useChatStore.setState({ conversations: [] })
    render(<ConversationPanel />)
    expect(screen.getByText('还没有工作会话，发一条就开始')).toBeInTheDocument()
  })
})
