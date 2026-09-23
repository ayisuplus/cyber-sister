import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from './stores/authStore'

// 路由测试不访问正在运行的开发 API；各页面有独立组件测试。
vi.mock('./services/userService', () => ({ userService: { fetchAssetUrl: vi.fn(async () => null) } }))
vi.mock('./services/reminderService', () => ({ reminderService: { listDue: vi.fn(async () => []) } }))
vi.mock('./services/chatService', () => ({ chatService: { getConversations: vi.fn(async () => []) } }))

vi.mock('./pages/LoginPage', () => ({ default: () => <h1>登录页</h1> }))
vi.mock('./pages/ChatPage', () => ({ default: () => <h1>聊天页</h1> }))
vi.mock('./pages/HerPage', () => ({ default: () => <h1>她页</h1> }))
vi.mock('./pages/NotesPage', () => ({ default: () => <h1>手记页</h1> }))
vi.mock('./pages/ReadingPage', () => ({ default: () => <h1>书架页</h1> }))
vi.mock('./pages/ReaderPage', () => ({ default: () => <h1>阅读页</h1> }))
vi.mock('./pages/StylePage', () => ({ default: () => <h1>装扮页</h1> }))
vi.mock('./pages/CalendarPage', () => ({ default: () => <h1>日历页</h1> }))
vi.mock('./pages/SettingsPage', () => ({ default: () => <h1>设置页</h1> }))

import App from './App'

const signIn = () => useAuthStore.setState({ token: 'token', user: { id: 'u1' }, isLoggedIn: true })

afterEach(() => vi.unstubAllEnvs())

it.each([
  ['/tools/calendar', '日历页'],
  ['/tools/notes', '手记页'],
  ['/tools/reading', '书架页'],
  ['/tools/reading/b1', '阅读页'],
  ['/tools/style', '装扮页'],
  ['/her', '她页'],
])('the one Web version opens %s', async (url, heading) => {
  vi.stubEnv('VITE_APP_DISTRIBUTION', 'web')
  window.history.replaceState({}, '', url)
  signIn()
  render(<App />)
  expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument()
  expect(window.location.pathname).toBe(url)
})

it('sends the retired membership link back to chat', async () => {
  window.history.replaceState({}, '', '/profile/membership')
  signIn()
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
    signIn()
    render(<App />)
    expect(await screen.findByRole('heading', { name: '聊天页' })).toBeInTheDocument()
  })

  it('redirects signed-out visitors away from protected routes', async () => {
    window.history.replaceState({}, '', '/settings')
    render(<App />)
    expect(await screen.findByRole('heading', { name: '登录页' })).toBeInTheDocument()
  })

  it.each([
    ['/her', '她页'],
    ['/tools/calendar', '日历页'],
    ['/tools/notes', '手记页'],
    ['/tools/reading', '书架页'],
    ['/tools/style', '装扮页'],
    ['/settings', '设置页'],
  ])('protects and exposes the entry route %s', async (path, heading) => {
    signIn()
    window.history.replaceState({}, '', path)
    render(<App />)
    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument()
  })

  it.each([
    ['/tools/planner?tab=reminders', '/tools/calendar', '', '日历页'],
    ['/tools/todo', '/tools/calendar', '', '日历页'],
    ['/tools/countdown', '/tools/calendar', '', '日历页'],
    ['/tools/reminders', '/tools/calendar', '', '日历页'],
    ['/tools/handbook', '/tools/calendar', '', '日历页'],
    ['/tools/study', '/tools/calendar', '', '日历页'],
    ['/tools/schedule', '/tools/calendar', '', '日历页'],
    ['/tools/period', '/tools/calendar', '', '日历页'],
    ['/tools/diary', '/tools/notes', '', '手记页'],
    ['/tools/letters', '/her', '', '她页'],
    ['/tools/makeup-room', '/tools/style', '?tab=makeup', '装扮页'],
    ['/tools/wardrobe', '/tools/style', '?tab=wardrobe', '装扮页'],
    ['/tools/workspace', '/her', '', '她页'],
    ['/memories?tab=relations', '/her', '?tab=relations', '她页'],
    ['/profile/memories', '/her', '', '她页'],
    ['/profile', '/settings', '', '设置页'],
    ['/tools', '/chat', '', '聊天页'],
  ])('moves the legacy route %s to its new entry', async (path, pathname, search, heading) => {
    signIn()
    window.history.replaceState({}, '', path)
    render(<App />)
    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument()
    expect(window.location.pathname).toBe(pathname)
    expect(window.location.search).toBe(search)
  })

  it('redirects signed-out visitors away from the life entry routes', async () => {
    window.history.replaceState({}, '', '/tools/calendar')
    render(<App />)
    expect(await screen.findByRole('heading', { name: '登录页' })).toBeInTheDocument()
  })
})
