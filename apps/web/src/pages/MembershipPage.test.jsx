import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '../stores/authStore'
import MembershipPage from './MembershipPage'

const renderPage = () => render(<MemoryRouter><MembershipPage /></MemoryRouter>)

describe('MembershipPage', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: { id: 'u1', isVip: false } })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('lists free and VIP features side by side with transparent pricing', () => {
    renderPage()

    expect(screen.getByText('成为VIP会员')).toBeInTheDocument()
    expect(screen.getByText('免费版')).toBeInTheDocument()
    expect(screen.getByText('记忆保留7天')).toBeInTheDocument()
    expect(screen.getByText('永久记忆')).toBeInTheDocument()
    expect(screen.getByText('所有付费明码标价，无情感绑定，无抽卡盲盒')).toBeInTheDocument()
  })

  it('defaults to the monthly plan and reflects the price on the CTA', () => {
    renderPage()

    expect(screen.getByRole('button', { name: /立即开通会员 - ¥18\/月/ })).toBeInTheDocument()
  })

  it('switches the CTA price when the yearly plan is selected', () => {
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: /¥128/ }))

    expect(screen.getByRole('button', { name: /立即开通会员 - ¥128\/年/ })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /¥18/ }))
    expect(screen.getByRole('button', { name: /立即开通会员 - ¥18\/月/ })).toBeInTheDocument()
  })

  it('shows a VIP badge instead of the subscribe CTA for existing members', () => {
    useAuthStore.setState({ user: { id: 'u1', isVip: true } })

    renderPage()

    expect(screen.getByText('您已是VIP会员')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /立即开通会员/ })).not.toBeInTheDocument()
  })

  it('upgrades the user to VIP after the mock payment completes', async () => {
    vi.useFakeTimers()
    const alertSpy = vi.fn()
    vi.stubGlobal('alert', alertSpy)
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: /立即开通会员/ }))
    expect(screen.getByText('处理中...')).toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600)
    })

    expect(alertSpy).toHaveBeenCalledWith('开通成功！')
    expect(useAuthStore.getState().user.isVip).toBe(true)
    expect(screen.getByText('您已是VIP会员')).toBeInTheDocument()
  })
})
