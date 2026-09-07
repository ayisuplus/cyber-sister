import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  consentGet: vi.fn(),
  consentUpdate: vi.fn(),
  uploadAsset: vi.fn(),
  deleteAsset: vi.fn(),
  fetchAssetUrl: vi.fn(),
  setBackground: vi.fn(),
  clearBackground: vi.fn(),
  resolveAssetUrl: vi.fn(),
  authState: {
    user: { nickname: '小赛', persona: 'gentle', roleName: '旧角色', roleSetting: '旧设定' },
    updatePersona: vi.fn(),
    updateProfile: vi.fn(),
    updateRolePlay: vi.fn(),
    clearRolePlay: vi.fn(),
    logout: vi.fn(),
  },
  appearanceState: {
    homeBgUrl: null,
    chatBgUrl: null,
    loaded: true,
  },
}))

vi.mock('../services/consentService', () => ({
  consentService: {
    get: mocks.consentGet,
    update: mocks.consentUpdate,
  },
}))


vi.mock('../services/userService', () => ({
  userService: {
    uploadAsset: mocks.uploadAsset,
    deleteAsset: mocks.deleteAsset,
    fetchAssetUrl: mocks.fetchAssetUrl,
  },
}))

vi.mock('../stores/appearanceStore', () => ({
  useAppearanceStore: selector => selector({
    ...mocks.appearanceState,
    setBackground: mocks.setBackground,
    clearBackground: mocks.clearBackground,
    resolveAssetUrl: mocks.resolveAssetUrl,
  }),
}))

vi.mock('../stores/authStore', () => {
  const store = selector => selector(mocks.authState)
  store.getState = () => mocks.authState
  return { useAuthStore: store }
})

import ProfilePage from './ProfilePage'

const renderPage = () => render(<MemoryRouter><ProfilePage /></MemoryRouter>)

describe('ProfilePage 云端模型同意', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveAssetUrl.mockResolvedValue(null)
    mocks.consentGet.mockResolvedValue({
      accepted: null,
      version: 'cloud-primary-v1',
      updatedAt: null,
    })
  })

  it('presents the cloud model as the only chat path with an explicit consent gate', async () => {
    renderPage()

    expect(await screen.findByText(/cloud-primary-v1 · 尚未选择/)).toBeInTheDocument()
    expect(screen.getByText(/聊天由经批准的云端模型提供/)).toBeInTheDocument()
    expect(screen.getByText(/拒绝或撤回后聊天不可用/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '暂不开启' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '允许云端模型' })).toBeEnabled()
  })

  it('records explicit acceptance for the cloud model', async () => {
    const user = userEvent.setup()
    mocks.consentUpdate.mockResolvedValue({ accepted: true, version: 'cloud-primary-v1' })
    renderPage()

    await user.click(await screen.findByRole('button', { name: '允许云端模型' }))

    expect(mocks.consentUpdate).toHaveBeenCalledWith(true)
    expect(screen.getByText('已允许云端模型，聊天会外发给模型供应商')).toBeInTheDocument()
  })

  it('records refusal or withdrawal which makes chat unavailable', async () => {
    const user = userEvent.setup()
    mocks.consentUpdate.mockResolvedValue({ accepted: false, version: 'cloud-primary-v1' })
    renderPage()

    await user.click(await screen.findByRole('button', { name: '暂不开启' }))

    expect(mocks.consentUpdate).toHaveBeenCalledWith(false)
    expect(screen.getByText('已关闭云端模型，聊天将不可用')).toBeInTheDocument()
  })
})

describe('ProfilePage 角色扮演', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveAssetUrl.mockResolvedValue(null)
    mocks.consentGet.mockResolvedValue({
      accepted: null,
      version: 'cloud-primary-v1',
      updatedAt: null,
    })
  })

  it('渲染角色扮演卡并回填现值', async () => {
    renderPage()

    expect(await screen.findByText('角色扮演')).toBeInTheDocument()
    expect(screen.getByLabelText('角色名')).toHaveValue('旧角色')
    expect(screen.getByLabelText('角色设定')).toHaveValue('旧设定')
  })

  it('保存角色调用 updateRolePlay 并提示成功', async () => {
    const user = userEvent.setup()
    mocks.authState.updateRolePlay.mockResolvedValue({ roleName: '同桌的你', roleSetting: '坐我旁边的女生' })
    renderPage()

    const nameInput = await screen.findByLabelText('角色名')
    const settingInput = screen.getByLabelText('角色设定')
    await user.clear(nameInput)
    await user.type(nameInput, '同桌的你')
    await user.clear(settingInput)
    await user.type(settingInput, '坐我旁边的女生')
    await user.click(screen.getByRole('button', { name: '保存角色' }))

    expect(mocks.authState.updateRolePlay).toHaveBeenCalledWith({ name: '同桌的你', setting: '坐我旁边的女生' })
    expect(await screen.findByText('角色已设置，下一条消息立即生效')).toBeInTheDocument()
  })

  it('清除角色调用 clearRolePlay 并清空输入', async () => {
    const user = userEvent.setup()
    mocks.authState.clearRolePlay.mockResolvedValue({ success: true })
    renderPage()

    await user.click(await screen.findByRole('button', { name: '清除角色' }))

    expect(mocks.authState.clearRolePlay).toHaveBeenCalledOnce()
    expect(await screen.findByText('已清除角色设定')).toBeInTheDocument()
    expect(screen.getByLabelText('角色名')).toHaveValue('')
    expect(screen.getByLabelText('角色设定')).toHaveValue('')
  })
})


describe('ProfilePage 装扮区', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.authState.user = { nickname: '小赛', persona: 'gentle' }
    mocks.consentGet.mockResolvedValue({ accepted: null, version: 'cloud-primary-v1', updatedAt: null })
    mocks.resolveAssetUrl.mockResolvedValue(null)
  })

  it('渲染头像 / 主页背景 / 聊天背景三个槽位行，未设置时显示占位', async () => {
    renderPage()

    expect(await screen.findByText('装扮')).toBeInTheDocument()
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
    mocks.uploadAsset.mockResolvedValue({ url: '/api/user/assets/avatar?v=9' })
    renderPage()

    await user.upload(screen.getByLabelText('更换头像'), new File(['x'], 'a.png', { type: 'image/png' }))

    expect(mocks.uploadAsset).toHaveBeenCalledWith('avatar', expect.any(File))
    expect(mocks.authState.updateProfile).toHaveBeenCalledWith({ avatarUrl: '/api/user/assets/avatar?v=9' })
  })

  it('上传聊天背景走 appearanceStore.setBackground', async () => {
    const user = userEvent.setup()
    mocks.setBackground.mockResolvedValue(undefined)
    renderPage()

    await user.upload(screen.getByLabelText('选择聊天背景图片'), new File(['x'], 'bg.png', { type: 'image/png' }))

    expect(mocks.setBackground).toHaveBeenCalledWith('bg-chat', expect.any(File))
    expect(mocks.authState.updateProfile).not.toHaveBeenCalled()
  })
})
