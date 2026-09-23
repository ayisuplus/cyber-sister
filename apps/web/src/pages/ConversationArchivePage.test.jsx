import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../services/chatService', () => ({ chatService: { getConversations: vi.fn(), getConversation: vi.fn(), setArchived: vi.fn(), getThread: vi.fn() } }))
vi.mock('../components/letter/LetterEntry', () => ({ default: ({ message }) => <p>{message.content}</p> }))

import { chatService } from '../services/chatService'
import { useChatStore } from '../stores/chatStore'
import ConversationArchivePage from './ConversationArchivePage'

const archived = { id: 'c1', title: '值得收藏的聊天', mode: 'chat', archivedAt: '2026-09-12T08:00:00Z', messages: [{ id: 'm1', content: '聊天预览' }] }
const renderPage = () => render(<MemoryRouter><ConversationArchivePage /></MemoryRouter>)

describe('ConversationArchivePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useChatStore.getState().reset()
    chatService.getConversations.mockResolvedValue([archived])
    chatService.getConversation.mockResolvedValue({ ...archived, messages: [{ id: 'm1', content: '原来的聊天记录' }] })
    chatService.setArchived.mockResolvedValue({ success: true, archived: false })
    chatService.getThread.mockResolvedValue({ id: 'thread-1', messages: [] })
  })

  it('loads archived conversations and reads retained messages without restoring them', async () => {
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: '查看记录 值得收藏的聊天' }))
    expect(chatService.getConversations).toHaveBeenCalledWith({ archived: true, page: 1, limit: 20 })
    expect(await screen.findByText('原来的聊天记录')).toBeInTheDocument()
    expect(chatService.setArchived).not.toHaveBeenCalled()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('puts an archived conversation back into the one thread and reopens it', async () => {
    renderPage()
    const restore = await screen.findByRole('button', { name: '放回对话 值得收藏的聊天' })
    chatService.getConversations.mockResolvedValue([])
    await userEvent.click(restore)
    expect(chatService.setArchived).toHaveBeenCalledWith('c1', false)
    expect(await screen.findByText('没有以前归档的对话')).toBeInTheDocument()
    // 服务端在打开这段对话时按时间把它合进来
    expect(chatService.getThread).toHaveBeenCalled()
    expect(useChatStore.getState().currentConversationId).toBe('thread-1')
  })

  it('keeps archived records visible if restore fails', async () => {
    chatService.setArchived.mockRejectedValue(new Error('offline'))
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: '放回对话 值得收藏的聊天' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('没放回去')
    expect(screen.getByRole('button', { name: '查看记录 值得收藏的聊天' })).toBeInTheDocument()
  })

  it('loads more archives and older messages in order', async () => {
    chatService.getConversations.mockResolvedValueOnce(Array.from({ length: 20 }, (_, index) => ({ ...archived, id: `c${index}`, title: `归档${index}` })))
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: '加载更多归档' }))
    expect(chatService.getConversations).toHaveBeenLastCalledWith({ archived: true, page: 2, limit: 20 })
    chatService.getConversation.mockResolvedValueOnce({ ...archived, messages: Array.from({ length: 50 }, (_, index) => ({ id: `new${index}`, content: `较新${index}` })) })
    await userEvent.click(await screen.findByRole('button', { name: '查看记录 归档0' }))
    await userEvent.click(await screen.findByRole('button', { name: '加载更早的消息' }))
    await waitFor(() => expect(chatService.getConversation).toHaveBeenLastCalledWith('c1', { page: 2, limit: 50 }))
    expect(await screen.findByText('原来的聊天记录')).toBeInTheDocument()
    expect(screen.getByText('较新49')).toBeInTheDocument()
  })

  it('ignores a late detail response after returning to the archive list', async () => {
    let resolveDetail
    chatService.getConversation.mockReturnValue(new Promise(resolve => { resolveDetail = resolve }))
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: '查看记录 值得收藏的聊天' }))
    await userEvent.click(screen.getByRole('button', { name: '返回归档列表' }))
    resolveDetail({ ...archived, messages: [{ id: 'late', content: '迟到记录' }] })
    await waitFor(() => expect(screen.getByRole('button', { name: '查看记录 值得收藏的聊天' })).toBeInTheDocument())
    expect(screen.queryByText('迟到记录')).not.toBeInTheDocument()
  })
})
