import { afterEach, describe, expect, it, vi } from 'vitest'
import { assertWorkCloudConnected, generateWorkComment, isWorkCloudConnected, WORK_CLOUD_EXECUTION } from './workCloudService.js'

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

describe('work cloud mock contract', () => {
  it('configured credentials cannot activate real execution', async () => {
    vi.stubEnv('GATEWAY_QWEN_BASE_URL', 'https://example.invalid/v1')
    vi.stubEnv('GATEWAY_QWEN_API_KEY', 'test-only')
    vi.stubEnv('GATEWAY_QWEN_MODEL', 'test-model')
    vi.stubEnv('WORK_CLOUD_MODE', 'live')
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    expect(isWorkCloudConnected()).toBe(false)
    expect(() => assertWorkCloudConnected()).toThrow(expect.objectContaining({ code: 'WORK_CLOUD_NOT_CONNECTED', statusCode: 503 }))
    for (const kind of ['diary', 'reading']) {
      const result = await generateWorkComment(kind, { content: 'private input', allowExternal: true })
      expect(result).toMatchObject({ source: 'cloud_mock', execution: { mode: 'mock', cloudConnected: false, persisted: false } })
      expect(result.content).toContain('模拟')
      expect(result.content).not.toContain('private input')
    }
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  // habit、study 随手帐打卡与专注自习下线
  it.each(['__proto__', 'constructor', 'chat', 'unknown', 'habit', 'study'])('rejects non-work operation %s', async (kind) => {
    await expect(generateWorkComment(kind)).rejects.toMatchObject({ statusCode: 400 })
  })

  it('a caller cannot mutate the next response execution contract', async () => {
    const first = await generateWorkComment('diary')
    first.execution.cloudConnected = true
    expect((await generateWorkComment('diary')).execution).toEqual(WORK_CLOUD_EXECUTION)
    expect(Object.isFrozen(WORK_CLOUD_EXECUTION)).toBe(true)
  })
})
