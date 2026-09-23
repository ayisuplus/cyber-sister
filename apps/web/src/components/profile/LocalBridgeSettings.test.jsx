import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../services/bridgeService', () => ({ bridgeService: { list: vi.fn(), createPairing: vi.fn(), revoke: vi.fn() } }))

import { bridgeService } from '../../services/bridgeService'
import LocalBridgeSettings from './LocalBridgeSettings'

describe('LocalBridgeSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    bridgeService.list.mockResolvedValue({ bridges: [] })
  })
  afterEach(() => vi.useRealTimers())

  it('explains what she can and cannot touch, and shows a one-time code with the command to run', async () => {
    const user = userEvent.setup()
    bridgeService.createPairing.mockResolvedValue({ code: 'ABCD2345', expiresAt: new Date(Date.now() + 600_000).toISOString() })
    render(<LocalBridgeSettings />)

    expect(screen.getByText(/不会覆盖、删除，也碰不到文件夹以外的东西/)).toBeInTheDocument()
    expect(screen.getByText(/会和聊天一样交给云端模型处理/)).toBeInTheDocument()
    await user.click(await screen.findByRole('button', { name: '生成连接码' }))

    const code = screen.getByRole('status', { name: '连接码' })
    expect(code).toHaveTextContent('ABCD-2345')
    expect(code).toHaveTextContent(`amie-bridge pair ABCD2345 --server ${window.location.origin}`)
    expect(code).toHaveTextContent('还没有安装包')
  })

  it('notices when the computer connects and stops showing the code', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    bridgeService.createPairing.mockResolvedValue({ code: 'ABCD2345', expiresAt: new Date(Date.now() + 600_000).toISOString() })
    render(<LocalBridgeSettings />)
    await user.click(await screen.findByRole('button', { name: '生成连接码' }))

    bridgeService.list.mockResolvedValue({ bridges: [{ id: 'b1', name: '书房电脑', online: true }] })
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })

    expect(await screen.findByText('书房电脑')).toBeInTheDocument()
    expect(screen.getByText('在线')).toBeInTheDocument()
    expect(screen.queryByRole('status', { name: '连接码' })).not.toBeInTheDocument()
  })

  it('disconnects a computer only after confirmation', async () => {
    const user = userEvent.setup()
    bridgeService.list.mockResolvedValue({ bridges: [{ id: 'b1', name: '书房电脑', online: false, lastSeenAt: '2026-09-19T02:00:00.000Z' }] })
    bridgeService.revoke.mockResolvedValue({ success: true })
    render(<LocalBridgeSettings />)

    expect(await screen.findByText(/上次在线/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '断开' }))
    expect(bridgeService.revoke).not.toHaveBeenCalled()
    bridgeService.list.mockResolvedValue({ bridges: [] })
    const dialogButtons = screen.getAllByRole('button', { name: '断开' })
    await user.click(dialogButtons[dialogButtons.length - 1])
    expect(bridgeService.revoke).toHaveBeenCalledWith('b1')
    await vi.waitFor(() => expect(screen.queryByText('书房电脑')).not.toBeInTheDocument())
  })

  it('shows the server reason when no more computers can be connected', async () => {
    const user = userEvent.setup()
    bridgeService.createPairing.mockRejectedValue({ response: { data: { error: '最多连接 3 台电脑，请先断开一台' } } })
    render(<LocalBridgeSettings />)
    await user.click(await screen.findByRole('button', { name: '生成连接码' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('最多连接 3 台电脑')
  })
})
