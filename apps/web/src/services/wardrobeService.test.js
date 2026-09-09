import { describe, expect, it, vi } from 'vitest'

vi.mock('./api', () => ({
  default: {
    get: vi.fn(),
    postForm: vi.fn(),
    delete: vi.fn(),
  },
}))

import api from './api'
import { wardrobeService } from './wardrobeService'

describe('wardrobeService', () => {
  it('list 拉取衣柜列表', async () => {
    api.get.mockResolvedValue({ data: [{ id: 'i1' }] })

    const result = await wardrobeService.list()

    expect(api.get).toHaveBeenCalledWith('/wardrobe')
    expect(result).toEqual([{ id: 'i1' }])
  })

  it('create 以 multipart 表单 POST（实例默认 JSON Content-Type 会让 multer 解析不到文件）', async () => {
    api.postForm.mockResolvedValue({ data: { id: 'i1', name: '风衣' } })
    const form = new FormData()
    form.append('image', new File(['x'], 'coat.png', { type: 'image/png' }))

    const result = await wardrobeService.create(form)

    expect(api.postForm).toHaveBeenCalledWith('/wardrobe', form)
    expect(result).toEqual({ id: 'i1', name: '风衣' })
  })

  it('remove 删除指定单品', async () => {
    api.delete.mockResolvedValue({ data: { success: true } })

    const result = await wardrobeService.remove('i1')

    expect(api.delete).toHaveBeenCalledWith('/wardrobe/i1')
    expect(result).toEqual({ success: true })
  })
})
