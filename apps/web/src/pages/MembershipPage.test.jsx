import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { useAuthStore } from '../stores/authStore'
import MembershipPage from './MembershipPage'

const renderPage = () => render(<MemoryRouter><MembershipPage /></MemoryRouter>)

describe('MembershipPage', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: { id: 'u1', isVip: false } })
  })

  it('lists free and VIP features side by side with transparent pricing', () => {
    renderPage()

    expect(screen.getByText('成为VIP会员')).toBeInTheDocument()
    expect(screen.getByText('免费版')).toBeInTheDocument()
    expect(screen.getByText('记忆保留7天')).toBeInTheDocument()
    expect(screen.getByText('永久记忆')).toBeInTheDocument()
    expect(screen.getByText(/¥18/)).toBeInTheDocument()
    expect(screen.getByText(/¥128/)).toBeInTheDocument()
    expect(screen.getByText('所有付费明码标价，无情感绑定，无抽卡盲盒')).toBeInTheDocument()
  })

  it('offers no subscribe button or selectable plan while membership is offline', () => {
    renderPage()

    expect(screen.queryByRole('button', { name: /立即开通/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /¥18/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /¥128/ })).not.toBeInTheDocument()
    expect(screen.getByText(/会员体系暂未上线/)).toBeInTheDocument()
  })

  it('shows a VIP badge instead of the offline notice for existing members', () => {
    useAuthStore.setState({ user: { id: 'u1', isVip: true } })

    renderPage()

    expect(screen.getByText('您已是VIP会员')).toBeInTheDocument()
    expect(screen.queryByText(/会员体系暂未上线/)).not.toBeInTheDocument()
  })
})
