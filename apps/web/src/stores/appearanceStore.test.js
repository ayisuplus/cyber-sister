import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../services/userService', () => ({
  userService: {
    uploadAsset: vi.fn(),
    fetchAssetUrl: vi.fn(),
    deleteAsset: vi.fn(),
  },
}))

import { userService } from '../services/userService'
import { useAppearanceStore } from './appearanceStore'

const resetStore = () => useAppearanceStore.setState({ homeBgUrl: null, chatBgUrl: null, loaded: false, assetUrlCache: {} })

describe('appearanceStore', () => {
  beforeEach(resetStore)

  it('loadAppearance 双路探测：404 未设置 → null，已设置 → object URL', async () => {
    userService.fetchAssetUrl.mockImplementation((path) => (
      Promise.resolve(path.startsWith('/user/assets/bg-chat') ? 'blob:chat' : null)
    ))

    await useAppearanceStore.getState().loadAppearance()

    expect(userService.fetchAssetUrl).toHaveBeenCalledWith('/user/assets/bg-home')
    expect(userService.fetchAssetUrl).toHaveBeenCalledWith('/user/assets/bg-chat')
    expect(useAppearanceStore.getState()).toMatchObject({ homeBgUrl: null, chatBgUrl: 'blob:chat', loaded: true })
  })

  it('setBackground 上传成功后以缓存破坏地址重拉，并撤销旧 URL', async () => {
    useAppearanceStore.setState({ homeBgUrl: 'blob:old' })
    userService.uploadAsset.mockResolvedValue({ url: '/api/user/assets/bg-home?v=1' })
    userService.fetchAssetUrl.mockResolvedValue('blob:new')
    const file = new File(['x'], 'a.png', { type: 'image/png' })

    await useAppearanceStore.getState().setBackground('bg-home', file)

    expect(userService.uploadAsset).toHaveBeenCalledWith('bg-home', file)
    expect(userService.fetchAssetUrl).toHaveBeenCalledWith(expect.stringMatching(/^\/user\/assets\/bg-home\?v=\d+$/))
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:old')
    expect(useAppearanceStore.getState().homeBgUrl).toBe('blob:new')
  })

  it('clearBackground 删除后撤销旧 URL 并置空', async () => {
    useAppearanceStore.setState({ chatBgUrl: 'blob:chat-old' })
    userService.deleteAsset.mockResolvedValue(undefined)

    await useAppearanceStore.getState().clearBackground('bg-chat')

    expect(userService.deleteAsset).toHaveBeenCalledWith('bg-chat')
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:chat-old')
    expect(useAppearanceStore.getState().chatBgUrl).toBeNull()
  })

  it('resolveAssetUrl 同路径并发与重复调用只拉取一次；404 清缓存可重试', async () => {
    userService.fetchAssetUrl.mockResolvedValue('blob:one')

    const [a, b] = await Promise.all([
      useAppearanceStore.getState().resolveAssetUrl('/user/assets/avatar?v=1'),
      useAppearanceStore.getState().resolveAssetUrl('/user/assets/avatar?v=1'),
    ])
    expect(a).toBe('blob:one')
    expect(b).toBe('blob:one')
    await useAppearanceStore.getState().resolveAssetUrl('/user/assets/avatar?v=1')
    expect(userService.fetchAssetUrl).toHaveBeenCalledTimes(1)

    userService.fetchAssetUrl.mockResolvedValue(null)
    await expect(useAppearanceStore.getState().resolveAssetUrl('/user/assets/avatar?v=2')).resolves.toBeNull()
    userService.fetchAssetUrl.mockResolvedValue('blob:retry')
    await expect(useAppearanceStore.getState().resolveAssetUrl('/user/assets/avatar?v=2')).resolves.toBe('blob:retry')
  })
})
