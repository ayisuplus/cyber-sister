import { afterEach, describe, expect, it, vi } from 'vitest'
import { assertWorkCloudConnected, isWorkCloudConnected, WORK_CLOUD_EXECUTION } from './workCloudService.js'

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

describe('work cloud mock contract', () => {
  it('configured credentials cannot activate real execution', () => {
    vi.stubEnv('GATEWAY_QWEN_BASE_URL', 'https://example.invalid/v1')
    vi.stubEnv('GATEWAY_QWEN_API_KEY', 'test-only')
    vi.stubEnv('GATEWAY_QWEN_MODEL', 'test-model')
    vi.stubEnv('WORK_CLOUD_MODE', 'live')
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    expect(isWorkCloudConnected()).toBe(false)
    expect(() => assertWorkCloudConnected()).toThrow(expect.objectContaining({ code: 'WORK_CLOUD_NOT_CONNECTED', statusCode: 503 }))
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('the execution contract is frozen', () => {
    expect(Object.isFrozen(WORK_CLOUD_EXECUTION)).toBe(true)
  })
})
