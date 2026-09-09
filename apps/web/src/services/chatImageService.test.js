import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./userService', () => ({ userService: { fetchAssetUrl: vi.fn() } }))

import { userService } from './userService'
import { getChatImageUrl } from './chatImageService'

describe('getChatImageUrl', () => {
  // 模块级会话缓存：各用例用不同 messageId 隔离
  beforeEach(() => {
    userService.fetchAssetUrl.mockReset()
  })

  it('同一 messageId 并发/重复调用只拉一次', async () => {
    userService.fetchAssetUrl.mockResolvedValue('blob:img-1')

    const [a, b] = await Promise.all([getChatImageUrl('m-cache-1'), getChatImageUrl('m-cache-1')])

    expect(a).toBe('blob:img-1')
    expect(b).toBe('blob:img-1')
    expect(userService.fetchAssetUrl).toHaveBeenCalledTimes(1)
    expect(userService.fetchAssetUrl).toHaveBeenCalledWith('/chat/images/m-cache-1')
  })

  it('失败返回 null 并清缓存，下次挂载可重试', async () => {
    userService.fetchAssetUrl.mockResolvedValue(null)

    expect(await getChatImageUrl('m-fail-1')).toBeNull()
    expect(await getChatImageUrl('m-fail-1')).toBeNull()
    expect(userService.fetchAssetUrl).toHaveBeenCalledTimes(2)
  })
})
