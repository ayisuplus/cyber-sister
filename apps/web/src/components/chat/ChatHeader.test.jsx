import { MemoryRouter } from 'react-router-dom'
import { render as renderComponent, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '../../stores/authStore'
import { useChatStore } from '../../stores/chatStore'
import ChatHeader from './ChatHeader'



const render = (element) => renderComponent(<MemoryRouter>{element}</MemoryRouter>)

describe('ChatHeader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useChatStore.setState({
      conversations: [],
      currentConversationId: null,
      messages: [],
    })
  })

  it('always reminds the user they are talking to an AI', () => {
    useAuthStore.setState({ user: null })

    render(<ChatHeader />)

    expect(screen.getByText('这是 AI，不是真人')).toBeInTheDocument()
    expect(screen.getByText('AI 生成 · 云端模型')).toBeInTheDocument()
  })

  it.each(['toxic', 'gentle', 'cool', 'energetic'])('shows only her name, without a persona badge, for %s', (persona) => {
    useAuthStore.setState({ user: { id: 'u1', persona } })

    render(<ChatHeader />)

    expect(screen.getByRole('heading', { name: 'Amie' })).toBeInTheDocument()
    for (const tag of ['毒舌·护短·嘴硬心软', '包容·耐心·讲道理', '话少·冷静·关键时刻靠谱', '热情·捧场·行动力']) {
      expect(screen.queryByText(tag)).not.toBeInTheDocument()
    }
  })

  it('hides the broken avatar image instead of showing a broken icon', () => {
    useAuthStore.setState({ user: null })
    render(<ChatHeader />)

    const avatar = screen.getByAltText('Amie AI')
    avatar.dispatchEvent(new Event('error'))

    expect(avatar.style.display).toBe('none')
  })

  it('只有一种对话：没有聊天/工作切换，也没有工作模式徽标', () => {
    useAuthStore.setState({ user: { id: 'u1', persona: 'gentle' } })

    render(<ChatHeader />)

    expect(screen.queryByRole('group', { name: '会话模式' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '工作' })).not.toBeInTheDocument()
    expect(screen.queryByText('工作模式')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '打开设置' })).toHaveAttribute('href', '/settings')
  })
})
