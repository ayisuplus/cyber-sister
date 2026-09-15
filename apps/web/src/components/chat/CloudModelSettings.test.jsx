import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../services/modelStatusService', () => ({ modelStatusService: { getStatus: vi.fn() } }))
vi.mock('../../services/consentService', () => ({ consentService: { update: vi.fn() } }))
import { modelStatusService } from '../../services/modelStatusService'
import { consentService } from '../../services/consentService'
import CloudModelSettings from './CloudModelSettings'

describe('CloudModelSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    modelStatusService.getStatus.mockResolvedValue({ externalFallback: { configured: true, consent: null } })
    consentService.update.mockImplementation(async accepted => ({ accepted }))
  })

  it('distinguishes configuration from connection and never enables consent automatically', async () => {
    render(<CloudModelSettings />)
    expect(await screen.findByText('已配置 · 等待你的同意')).toBeInTheDocument()
    expect(screen.getByText('服务器已加载模型配置。实际可用性以聊天响应为准。')).toBeInTheDocument()
    expect(consentService.update).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('switch', { name: '允许云端模型处理聊天' }))
    expect(consentService.update).toHaveBeenCalledWith(true)
    expect(await screen.findByText('已配置 · 已允许聊天')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('switch', { name: '允许云端模型处理聊天' }))
    expect(consentService.update).toHaveBeenLastCalledWith(false)
    await waitFor(() => expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false'))
  })

  it('carries the full disclosure of what reaches the cloud model, with the consent version', async () => {
    modelStatusService.getStatus.mockResolvedValue({ externalFallback: { configured: true, consent: null, version: 'cloud-primary-v3' } })
    render(<CloudModelSettings />)

    expect(await screen.findByText('同意版本：cloud-primary-v3')).toBeInTheDocument()
    expect(screen.getByText(/脱敏后的消息、最多 5 条已确认的相关记忆及其已确认关联/)).toBeInTheDocument()
    expect(screen.getByText(/语义检索使用单独配置的向量服务/)).toBeInTheDocument()
    expect(screen.getByText(/待确认草稿不会进入聊天/)).toBeInTheDocument()
    expect(screen.getByText(/拒绝或撤回后聊天不可用/)).toBeInTheDocument()
  })

  it('reports missing configuration and refreshes status', async () => {
    modelStatusService.getStatus.mockResolvedValueOnce({ externalFallback: { configured: false, consent: true } })
    render(<CloudModelSettings />)
    expect(await screen.findByText('尚未配置')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '刷新状态' }))
    expect(await screen.findByText('已配置 · 等待你的同意')).toBeInTheDocument()
  })

  it('retains the original consent after a save failure and permits retry', async () => {
    consentService.update.mockRejectedValueOnce(new Error('offline'))
    render(<CloudModelSettings />)
    await screen.findByText('已配置 · 等待你的同意')
    await userEvent.click(screen.getByRole('switch'))
    expect(await screen.findByRole('alert')).toHaveTextContent('原来的选择已保留')
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false')
    await userEvent.click(screen.getByRole('switch'))
    await waitFor(() => expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true'))
  })
})
