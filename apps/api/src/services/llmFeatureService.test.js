import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  isCloudProviderConfigured: vi.fn(() => true),
}))

vi.mock('../prisma/client.js', () => ({
  default: { user: { findUnique: mocks.userFindUnique } },
}))
vi.mock('./llmService.js', () => ({
  isCloudProviderConfigured: mocks.isCloudProviderConfigured,
}))

import { getLlmStatus } from './llmFeatureService.js'

// 云端切割（2026-09-07）：聊天只有一条云端路径，mode 恒为 external_primary，
// local 段固定 { configured:false, state:'removed' }。
describe('云端模型状态', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.userFindUnique.mockResolvedValue({
      externalLlmConsent: null,
      externalLlmConsentVersion: null,
    })
  })

  it('状态只暴露功能状态，不暴露内部 URL 或模型路径', async () => {
    const result = await getLlmStatus('user-1')
    expect(result).toEqual({
      mode: 'external_primary',
      local: { configured: false, state: 'removed' },
      externalFallback: { configured: true, primary: true, consent: null, version: 'cloud-primary-v1' },
    })
    expect(JSON.stringify(result)).not.toContain('baseUrl')
  })

  it('已同意的用户返回 consent=true', async () => {
    mocks.userFindUnique.mockResolvedValue({
      externalLlmConsent: true,
      externalLlmConsentVersion: 'cloud-primary-v1',
    })
    const result = await getLlmStatus('user-1')
    expect(result.externalFallback.consent).toBe(true)
  })

  it('供应商未配置时 externalFallback.configured 为 false', async () => {
    mocks.isCloudProviderConfigured.mockReturnValue(false)
    const result = await getLlmStatus('user-1')
    expect(result.externalFallback.configured).toBe(false)
  })
})
