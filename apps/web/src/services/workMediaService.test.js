import { beforeEach, describe, expect, it, vi } from 'vitest'
const postForm = vi.hoisted(() => vi.fn())
vi.mock('./api', () => ({ default: { postForm } }))
import { workMediaService } from './workMediaService'

beforeEach(() => { vi.clearAllMocks(); postForm.mockResolvedValue({ data: { source: 'cloud_mock' } }) })
describe('media domain transport', () => {
  it('submits the original file and typed makeup params as multipart with cancellation', async () => {
    const file = new File(['original'], 'photo.png', { type: 'image/png' })
    const params = { smooth: 1, whiten: 2, slim: 3, eye: 4 }
    const signal = new AbortController().signal
    expect(await workMediaService.previewMakeup(file, params, { signal })).toEqual({ source: 'cloud_mock' })
    const [path, data, config] = postForm.mock.calls[0]
    expect(path).toBe('/work/media/makeup/preview')
    expect(data.get('image')).toBe(file)
    expect(JSON.parse(data.get('params'))).toEqual(params)
    expect(config.signal).toBe(signal)
  })
  it('uses the wardrobe preview route rather than persistent item creation', async () => {
    const file = new File(['original'], 'coat.png', { type: 'image/png' })
    await workMediaService.previewWardrobe(file, ' 风衣 ')
    const [path, data] = postForm.mock.calls[0]
    expect(path).toBe('/work/media/wardrobe/preview')
    expect(data.get('image')).toBe(file)
    expect(data.get('name')).toBe('风衣')
  })
  it('propagates backend validation errors for retry in the page', async () => {
    const error = new Error('invalid image')
    postForm.mockRejectedValue(error)
    await expect(workMediaService.previewWardrobe(new File(['bad'], 'bad.png'), '')).rejects.toBe(error)
  })
})
