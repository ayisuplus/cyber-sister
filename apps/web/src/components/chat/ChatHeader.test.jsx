import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useAuthStore } from '../../stores/authStore'
import ChatHeader from './ChatHeader'

describe('ChatHeader', () => {
  it('always reminds the user they are talking to an AI', () => {
    useAuthStore.setState({ user: null })

    render(<ChatHeader />)

    expect(screen.getByText('这是 AI，不是真人')).toBeInTheDocument()
    expect(screen.getByText('AI 生成 · 本地优先')).toBeInTheDocument()
  })

  it.each([
    ['toxic', '毒舌·护短·嘴硬心软'],
    ['gentle', '包容·耐心·讲道理'],
    ['rational', '清晰·务实·有边界'],
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

    const avatar = screen.getByAltText('赛博姐妹 AI')
    avatar.dispatchEvent(new Event('error'))

    expect(avatar.style.display).toBe('none')
  })
})
