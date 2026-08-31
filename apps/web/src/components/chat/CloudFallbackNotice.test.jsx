import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../services/consentService', () => ({
  consentService: { get: vi.fn(), update: vi.fn() },
}))

import { consentService } from '../../services/consentService'
import CloudFallbackNotice, { CLOUD_FALLBACK_DISMISSED_KEY } from './CloudFallbackNotice'

describe('CloudFallbackNotice', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  it('states honestly that chat content goes to an external provider', () => {
    render(<CloudFallbackNotice localState="unavailable" onClose={() => {}} />)

    expect(screen.getByText('本地模型暂时不可用')).toBeInTheDocument()
    expect(screen.getByText(/聊天内容会发送给外部模型供应商/)).toBeInTheDocument()
    expect(screen.getByText(/「我的」页面改主意/)).toBeInTheDocument()
  })

  it('adapts the title when the local model was never configured', () => {
    render(<CloudFallbackNotice localState="not_configured" onClose={() => {}} />)

    expect(screen.getByText('本地模型还没配置')).toBeInTheDocument()
  })

  it('records consent when allowing the cloud fallback and closes', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    consentService.update.mockResolvedValue({ accepted: true })
    render(<CloudFallbackNotice localState="unavailable" onClose={onClose} />)

    await user.click(screen.getByRole('button', { name: '允许云端备用' }))

    expect(consentService.update).toHaveBeenCalledWith(true)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(sessionStorage.getItem(CLOUD_FALLBACK_DISMISSED_KEY)).toBeNull()
  })

  it('records refusal when choosing local-only and closes', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    consentService.update.mockResolvedValue({ accepted: false })
    render(<CloudFallbackNotice localState="unavailable" onClose={onClose} />)

    await user.click(screen.getByRole('button', { name: '只用本地' }))

    expect(consentService.update).toHaveBeenCalledWith(false)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('keeps the card and offers retry when saving consent fails', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    consentService.update.mockRejectedValueOnce(new Error('network down'))
    render(<CloudFallbackNotice localState="unavailable" onClose={onClose} />)

    await user.click(screen.getByRole('button', { name: '允许云端备用' }))

    expect(await screen.findByText('设置没有保存成功，请重试。')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()

    consentService.update.mockResolvedValueOnce({ accepted: true })
    await user.click(screen.getByRole('button', { name: '允许云端备用' }))

    expect(consentService.update).toHaveBeenCalledTimes(2)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('dismisses for the session without touching consent', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<CloudFallbackNotice localState="unavailable" onClose={onClose} />)

    await user.click(screen.getByRole('button', { name: '暂不' }))

    expect(sessionStorage.getItem(CLOUD_FALLBACK_DISMISSED_KEY)).toBe('true')
    expect(consentService.update).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
