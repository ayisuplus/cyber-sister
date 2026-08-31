import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import MessageBubble from './MessageBubble'

describe('MessageBubble', () => {
  it.each([
    ['local_model', '本机模型'],
    ['qwen', '云端备用'],
    ['local_template', '本地安全模板'],
  ])('shows the real response source %s', (source, label) => {
    render(<MessageBubble message={{ role: 'assistant', content: '回复', source }} isLast={false} />)
    expect(screen.getByText(label)).toBeInTheDocument()
  })
})
describe('MessageBubble rendering contract', () => {
  it('aligns user messages to the right without avatar or source label', () => {
    render(<MessageBubble message={{ role: 'user', content: '我的消息', source: 'qwen' }} isLast={false} />)

    expect(screen.getByText('我的消息')).toBeInTheDocument()
    expect(screen.queryByAltText('赛博姐妹 AI')).not.toBeInTheDocument()
    expect(screen.queryByText('云端备用')).not.toBeInTheDocument()
  })

  it('shows the timestamp only on the last message', () => {
    const { rerender } = render(
      <MessageBubble message={{ role: 'user', content: '旧消息', createdAt: '2026-08-30T10:00:00' }} isLast={false} />,
    )
    expect(screen.queryByText(/\d{2}:\d{2}/)).not.toBeInTheDocument()

    rerender(
      <MessageBubble message={{ role: 'user', content: '新消息', createdAt: '2026-08-30T10:00:00' }} isLast />,
    )
    expect(screen.getByText(/\d{2}:\d{2}/)).toBeInTheDocument()
  })

  it('accents emotional assistant replies with the matching border', () => {
    const { container } = render(
      <MessageBubble message={{ role: 'assistant', content: '抱抱你', emotion: 'sad' }} isLast={false} />,
    )

    expect(container.querySelector('.border-status-info')).not.toBeNull()
  })

  it('keeps unknown emotions visually neutral', () => {
    const { container } = render(
      <MessageBubble message={{ role: 'assistant', content: '嗯', emotion: 'confused' }} isLast={false} />,
    )

    expect(container.querySelector('.border-transparent')).not.toBeNull()
  })
})
