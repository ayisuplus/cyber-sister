import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./api', () => ({
  default: { get: vi.fn() },
}))

import api from './api'
import { modelStatusService } from './modelStatusService'

// 云端切割（2026-09-07）后模型状态只来自 /api/llm/status，无管理端点
describe('modelStatusService', () => {
  beforeEach(() => vi.clearAllMocks())

  it('getStatus reads /llm/status and returns the payload', async () => {
    api.get.mockResolvedValue({
      data: {
        mode: 'external_primary',
        local: { configured: false, state: 'removed' },
        externalFallback: { configured: true, primary: true, consent: null, version: 'cloud-primary-v1' },
      },
    })

    const status = await modelStatusService.getStatus()

    expect(api.get).toHaveBeenCalledWith('/llm/status')
    expect(status).toMatchObject({ mode: 'external_primary' })
  })

  it('exposes no admin config endpoints', () => {
    expect(modelStatusService.getConfig).toBeUndefined()
    expect(modelStatusService.detect).toBeUndefined()
    expect(modelStatusService.test).toBeUndefined()
    expect(modelStatusService.update).toBeUndefined()
  })
})
