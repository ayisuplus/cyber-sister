import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../services/authService', () => ({
  authService: {
    login: vi.fn(),
    logout: vi.fn(),
    refresh: vi.fn(),
    updatePersona: vi.fn(),
  },
}))

import { authService } from '../services/authService'
import { useAuthStore } from '../stores/authStore'
import LoginPage from './LoginPage'

const renderLogin = () => render(
  <MemoryRouter initialEntries={['/login']}>
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/chat" element={<h1>聊天已就绪</h1>} />
    </Routes>
  </MemoryRouter>
)

describe('LoginPage', () => {
  beforeEach(() => useAuthStore.setState({ token: null, user: null, isLoggedIn: false }))

  it('waits for the real login response before navigating', async () => {
    const user = userEvent.setup()
    let resolveLogin
    authService.login.mockReturnValue(new Promise(resolve => { resolveLogin = resolve }))
    renderLogin()

    await user.type(screen.getByRole('textbox', { name: '手机号' }), '13800138000')
    await user.type(screen.getByRole('textbox', { name: '内测验证码' }), '123456')
    await user.click(screen.getByRole('button', { name: '开始聊天' }))
    expect(screen.getByText('登录中...')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '聊天已就绪' })).not.toBeInTheDocument()

    resolveLogin({ token: 'token', user: { id: 'u1', persona: 'gentle' } })
    expect(await screen.findByRole('heading', { name: '聊天已就绪' })).toBeInTheDocument()
  })

  it('shows the same generic error for a rejected credential pair', async () => {
    const user = userEvent.setup()
    authService.login.mockRejectedValue({ response: { status: 401 } })
    renderLogin()

    await user.type(screen.getByRole('textbox', { name: '手机号' }), '13800138000')
    await user.type(screen.getByRole('textbox', { name: '内测验证码' }), '000000')
    await user.click(screen.getByRole('button', { name: '开始聊天' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('手机号或验证码错误')
  })
})

describe('LoginPage 防呆', () => {
  beforeEach(() => useAuthStore.setState({ token: null, user: null, isLoggedIn: false }))

  it('输入与粘贴只保留数字', async () => {
    const user = userEvent.setup()
    renderLogin()
    const phoneInput = screen.getByRole('textbox', { name: '手机号' })
    const codeInput = screen.getByRole('textbox', { name: '内测验证码' })
    await user.type(phoneInput, 'abc138')
    expect(phoneInput).toHaveValue('138')
    await user.clear(phoneInput)
    await user.click(phoneInput)
    await user.paste('138 0013-8000')
    expect(phoneInput).toHaveValue('13800138000')
    await user.type(codeInput, 'a8b8c8')
    expect(codeInput).toHaveValue('888')
  })

  it('本地格式不合法时不发请求并给出具体提示', async () => {
    const user = userEvent.setup()
    renderLogin()
    await user.type(screen.getByRole('textbox', { name: '手机号' }), '12345')
    await user.type(screen.getByRole('textbox', { name: '内测验证码' }), '888888')
    await user.click(screen.getByRole('button', { name: '开始聊天' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('手机号是 11 位数字')
    expect(authService.login).not.toHaveBeenCalled()
  })

  it('验证码不足 6 位时不发请求', async () => {
    const user = userEvent.setup()
    renderLogin()
    await user.type(screen.getByRole('textbox', { name: '手机号' }), '13800138000')
    await user.type(screen.getByRole('textbox', { name: '内测验证码' }), '888')
    await user.click(screen.getByRole('button', { name: '开始聊天' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('验证码是 6 位数字')
    expect(authService.login).not.toHaveBeenCalled()
  })

  it('429 锁定时提示冷却时间而不是模糊的稍后重试', async () => {
    const user = userEvent.setup()
    authService.login.mockRejectedValue({ response: { status: 429 } })
    renderLogin()
    await user.type(screen.getByRole('textbox', { name: '手机号' }), '13800138000')
    await user.type(screen.getByRole('textbox', { name: '内测验证码' }), '888888')
    await user.click(screen.getByRole('button', { name: '开始聊天' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('30 分钟')
  })

  it('服务器不可达时提示检查本地服务', async () => {
    const user = userEvent.setup()
    authService.login.mockRejectedValue(new Error('Network Error'))
    renderLogin()
    await user.type(screen.getByRole('textbox', { name: '手机号' }), '13800138000')
    await user.type(screen.getByRole('textbox', { name: '内测验证码' }), '888888')
    await user.click(screen.getByRole('button', { name: '开始聊天' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('连不上本地服务器')
  })

  it('401 后清空验证码并把焦点交给验证码输入框', async () => {
    const user = userEvent.setup()
    authService.login.mockRejectedValue({ response: { status: 401 } })
    renderLogin()
    await user.type(screen.getByRole('textbox', { name: '手机号' }), '13800138000')
    await user.type(screen.getByRole('textbox', { name: '内测验证码' }), '000000')
    await user.click(screen.getByRole('button', { name: '开始聊天' }))
    await screen.findByRole('alert')
    const codeInput = screen.getByRole('textbox', { name: '内测验证码' })
    expect(codeInput).toHaveValue('')
    expect(codeInput).toHaveFocus()
  })
})
