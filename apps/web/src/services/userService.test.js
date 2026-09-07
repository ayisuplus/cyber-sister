import { describe, expect, it, vi } from 'vitest'

vi.mock('./api', () => ({
  default: {
    get: vi.fn(),
    putForm: vi.fn(),
    delete: vi.fn(),
  },
}))

import api from './api'
import { userService } from './userService'

describe('userService', () => {
  it('uploadAsset 以 multipart 表单 PUT 到槽位地址', async () => {
    api.putForm.mockResolvedValue({ data: { url: '/api/user/assets/avatar?v=1' } })
    const file = new File(['x'], 'a.png', { type: 'image/png' })

    const result = await userService.uploadAsset('avatar', file)

    expect(api.putForm).toHaveBeenCalledWith('/user/assets/avatar', expect.any(FormData))
    const form = api.putForm.mock.calls[0][1]
    expect(form.get('file')).toBe(file)
    expect(result).toEqual({ url: '/api/user/assets/avatar?v=1' })
  })

  it('fetchAssetUrl 拉取 blob 并创建 object URL；失败回落 null 且不抛出', async () => {
    const blob = new Blob(['x'], { type: 'image/png' })
    api.get.mockResolvedValue({ data: blob })

    const url = await userService.fetchAssetUrl('/user/assets/bg-home')

    expect(api.get).toHaveBeenCalledWith('/user/assets/bg-home', { responseType: 'blob' })
    expect(URL.createObjectURL).toHaveBeenCalledWith(blob)
    expect(url).toBe('blob:mock-preview')

    api.get.mockRejectedValue(new Error('404'))
    await expect(userService.fetchAssetUrl('/user/assets/bg-chat')).resolves.toBeNull()
  })

  it('fetchAssetUrl 剥掉服务端 avatarUrl 自带的 /api 前缀，避免 baseURL 叠加成 /api/api', async () => {
    api.get.mockResolvedValue({ data: new Blob(['x'], { type: 'image/png' }) })

    await userService.fetchAssetUrl('/api/user/assets/avatar?v=1')

    expect(api.get).toHaveBeenCalledWith('/user/assets/avatar?v=1', { responseType: 'blob' })
  })

  it('deleteAsset DELETE 槽位地址并透传失败', async () => {
    api.delete.mockResolvedValue({})
    await userService.deleteAsset('bg-chat')
    expect(api.delete).toHaveBeenCalledWith('/user/assets/bg-chat')

    api.delete.mockRejectedValue(new Error('offline'))
    await expect(userService.deleteAsset('bg-chat')).rejects.toThrow('offline')
  })
})
