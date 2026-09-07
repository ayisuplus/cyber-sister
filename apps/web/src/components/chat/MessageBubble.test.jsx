import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '../../stores/authStore'
import { useChatStore } from '../../stores/chatStore'
import MessageBubble from './MessageBubble'

vi.mock('../../services/userService', () => ({
  userService: {
    fetchAssetUrl: vi.fn(),
  },
}))

vi.mock('../../services/chatService', () => ({
  chatService: {
    getWorkImageUrl: vi.fn(),
  },
}))


import { userService } from '../../services/userService'
import { chatService } from '../../services/chatService'

describe('MessageBubble', () => {
  it.each([
    ['local_model', '本机模型'],
    ['qwen', '云端备用'],
    ['local_template', '本地安全模板'],
  ])('shows the real response source %s', (source, label) => {
    render(<MessageBubble message={{ role: 'assistant', content: '回复', source }} isLast={false} />)
    expect(screen.getByText(label)).toBeInTheDocument()
  })

  it('labels the cloud model as primary when the deployment is external_primary', () => {
    useChatStore.setState({ llmMode: 'external_primary' })
    render(<MessageBubble message={{ role: 'assistant', content: '回复', source: 'qwen' }} isLast={false} />)
    expect(screen.getByText('云端模型')).toBeInTheDocument()
    expect(screen.queryByText('云端备用')).not.toBeInTheDocument()
    useChatStore.setState({ llmMode: null })
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

describe('MessageBubble tool run chips', () => {
  it('renders success and failure chips with summary text and aria labels', () => {
    render(
      <MessageBubble
        message={{
          role: 'assistant',
          content: '已帮你处理好',
          toolRuns: [
            { tool: 'add_todo', ok: true, summary: '已添加待办「周六复诊」' },
            { tool: 'set_reminder', ok: false, summary: '提醒时间格式无法识别' },
          ],
        }}
        isLast={false}
      />,
    )

    const okChip = screen.getByLabelText('已执行：已添加待办「周六复诊」')
    expect(okChip).toHaveTextContent('✓已添加待办「周六复诊」')
    expect(okChip.className).toContain('bg-pastel-sprout')

    const failChip = screen.getByLabelText('执行失败：提醒时间格式无法识别')
    expect(failChip).toHaveTextContent('✗提醒时间格式无法识别')
    expect(failChip.className).toContain('bg-pastel-blush')
  })

  it('renders no chips when toolRuns is missing, null, or empty', () => {
    const { container, rerender } = render(
      <MessageBubble message={{ role: 'assistant', content: '无动作' }} isLast={false} />,
    )
    expect(container.querySelectorAll('[aria-label^="已执行"], [aria-label^="执行失败"]')).toHaveLength(0)

    rerender(<MessageBubble message={{ role: 'assistant', content: '无动作', toolRuns: null }} isLast={false} />)
    expect(container.querySelectorAll('[aria-label^="已执行"], [aria-label^="执行失败"]')).toHaveLength(0)

    rerender(<MessageBubble message={{ role: 'assistant', content: '无动作', toolRuns: [] }} isLast={false} />)
    expect(container.querySelectorAll('[aria-label^="已执行"], [aria-label^="执行失败"]')).toHaveLength(0)
  })

  it('never renders chips on user messages', () => {
    render(
      <MessageBubble
        message={{ role: 'user', content: '我的消息', toolRuns: [{ tool: 'add_todo', ok: true, summary: '已添加待办' }] }}
        isLast={false}
      />,
    )

    expect(screen.queryByLabelText('已执行：已添加待办')).not.toBeInTheDocument()
  })
})

describe('MessageBubble 生成图', () => {
  it('imageId chip 经鉴权拉取 blob 渲染缩略图，失败时只留文字 chip', async () => {
    chatService.getWorkImageUrl.mockResolvedValue('blob:mock-image-url')
    render(
      <MessageBubble
        message={{
          role: 'assistant',
          content: '画好了',
          toolRuns: [{ tool: 'generate_image', ok: true, summary: '已生成一张图', imageId: 'a1b2c3d4-e5f6-4710-8899-aabbccddeeff.png' }],
        }}
        isLast={false}
      />,
    )

    expect(screen.getByLabelText('已执行：已生成一张图')).toBeInTheDocument()
    const image = await screen.findByAltText('生成的图片')
    expect(image).toHaveAttribute('src', 'blob:mock-image-url')
    expect(chatService.getWorkImageUrl).toHaveBeenCalledWith('a1b2c3d4-e5f6-4710-8899-aabbccddeeff.png')
  })

  it('拉取失败时不渲染图片，只保留文字 chip', async () => {
    chatService.getWorkImageUrl.mockRejectedValue(new Error('404'))
    render(
      <MessageBubble
        message={{
          role: 'assistant',
          content: '画好了',
          toolRuns: [{ tool: 'generate_image', ok: true, summary: '已生成一张图', imageId: 'gone.png' }],
        }}
        isLast={false}
      />,
    )

    expect(screen.getByLabelText('已执行：已生成一张图')).toBeInTheDocument()
    await vi.waitFor(() => expect(chatService.getWorkImageUrl).toHaveBeenCalled())
    expect(screen.queryByAltText('生成的图片')).toBeNull()
  })
})

describe('MessageBubble 用户头像', () => {
  afterEach(() => {
    useAuthStore.setState({ user: null })
  })

  it('用户已设置头像时，用户消息渲染小头像', async () => {
    userService.fetchAssetUrl.mockResolvedValue('blob:avatar')
    useAuthStore.setState({ user: { id: 'u1', nickname: '小赛', avatarUrl: '/api/user/assets/avatar?v=1' } })

    render(<MessageBubble message={{ role: 'user', content: '我的消息' }} isLast={false} />)

    const image = await screen.findByAltText('我的头像')
    expect(image).toHaveAttribute('src', 'blob:avatar')
    expect(userService.fetchAssetUrl).toHaveBeenCalledWith('/api/user/assets/avatar?v=1')
  })

  it('未设置头像时用户消息不渲染头像占位', async () => {
    useAuthStore.setState({ user: { id: 'u1', nickname: '小赛', avatarUrl: null } })

    render(<MessageBubble message={{ role: 'user', content: '我的消息' }} isLast={false} />)

    expect(screen.getByText('我的消息')).toBeInTheDocument()
    expect(screen.queryByAltText('我的头像')).toBeNull()
    expect(userService.fetchAssetUrl).not.toHaveBeenCalled()
  })
})
