import { describe, expect, it } from 'vitest'
import {
  getImageGenStatus,
  requestGeneration,
  IMAGE_GEN_NOT_CONFIGURED,
  IMAGE_GEN_NOT_IMPLEMENTED,
} from './imageGenService.js'

describe('getImageGenStatus', () => {
  it('三件套全缺时 configured=false，reason=IMAGE_GEN_NOT_CONFIGURED', () => {
    expect(getImageGenStatus({})).toEqual({
      available: false,
      configured: false,
      reason: IMAGE_GEN_NOT_CONFIGURED,
    })
  })

  it('任一项缺失都不算 configured', () => {
    const partial = {
      IMAGE_GEN_BASE_URL: 'https://image-gen.internal',
      IMAGE_GEN_MODEL: 'model-x',
      // 缺 IMAGE_GEN_API_KEY_FILE
    }
    expect(getImageGenStatus(partial)).toEqual({
      available: false,
      configured: false,
      reason: IMAGE_GEN_NOT_CONFIGURED,
    })
  })

  it('三件套配齐时 configured=true，reason=IMAGE_GEN_NOT_IMPLEMENTED，available 仍恒 false', () => {
    const env = {
      IMAGE_GEN_BASE_URL: 'https://image-gen.internal',
      IMAGE_GEN_MODEL: 'model-x',
      IMAGE_GEN_API_KEY_FILE: '/run/secrets/image_gen_key',
    }
    expect(getImageGenStatus(env)).toEqual({
      available: false,
      configured: true,
      reason: IMAGE_GEN_NOT_IMPLEMENTED,
    })
  })
})

describe('requestGeneration', () => {
  it('本期恒抛 503 HttpError，带 code=IMAGE_GEN_NOT_CONFIGURED', () => {
    let caught
    try {
      requestGeneration({ scene: 'makeup', itemId: 'lip-01' })
    } catch (error) {
      caught = error
    }
    expect(caught).toBeDefined()
    expect(caught.statusCode).toBe(503)
    expect(caught.code).toBe(IMAGE_GEN_NOT_CONFIGURED)
    expect(caught.message).toBe('生图能力接入中，暂未开放')
  })
})
