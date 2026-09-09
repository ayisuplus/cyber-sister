import { render, screen } from '@testing-library/react'
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
  },
}))

import { useChatStore } from '../../stores/chatStore'
import ConversationDrawer from './ConversationDrawer'

describe('ConversationDrawer', () => {
  beforeEach(() => {
    useChatStore.setState({
      conversations: [
        { id: 'c1', title: '深夜倾诉', updatedAt: '2026-09-05T08:00:00.000Z', messages: [] },
      ],
      currentConversationId: 'c1',
      chatMode: 'chat',
    })
  })

  it('renders nothing when closed', () => {
    const { container } = render(<MemoryRouter><ConversationDrawer open={false} onClose={vi.fn()} /></MemoryRouter>)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders the conversation list when open', () => {
    render(<MemoryRouter><ConversationDrawer open onClose={vi.fn()} /></MemoryRouter>)
    expect(screen.getByRole('button', { name: /^深夜倾诉/ })).toBeInTheDocument()
  })

  it('calls onClose when the backdrop button is clicked', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<MemoryRouter><ConversationDrawer open onClose={onClose} /></MemoryRouter>)

    await user.click(screen.getByRole('button', { name: '关闭会话列表' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
