import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '../../stores/authStore'
import { useChatStore } from '../../stores/chatStore'
import ChatHeader from './ChatHeader'



describe('ChatHeader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useChatStore.setState({
      conversations: [],
      currentConversationId: null,
      messages: [],
      chatMode: 'chat',
    })
  })

  it('always reminds the user they are talking to an AI', () => {
    useAuthStore.setState({ user: null })

    render(<ChatHeader />)

    expect(screen.getByText('这是 AI，不是真人')).toBeInTheDocument()
    expect(screen.getByText('AI 生成 · 云端模型')).toBeInTheDocument()
  })

  it.each([
    ['toxic', '毒舌·护短·嘴硬心软'],
    ['gentle', '包容·耐心·讲道理'],
    ['rational', '清晰·务实·有边界'],
    ['energetic', '热情·捧场·行动力'],
    ['sister', '共情·念叨·靠得住'],
    ['cool', '话少·冷静·关键时刻靠谱'],
  ])('shows the %s persona tag', (persona, tag) => {
    useAuthStore.setState({ user: { id: 'u1', persona } })

    render(<ChatHeader />)

    expect(screen.getByText(tag)).toBeInTheDocument()
  })

  it('falls back to the toxic persona for unknown or missing personas', () => {
    useAuthStore.setState({ user: { id: 'u1', persona: 'unknown-persona' } })

    render(<ChatHeader />)

    expect(screen.getByText('毒舌·护短·嘴硬心软')).toBeInTheDocument()
  })

  it('hides the broken avatar image instead of showing a broken icon', () => {
    useAuthStore.setState({ user: null })
    render(<ChatHeader />)

    const avatar = screen.getByAltText('Amie AI')
    avatar.dispatchEvent(new Event('error'))

    expect(avatar.style.display).toBe('none')
  })

  it('renders the chat/work segmented switch with aria-pressed state', () => {
    useAuthStore.setState({ user: null })

    render(<ChatHeader />)

    expect(screen.getByRole('button', { name: '聊天' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '工作' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('clicking 工作 switches the store to work mode and swaps the persona badge for the work badge', async () => {
    useAuthStore.setState({ user: { id: 'u1', persona: 'gentle' } })

    render(<ChatHeader />)
    fireEvent.click(screen.getByRole('button', { name: '工作' }))

    expect(useChatStore.getState().chatMode).toBe('work')
    expect(await screen.findByText('工作模式')).toBeInTheDocument()
    expect(screen.queryByText('包容·耐心·讲道理')).not.toBeInTheDocument()
    // 云端切割后内置浏览器已删除：工作模式不再渲染任何浏览器状态徽标
    expect(screen.queryByText('浏览器已就绪')).not.toBeInTheDocument()
    expect(screen.queryByText('浏览器未启用')).not.toBeInTheDocument()
  })

  it('工作模式出现「打开功能桌面」按钮并触发回调；聊天模式不出现', () => {
    useAuthStore.setState({ user: null })
    useChatStore.setState({ chatMode: 'work' })
    const onOpenWorkbench = vi.fn()

    render(<ChatHeader onOpenWorkbench={onOpenWorkbench} />)
    fireEvent.click(screen.getByRole('button', { name: '打开功能桌面' }))
    expect(onOpenWorkbench).toHaveBeenCalledTimes(1)

    act(() => useChatStore.setState({ chatMode: 'chat' }))
    expect(screen.queryByRole('button', { name: '打开功能桌面' })).not.toBeInTheDocument()
  })

})
