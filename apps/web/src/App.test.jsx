import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from './stores/authStore'

// 路由测试不访问正在运行的开发 API；装扮和提醒有独立组件测试。
vi.mock('./services/userService', () => ({ userService: { fetchAssetUrl: vi.fn(async () => null) } }))
vi.mock('./services/reminderService', () => ({ reminderService: { listDue: vi.fn(async () => []) } }))
vi.mock('./services/chatService', () => ({ chatService: { getConversations: vi.fn(async () => []) } }))

vi.mock('./pages/LoginPage', () => ({ default: () => <h1>登录页</h1> }))
vi.mock('./pages/ChatPage', () => ({ default: () => <h1>聊天页</h1> }))
vi.mock('./pages/ToolsPage', () => ({ default: () => <h1>发现页</h1> }))
vi.mock('./pages/ProfilePage', () => ({ default: () => <h1>我的页</h1> }))
vi.mock('./pages/MemoriesPage', () => ({ default: () => <h1>记忆页</h1> }))
vi.mock('./pages/MembershipPage', () => ({ default: () => <h1>会员页</h1> }))
vi.mock('./pages/LocalModelPage', () => ({ default: () => <h1>本地模型页</h1> }))
vi.mock('./pages/VirtualMakeupRoomPage', () => ({ default: () => <h1>虚拟化妆间页</h1> }))
vi.mock('./pages/VirtualFittingRoomPage', () => ({ default: () => <h1>虚拟试衣间页</h1> }))
vi.mock('./pages/MakeupRoomPage', () => ({ default: () => <h1>化妆间页</h1> }))
vi.mock('./pages/WardrobePage', () => ({ default: () => <h1>3D 衣柜页</h1> }))
vi.mock('./pages/PeriodPage', () => ({ default: () => <h1>经期记录页</h1> }))
vi.mock('./pages/PlannerPage', () => ({ default: () => <h1>日程与提醒页</h1> }))
vi.mock('./pages/DiaryPage', () => ({ default: () => <h1>日记页</h1> }))
vi.mock('./pages/HandbookPage', () => ({ default: () => <h1>手帐打卡页</h1> }))
vi.mock('./pages/ReadingPage', () => ({ default: () => <h1>阅读页</h1> }))
vi.mock('./pages/StudyPage', () => ({ default: () => <h1>自习页</h1> }))
vi.mock('./pages/SettingsPage', () => ({ default: () => <h1>设置页</h1> }))

import App from './App'

afterEach(() => vi.unstubAllEnvs())

it.each(['/tools', '/tools/diary', '/profile/membership'])('web redirects %s to chat', async (url) => {
  vi.stubEnv('VITE_APP_DISTRIBUTION', 'web')
  window.history.replaceState({}, '', url)
  useAuthStore.setState({ token: 'token', user: { id: 'u1' }, isLoggedIn: true })
  render(<App />)
  expect(await screen.findByRole('heading', { name: '聊天页' })).toBeInTheDocument()
  expect(window.location.pathname).toBe('/chat')
})

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


  it('protects and exposes the membership route', async () => {
    window.history.replaceState({}, '', '/profile/membership')
    useAuthStore.setState({ token: 'token', user: { id: 'u1' }, isLoggedIn: true })
    render(<App />)
    expect(await screen.findByRole('heading', { name: '会员页' })).toBeInTheDocument()
  })

  it('redirects signed-out visitors away from protected routes', async () => {
    window.history.replaceState({}, '', '/settings')
    render(<App />)
    expect(await screen.findByRole('heading', { name: '登录页' })).toBeInTheDocument()
  })
  it.each([
    ['/tools/period', '经期记录页'],
    ['/tools/makeup-room', '化妆间页'],
    ['/tools/wardrobe', '3D 衣柜页'],
    ['/tools/planner', '日程与提醒页'],
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

  it.each([
    ['/tools/todo', '?tab=todo'],
    ['/tools/countdown', '?tab=countdown'],
    ['/tools/reminders', '?tab=reminders'],
  ])('redirects the legacy route %s to the merged planner page', async (path, search) => {
    useAuthStore.setState({ token: 'token', user: { id: 'u1' }, isLoggedIn: true })
    window.history.replaceState({}, '', path)
    render(<App />)
    expect(await screen.findByRole('heading', { name: '日程与提醒页' })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/tools/planner')
    expect(window.location.search).toBe(search)
  })

  it('redirects signed-out visitors away from the toolbox routes', async () => {
    window.history.replaceState({}, '', '/tools/period')
    render(<App />)
    expect(await screen.findByRole('heading', { name: '登录页' })).toBeInTheDocument()
  })
})
