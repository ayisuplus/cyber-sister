import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from './stores/authStore'

vi.mock('./pages/LoginPage', () => ({ default: () => <h1>登录页</h1> }))
vi.mock('./pages/ChatPage', () => ({ default: () => <h1>聊天页</h1> }))
vi.mock('./pages/ToolsPage', () => ({ default: () => <h1>发现页</h1> }))
vi.mock('./pages/ProfilePage', () => ({ default: () => <h1>我的页</h1> }))
vi.mock('./pages/MemoriesPage', () => ({ default: () => <h1>记忆页</h1> }))
vi.mock('./pages/MembershipPage', () => ({ default: () => <h1>会员页</h1> }))
vi.mock('./pages/LocalModelPage', () => ({ default: () => <h1>本地模型页</h1> }))
vi.mock('./pages/VirtualMakeupRoomPage', () => ({ default: () => <h1>虚拟化妆间页</h1> }))
vi.mock('./pages/VirtualFittingRoomPage', () => ({ default: () => <h1>虚拟试衣间页</h1> }))
vi.mock('./pages/BeautyCameraPage', () => ({ default: () => <h1>美颜相机页</h1> }))
vi.mock('./pages/PeriodPage', () => ({ default: () => <h1>经期记录页</h1> }))
vi.mock('./pages/CountdownPage', () => ({ default: () => <h1>倒数日页</h1> }))
vi.mock('./pages/TodoPage', () => ({ default: () => <h1>待办页</h1> }))
vi.mock('./pages/DiaryPage', () => ({ default: () => <h1>日记页</h1> }))
vi.mock('./pages/HandbookPage', () => ({ default: () => <h1>手帐打卡页</h1> }))
vi.mock('./pages/ReadingPage', () => ({ default: () => <h1>阅读页</h1> }))
vi.mock('./pages/StudyPage', () => ({ default: () => <h1>自习页</h1> }))
vi.mock('./pages/SettingsPage', () => ({ default: () => <h1>设置页</h1> }))

import App from './App'

describe('root routing', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/')
    useAuthStore.setState({ token: null, user: null, isLoggedIn: false })
  })

  it('routes signed-out visitors to login', async () => {
    render(<App />)
    expect(await screen.findByRole('heading', { name: '登录页' })).toBeInTheDocument()
  })

  it('routes signed-in visitors back to chat', async () => {
    useAuthStore.setState({ token: 'token', user: { id: 'u1' }, isLoggedIn: true })
    render(<App />)
    expect(await screen.findByRole('heading', { name: '聊天页' })).toBeInTheDocument()
  })

  it('protects and exposes the local model settings route', async () => {
    window.history.replaceState({}, '', '/profile/local-model')
    useAuthStore.setState({ token: 'token', user: { id: 'u1' }, isLoggedIn: true })
    render(<App />)
    expect(await screen.findByRole('heading', { name: '本地模型页' })).toBeInTheDocument()
  })

  it('protects and exposes the membership route', async () => {
    window.history.replaceState({}, '', '/profile/membership')
    useAuthStore.setState({ token: 'token', user: { id: 'u1' }, isLoggedIn: true })
    render(<App />)
    expect(await screen.findByRole('heading', { name: '会员页' })).toBeInTheDocument()
  })
  it('protects and exposes the virtual makeup room route', async () => {
    window.history.replaceState({}, '', '/tools/virtual-makeup')
    useAuthStore.setState({ token: 'token', user: { id: 'u1' }, isLoggedIn: true })
    render(<App />)
    expect(await screen.findByRole('heading', { name: '虚拟化妆间页' })).toBeInTheDocument()
  })

  it('protects and exposes the virtual fitting room route', async () => {
    window.history.replaceState({}, '', '/tools/virtual-fitting')
    useAuthStore.setState({ token: 'token', user: { id: 'u1' }, isLoggedIn: true })
    render(<App />)
    expect(await screen.findByRole('heading', { name: '虚拟试衣间页' })).toBeInTheDocument()
  })

  it('redirects signed-out visitors away from the virtual rooms', async () => {
    window.history.replaceState({}, '', '/tools/virtual-makeup')
    render(<App />)
    expect(await screen.findByRole('heading', { name: '登录页' })).toBeInTheDocument()
  })
  it.each([
    ['/tools/period', '经期记录页'],
    ['/tools/beauty-camera', '美颜相机页'],
    ['/tools/countdown', '倒数日页'],
    ['/tools/todo', '待办页'],
    ['/tools/diary', '日记页'],
    ['/tools/handbook', '手帐打卡页'],
    ['/tools/reading', '阅读页'],
    ['/tools/study', '自习页'],
    ['/settings', '设置页'],
  ])('protects and exposes the toolbox route %s', async (path, heading) => {
    useAuthStore.setState({ token: 'token', user: { id: 'u1' }, isLoggedIn: true })
    window.history.replaceState({}, '', path)
    render(<App />)
    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument()
  })

  it('redirects signed-out visitors away from the toolbox routes', async () => {
    window.history.replaceState({}, '', '/tools/period')
    render(<App />)
    expect(await screen.findByRole('heading', { name: '登录页' })).toBeInTheDocument()
  })
})
