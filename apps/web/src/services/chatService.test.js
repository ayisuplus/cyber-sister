import { describe, expect, it, vi } from 'vitest'

vi.mock('./api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}))

import api from './api'
import { chatService } from './chatService'

describe('chatService', () => {
  it('lists and creates conversations', async () => {
    api.get.mockResolvedValue({ data: [{ id: 'c1' }] })
    api.post.mockResolvedValue({ data: { id: 'c2' } })

    const list = await chatService.getConversations()
    const created = await chatService.createConversation()

    expect(api.get).toHaveBeenCalledWith('/chat/conversations')
    expect(list).toEqual([{ id: 'c1' }])
    expect(api.post).toHaveBeenCalledWith('/chat/conversations')
    expect(created).toEqual({ id: 'c2' })
  })

  it('loads a single conversation with its messages', async () => {
    api.get.mockResolvedValue({ data: { id: 'c1', messages: [{ id: 'm1' }] } })

    const result = await chatService.getConversation('c1')

    expect(api.get).toHaveBeenCalledWith('/chat/conversations/c1')
    expect(result.messages).toEqual([{ id: 'm1' }])
  })

  it('sends a message to the given conversation', async () => {
    api.post.mockResolvedValue({ data: { status: 'ok' } })

    const result = await chatService.sendMessage('c1', '你好')

    expect(api.post).toHaveBeenCalledWith('/chat/conversations/c1/messages', { content: '你好' })
    expect(result).toEqual({ status: 'ok' })
  })

  it('deletes a conversation by id', async () => {
    api.delete.mockResolvedValue({ data: {} })

    await chatService.deleteConversation('c1')

    expect(api.delete).toHaveBeenCalledWith('/chat/conversations/c1')
  })
})
