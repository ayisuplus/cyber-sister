import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  setBackground: vi.fn(),
  clearBackground: vi.fn(),
  resolveAssetUrl: vi.fn(),
  clearThread: vi.fn(),
  appearance: { homeBgUrl: null, chatBgUrl: null },
}))

vi.mock('../stores/chatStore', () => ({ useChatStore: selector => selector({ clearThread: mocks.clearThread }) }))
vi.mock('../services/bridgeService', () => ({ bridgeService: { list: vi.fn(async () => ({ bridges: [] })), createPairing: vi.fn(), revoke: vi.fn() } }))

vi.mock('../services/modelStatusService', () => ({ modelStatusService: { getStatus: vi.fn().mockResolvedValue({ externalFallback: { configured: true, consent: true } }) } }))

vi.mock('../services/userService', () => ({
  profileService: { get: vi.fn(), update: vi.fn() },
  userService: { uploadAsset: vi.fn(), deleteAsset: vi.fn(), fetchAssetUrl: vi.fn() },
  migrationService: { downloadExport: vi.fn(), previewImport: vi.fn(), applyImport: vi.fn() },
}))

vi.mock('../stores/appearanceStore', () => ({
  useAppearanceStore: selector => selector({
    ...mocks.appearance,
    setBackground: mocks.setBackground,
    clearBackground: mocks.clearBackground,
    resolveAssetUrl: mocks.resolveAssetUrl,
  }),
}))

import { startThemeSync } from '../stores/themeStore'
import { useAuthStore } from '../stores/authStore'
import { migrationService, profileService, userService } from '../services/userService'
import SettingsPage from './SettingsPage'

const renderPage = () => render(
  <MemoryRouter initialEntries={['/settings']}>
    <Routes>
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="/her" element={<h1>她页</h1>} />
      <Route path="/chat/archives" element={<h1>归档页</h1>} />
    </Routes>
  </MemoryRouter>,
)

describe('SettingsPage', () => {
  let stopThemeSync
  beforeEach(() => {
    vi.clearAllMocks()
    stopThemeSync = startThemeSync()
    useAuthStore.setState({ user: { id: 'u1', nickname: '小赛', persona: 'gentle' } })
    mocks.resolveAssetUrl.mockResolvedValue(null)
    profileService.get.mockResolvedValue({ careEnabled: true })
    profileService.update.mockImplementation(async (payload) => payload)
  })

  afterEach(() => {
    stopThemeSync()
    delete document.documentElement.dataset.theme
    document.documentElement.style.removeProperty('color-scheme')
  })

  it('provides persistent day, night and system appearance choices', async () => {
    const user = userEvent.setup()
    renderPage()
    expect(screen.getByRole('group', { name: '外观' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: '跟随系统' })).toBeChecked()

    await user.click(screen.getByRole('radio', { name: '夜间' }))
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(document.documentElement.style.colorScheme).toBe('dark')
    expect(localStorage.getItem('amie-theme')).toBe('dark')
    expect(profileService.update).not.toHaveBeenCalled()

    await user.keyboard('{ArrowLeft}')
    expect(screen.getByRole('radio', { name: '日间' })).toBeChecked()
    expect(document.documentElement.dataset.theme).toBe('light')
    await user.click(screen.getByRole('radio', { name: '跟随系统' }))
    expect(localStorage.getItem('amie-theme')).toBe('system')
  })

  it('keeps a single cloud consent control and no duplicate profile page', async () => {
    renderPage()

    expect(await screen.findAllByRole('switch', { name: '允许云端模型处理聊天与可选来信' })).toHaveLength(1)
    expect(screen.queryByRole('button', { name: '允许云端模型' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '我的资料与装扮' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /退出登录/ })).toHaveLength(1)
  })

  it('shows no fake reminders, role-play, companion panel, dead buttons or fake account deletion', async () => {
    renderPage()
    await waitFor(() => expect(profileService.get).toHaveBeenCalled())

    for (const text of ['喝水提醒', '睡觉提醒', '大姨妈提醒', '角色扮演', '她的状态', '主动关怀消息', '清空所有记忆', '一键清空对话记录', '用户协议', '注销账号']) {
      expect(screen.queryByText(text)).not.toBeInTheDocument()
    }
  })

  it('has no duplicate shortcuts to pages the navigation already opens, and no fake version row', async () => {
    renderPage()
    await waitFor(() => expect(profileService.get).toHaveBeenCalled())
    for (const name of [/记忆管理/]) expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
    expect(screen.queryByText('关于')).not.toBeInTheDocument()
  })

  it('opens the conversations archived before there was only one conversation', async () => {
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: '以前归档的对话' }))
    expect(await screen.findByRole('heading', { name: '归档页' })).toBeInTheDocument()
  })

  it('clears the chat history only after confirmation, and keeps the dialog open on failure', async () => {
    const user = userEvent.setup()
    mocks.clearThread.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce()
    renderPage()

    await user.click(screen.getByRole('button', { name: '清空聊天记录' }))
    expect(mocks.clearThread).not.toHaveBeenCalled()
    expect(screen.getByText(/她记得的你、她的状态和以前归档的对话不受影响/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '确认清空' }))
    expect(await screen.findByText('没清空成功，聊天记录仍在，请重试。')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '确认清空' }))
    expect(await screen.findByText('聊天记录已清空')).toBeInTheDocument()
    expect(mocks.clearThread).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('button', { name: '确认清空' })).not.toBeInTheDocument()
  })

  it('flips 她来想你 off and on through the server (real users.care_enabled)', async () => {
    const user = userEvent.setup()
    renderPage()

    const careToggle = await screen.findByRole('switch', { name: '她来想你总开关' })
    await waitFor(() => expect(careToggle.querySelector('svg')).toHaveClass('text-brand-pink'))

    await user.click(careToggle)
    expect(profileService.update).toHaveBeenCalledWith({ careEnabled: false })
    await waitFor(() => expect(careToggle.querySelector('svg')).toHaveClass('text-text-muted'))

    await user.click(careToggle)
    expect(profileService.update).toHaveBeenCalledWith({ careEnabled: true })
    await waitFor(() => expect(careToggle.querySelector('svg')).toHaveClass('text-brand-pink'))
  })

  it('respects a server-disabled 她来想你 on load', async () => {
    profileService.get.mockResolvedValue({ careEnabled: false })
    renderPage()

    const careToggle = await screen.findByRole('switch', { name: '她来想你总开关' })
    await waitFor(() => expect(careToggle.querySelector('svg')).toHaveClass('text-text-muted'))
  })

  it('shows an error and preserves care settings if saving fails', async () => {
    profileService.update.mockRejectedValueOnce(new Error('offline'))
    renderPage()
    const toggle = screen.getByRole('switch', { name: '她来想你总开关' })
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'))
    await userEvent.click(toggle)
    expect(await screen.findByRole('alert')).toHaveTextContent('关怀设置保存失败')
    expect(toggle).toHaveAttribute('aria-checked', 'true')
    expect(toggle).toBeEnabled()
  })
})

describe('SettingsPage 形象', () => {
  let stopThemeSync
  beforeEach(() => {
    vi.clearAllMocks()
    stopThemeSync = startThemeSync()
    useAuthStore.setState({ user: { id: 'u1', nickname: '小赛', persona: 'gentle' } })
    mocks.resolveAssetUrl.mockResolvedValue(null)
    profileService.get.mockResolvedValue({ careEnabled: true })
  })
  afterEach(() => stopThemeSync())

  it('渲染头像 / 主页背景 / 聊天背景三个槽位行，未设置时显示占位', () => {
    renderPage()

    expect(screen.getByRole('heading', { name: '形象' })).toBeInTheDocument()
    expect(screen.getByText('头像')).toBeInTheDocument()
    expect(screen.getByText('主页背景')).toBeInTheDocument()
    expect(screen.getByText('聊天背景')).toBeInTheDocument()
    expect(screen.getAllByText('未设置')).toHaveLength(2)
    expect(screen.getByLabelText('更换头像')).toBeInTheDocument()
    expect(screen.getByLabelText('选择主页背景图片')).toBeInTheDocument()
    expect(screen.getByLabelText('选择聊天背景图片')).toBeInTheDocument()
  })

  it('上传头像成功后写回 authStore user.avatarUrl', async () => {
    const user = userEvent.setup()
    userService.uploadAsset.mockResolvedValue({ url: '/api/user/assets/avatar?v=9' })
    renderPage()

    await user.upload(screen.getByLabelText('更换头像'), new File(['x'], 'a.png', { type: 'image/png' }))

    expect(userService.uploadAsset).toHaveBeenCalledWith('avatar', expect.any(File))
    await waitFor(() => expect(useAuthStore.getState().user.avatarUrl).toBe('/api/user/assets/avatar?v=9'))
  })

  it('上传聊天背景走 appearanceStore.setBackground', async () => {
    const user = userEvent.setup()
    mocks.setBackground.mockResolvedValue(undefined)
    renderPage()

    await user.upload(screen.getByLabelText('选择聊天背景图片'), new File(['x'], 'bg.png', { type: 'image/png' }))

    expect(mocks.setBackground).toHaveBeenCalledWith('bg-chat', expect.any(File))
    expect(userService.uploadAsset).not.toHaveBeenCalled()
  })
})

describe('SettingsPage 数据与迁移', () => {
  let stopThemeSync
  beforeEach(() => {
    vi.clearAllMocks()
    stopThemeSync = startThemeSync()
    mocks.resolveAssetUrl.mockResolvedValue(null)
    profileService.get.mockResolvedValue({ careEnabled: true })
  })
  afterEach(() => stopThemeSync())

  it('渲染数据导出区并承诺永久免费', () => {
    renderPage()

    expect(screen.getByRole('heading', { name: '数据与迁移' })).toBeInTheDocument()
    expect(screen.getByText(/永久免费，不设会员门槛/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '导出我的全部数据（JSON）' })).toBeEnabled()
  })

  it('点击导出触发下载并提示文件名', async () => {
    const user = userEvent.setup()
    migrationService.downloadExport.mockResolvedValue('cyber-sister-export-2026-09-07.json')
    renderPage()

    await user.click(screen.getByRole('button', { name: '导出我的全部数据（JSON）' }))

    expect(migrationService.downloadExport).toHaveBeenCalledTimes(1)
    expect(await screen.findByText(/已发起下载 cyber-sister-export-2026-09-07\.json/)).toBeInTheDocument()
  })

  it('导出失败时提示重试', async () => {
    const user = userEvent.setup()
    migrationService.downloadExport.mockRejectedValue(new Error('network down'))
    renderPage()

    await user.click(screen.getByRole('button', { name: '导出我的全部数据（JSON）' }))

    expect(await screen.findByText('导出失败，请重试')).toBeInTheDocument()
  })
})
