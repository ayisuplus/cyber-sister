import { describe, expect, it, vi } from 'vitest'

vi.mock('../utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { generateModel, isConfigured } from './imageTo3dService.js'

describe('imageTo3dService', () => {
  it('isConfigured 只看 IMAGE_TO_3D_API_URL 有无', () => {
    expect(isConfigured({})).toBe(false)
    expect(isConfigured({ IMAGE_TO_3D_API_URL: 'https://example.com/3d' })).toBe(true)
  })

  it('未配置时 generateModel 抛 503 且带 IMAGE_TO_3D_NOT_CONFIGURED', async () => {
    await expect(generateModel({ buffer: Buffer.from('x'), mime: 'image/png' }, {}))
      .rejects.toMatchObject({
        statusCode: 503,
        code: 'IMAGE_TO_3D_NOT_CONFIGURED',
        message: '3D 生成服务还没接好，开放后第一时间告诉你',
      })
  })

  it('供应商接入代码尚未填写：配置后当前同样诚实 503', async () => {
    await expect(generateModel(
      { buffer: Buffer.from('x'), mime: 'image/png' },
      { IMAGE_TO_3D_API_URL: 'https://example.com/3d', IMAGE_TO_3D_API_KEY: 'k' },
    )).rejects.toMatchObject({ statusCode: 503, code: 'IMAGE_TO_3D_NOT_CONFIGURED' })
  })
})
