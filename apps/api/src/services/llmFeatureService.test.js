import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  getStoredLocalConfig: vi.fn(),
  checkLocalLlmState: vi.fn(),
  isExternalChatPrimary: vi.fn(() => false),
}))

vi.mock('../prisma/client.js', () => ({
  default: { user: { findUnique: mocks.userFindUnique } },
}))
vi.mock('./localLlmConfigService.js', () => ({
  getStoredLocalConfig: mocks.getStoredLocalConfig,
  checkLocalLlmState: mocks.checkLocalLlmState,
  isQwenConfigured: () => true,
}))
vi.mock('./llmService.js', () => ({
  isExternalChatPrimary: mocks.isExternalChatPrimary,
}))

import { getLlmStatus } from './llmFeatureService.js'

describe('本地优先模型状态', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.userFindUnique.mockResolvedValue({
      externalLlmConsent: null,
      externalLlmConsentVersion: null,
    })
    mocks.getStoredLocalConfig.mockResolvedValue({ enabled: true })
    mocks.checkLocalLlmState.mockResolvedValue('ready')
  })

  it('状态只暴露功能状态，不暴露内部 URL 或模型路径', async () => {
    const result = await getLlmStatus('user-1')
    expect(result).toEqual({
      mode: 'local_first',
      local: { configured: true, state: 'ready' },
      externalFallback: { configured: true, primary: false, consent: null, version: 'qwen-fallback-v1' },
    })
    expect(JSON.stringify(result)).not.toContain('baseUrl')
  })

  it('外部主用部署时状态标记 external_primary', async () => {
    mocks.isExternalChatPrimary.mockReturnValue(true)
    mocks.getStoredLocalConfig.mockResolvedValue(null)
    mocks.checkLocalLlmState.mockResolvedValue('not_configured')

    const result = await getLlmStatus('user-1')

    expect(result).toEqual({
      mode: 'external_primary',
      local: { configured: false, state: 'not_configured' },
      externalFallback: { configured: true, primary: true, consent: null, version: 'qwen-fallback-v1' },
    })
  })
})
