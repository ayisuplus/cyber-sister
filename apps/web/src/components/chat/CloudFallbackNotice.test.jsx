import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../services/consentService', () => ({
  consentService: { get: vi.fn(), update: vi.fn() },
}))

import { consentService } from '../../services/consentService'
import CloudFallbackNotice, { CLOUD_FALLBACK_DISMISSED_KEY } from './CloudFallbackNotice'

// 云端切割（2026-09-07）：这是 100% 用户的首屏同意门，
// 聊天只有一条云端路径，未同意前云端调用次数为零。
describe('CloudFallbackNotice', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  it('states honestly that chat goes to an external provider with redaction', () => {
    render(<CloudFallbackNotice onClose={() => {}} />)

    expect(screen.getByText('这个姐妹住在云端')).toBeInTheDocument()
    expect(screen.getByText(/聊天由经批准的云端模型提供/)).toBeInTheDocument()
    expect(screen.getByText(/手机号、邮箱、证件号会被替换/)).toBeInTheDocument()
    expect(screen.getByText(/不同意暂时无法聊天/)).toBeInTheDocument()
    expect(screen.getByText(/「我的」页面改主意/)).toBeInTheDocument()
  })

  it('records consent when allowing the cloud model and closes', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    consentService.update.mockResolvedValue({ accepted: true })
    render(<CloudFallbackNotice onClose={onClose} />)

    await user.click(screen.getByRole('button', { name: '同意并开始聊天' }))

    expect(consentService.update).toHaveBeenCalledWith(true)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(sessionStorage.getItem(CLOUD_FALLBACK_DISMISSED_KEY)).toBeNull()
  })

  it('records refusal when declining and closes', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    consentService.update.mockResolvedValue({ accepted: false })
    render(<CloudFallbackNotice onClose={onClose} />)

    await user.click(screen.getByRole('button', { name: '暂不同意' }))

    expect(consentService.update).toHaveBeenCalledWith(false)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('keeps the card and offers retry when saving consent fails', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    consentService.update.mockRejectedValueOnce(new Error('network down'))
    render(<CloudFallbackNotice onClose={onClose} />)

    await user.click(screen.getByRole('button', { name: '同意并开始聊天' }))

    expect(await screen.findByText('设置没有保存成功，请重试。')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()

    consentService.update.mockResolvedValueOnce({ accepted: true })
    await user.click(screen.getByRole('button', { name: '同意并开始聊天' }))

    expect(consentService.update).toHaveBeenCalledTimes(2)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('dismisses for the session without touching consent', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<CloudFallbackNotice onClose={onClose} />)

    await user.click(screen.getByRole('button', { name: '暂不' }))

    expect(sessionStorage.getItem(CLOUD_FALLBACK_DISMISSED_KEY)).toBe('true')
    expect(consentService.update).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
