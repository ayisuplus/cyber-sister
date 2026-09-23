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
    await userEvent.click(screen.getByRole('switch', { name: '允许云端模型处理聊天与可选来信' }))
    expect(consentService.update).toHaveBeenCalledWith(true)
    expect(await screen.findByText('已配置 · 已允许聊天')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('switch', { name: '允许云端模型处理聊天与可选来信' }))
    expect(consentService.update).toHaveBeenLastCalledWith(false)
    await waitFor(() => expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false'))
  })

  it('carries the full disclosure of what reaches the cloud model, with the consent version', async () => {
    modelStatusService.getStatus.mockResolvedValue({ externalFallback: { configured: true, consent: null, version: 'cloud-primary-v4' } })
    render(<CloudModelSettings />)

    expect(await screen.findByText('同意版本：cloud-primary-v4')).toBeInTheDocument()
    expect(screen.getByText(/脱敏后的消息、较早聊天压成的一段前情摘要、你设置的称呼、你放在心上的事、最多 5 条已确认的相关记忆及其已确认关联/)).toBeInTheDocument()
    expect(screen.getByText(/当前的北京时间与你们上次聊天隔了多久/)).toBeInTheDocument()
    expect(screen.getByText(/她今天在对话里主动对你说过的话/)).toBeInTheDocument()
    expect(screen.getByText(/你的生日平时不发送，只在前后一天/)).toBeInTheDocument()
    expect(screen.getByText(/你最近两天日记里的心情不会原样发送/)).toBeInTheDocument()
    expect(screen.getByText(/你问她衣柜或化妆间里的东西时，她会读取你收藏的名字、分类、想要\/已有和备注，不读照片和链接/)).toBeInTheDocument()
    expect(screen.getByText(/另外打开「聊天时让她顾及你的周期」后，经期里的那几天还会告诉她/)).toBeInTheDocument()
    // 写信前的回想、信里的建议，都得在同意前说清楚
    expect(screen.getByText(/读书时你选中来问她的那一段原文/)).toBeInTheDocument()
    expect(screen.getByText(/来信草稿、相关记忆与近况统计会交给云端模型分析并写信/)).toBeInTheDocument()
    expect(screen.queryByText(/日记与读书的回应/)).not.toBeInTheDocument()
    expect(screen.getByText(/语义检索使用单独配置的向量服务/)).toBeInTheDocument()
    expect(screen.getByText(/她写信时的草稿不会进入聊天/)).toBeInTheDocument()
    expect(screen.getByText(/拒绝或撤回后聊天不可用/)).toBeInTheDocument()
  })

  it('reports missing configuration and refreshes status', async () => {
    modelStatusService.getStatus.mockResolvedValueOnce({ externalFallback: { configured: false, consent: true } })
    render(<CloudModelSettings />)
    expect(await screen.findByText('尚未配置')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '刷新状态' }))
    expect(await screen.findByText('已配置 · 等待你的同意')).toBeInTheDocument()
  })

  it('说清现在用的是哪一家（只有显示名），没有配置的自定义供应商时什么都不说', async () => {
    modelStatusService.getStatus.mockResolvedValueOnce({
      externalFallback: { configured: true, consent: null, providers: [{ name: '甲家', model: 'jia-chat' }, { name: '乙家', model: 'yi-chat' }] },
    })
    const { unmount } = render(<CloudModelSettings />)
    expect(await screen.findByText('当前在用的模型供应商：甲家、乙家。前一家不通时，会自动换下一家。')).toBeInTheDocument()
    expect(screen.queryByText(/api\./)).not.toBeInTheDocument()
    unmount()

    modelStatusService.getStatus.mockResolvedValueOnce({ externalFallback: { configured: true, consent: null, providers: [] } })
    render(<CloudModelSettings />)
    await screen.findByText('已配置 · 等待你的同意')
    expect(screen.queryByText(/当前在用的模型供应商/)).not.toBeInTheDocument()
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
