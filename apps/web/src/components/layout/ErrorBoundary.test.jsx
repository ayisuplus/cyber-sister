import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import ErrorBoundary from './ErrorBoundary'

function Bomb() {
  throw new Error('boom')
}

describe('ErrorBoundary', () => {
  it('子树抛错时显示降级界面而不是白屏', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<ErrorBoundary><Bomb /></ErrorBoundary>)
    expect(await screen.findByText('这一页出了点问题')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '回到聊天' })).toBeInTheDocument()
    expect(consoleSpy).toHaveBeenCalledWith('页面渲染异常:', 'Error')
    consoleSpy.mockRestore()
  })

  it('降级界面提供回聊天页的出口', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const assignMock = vi.fn()
    const original = window.location
    Object.defineProperty(window, 'location', { value: { ...original, assign: assignMock }, configurable: true })
    render(<ErrorBoundary><Bomb /></ErrorBoundary>)
    await userEvent.click(await screen.findByRole('button', { name: '回到聊天' }))
    expect(assignMock).toHaveBeenCalledWith('/chat')
    Object.defineProperty(window, 'location', { value: original, configurable: true })
    vi.restoreAllMocks()
  })

  it('无异常时正常渲染子树', () => {
    render(<ErrorBoundary><p>正常内容</p></ErrorBoundary>)
    expect(screen.getByText('正常内容')).toBeInTheDocument()
  })
})
