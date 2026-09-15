import { afterEach, describe, expect, it, vi } from 'vitest'
import { MAX_IMAGE_BYTES, previewMakeup, previewWardrobe } from './workMediaService.js'

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nD8AAAAASUVORK5CYII=', 'base64')
const image = { buffer: PNG, mime: 'image/png' }
const params = { smooth: 25, whiten: 20, slim: 10, eye: 10 }

afterEach(() => vi.unstubAllGlobals())

describe('work media fixed mock boundary', () => {
  it('returns explicit mock metadata, copies parameters and never calls a provider', () => {
    const fetch = vi.fn(() => { throw new Error('network must remain off') })
    vi.stubGlobal('fetch', fetch)
    const response = previewMakeup({ ...image, params })
    expect(response).toMatchObject({ source: 'cloud_mock', execution: { mode: 'mock', cloudConnected: false, persisted: false }, result: { kind: 'image', imageUrl: null, params } })
    expect(response.requestId).toMatch(/^[a-f0-9-]{36}$/)
    expect(response.result.message).toContain('未生成或保存')
    expect(response.result.params).not.toBe(params)
    expect(previewMakeup({ ...image, params }).requestId).not.toBe(response.requestId)
    expect(fetch).not.toHaveBeenCalled()
    expect(JSON.stringify(response)).not.toContain(PNG.toString('base64'))
  })

  it('returns no GLB, item id, image data or persisted wardrobe artifact', () => {
    const response = previewWardrobe({ ...image, name: ' 风衣 ' })
    expect(response.result).toEqual({ kind: 'model', modelUrl: null, name: '风衣', message: expect.stringContaining('未添加到衣柜') })
    expect(response.execution.persisted).toBe(false)
    expect(response).not.toHaveProperty('id')
    expect(previewWardrobe(image).result.name).toBe('未命名单品')
  })

  it.each([undefined, null, [], {}, { ...params, eye: '10' }, { ...params, eye: 1.5 }, { ...params, eye: -1 }, { ...params, eye: 101 }, { ...params, userId: 'other' }])('rejects invalid makeup parameters %j', value => {
    expect(() => previewMakeup({ ...image, params: value })).toThrow(expect.objectContaining({ statusCode: 400 }))
  })

  it.each([
    { buffer: Buffer.from('<svg/>'), mime: 'image/png' },
    { buffer: PNG, mime: 'image/jpeg' },
    { buffer: Buffer.from([137, 80, 78, 71]), mime: 'image/png' },
    { buffer: Buffer.from(''), mime: 'image/png' },
    { buffer: 'https://example.com/photo.png', mime: 'image/png' },
  ])('rejects forged, truncated or remote input %#', bad => {
    expect(() => previewWardrobe(bad)).toThrow(expect.objectContaining({ statusCode: 400 }))
  })

  it('rejects oversized image and invalid wardrobe names', () => {
    expect(() => previewWardrobe({ ...image, buffer: Buffer.alloc(MAX_IMAGE_BYTES + 1) })).toThrow(expect.objectContaining({ statusCode: 413 }))
    for (const name of ['x'.repeat(31), [], 1]) expect(() => previewWardrobe({ ...image, name })).toThrow(expect.objectContaining({ statusCode: 400 }))
  })

  it.each([
    { buffer: Buffer.from([255, 216, 255, 224]), mime: 'image/jpeg' },
    { buffer: Buffer.from('RIFF0000WEBPVP8 '), mime: 'image/webp' },
  ])('accepts the supported signatures: $mime', supported => {
    expect(previewWardrobe(supported).source).toBe('cloud_mock')
  })
})
