import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CompanionStatePanel from './CompanionStatePanel'
import { companionService } from '../../services/companionService'

vi.mock('../../services/companionService', () => ({ companionService: { get: vi.fn(), recover: vi.fn() } }))
const snapshot = { revision: 7, state: { protection: { mode: 'guarded' }, experienceCount: 7, learning: { brevity: 0.8, samples: 4 } } }
beforeEach(() => { vi.clearAllMocks(); companionService.get.mockResolvedValue(snapshot) })

describe('CompanionStatePanel', () => {
  it('展示已保存的状态，恢复时发送版本且保留学习数据', async () => {
    companionService.recover.mockResolvedValue({ ...snapshot, revision: 8, state: { ...snapshot.state, protection: { mode: 'open' } } })
    render(<CompanionStatePanel />)
    expect(await screen.findByText('偏简洁')).toBeInTheDocument()
    expect(screen.getByText('7 次')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '恢复平稳节奏' }))
    expect(companionService.recover).toHaveBeenCalledWith(7)
    expect(await screen.findByText('自然交流')).toBeInTheDocument()
    expect(screen.getByText('4 次明确反馈或工具结果')).toBeInTheDocument()
  })
  it('并发变化时刷新版本，下一次恢复使用新版本', async () => {
    companionService.recover.mockRejectedValueOnce({ response: { status: 409 } }).mockResolvedValue({ ...snapshot, revision: 10 })
    render(<CompanionStatePanel />)
    await screen.findByText('偏简洁')
    companionService.get.mockResolvedValue({ ...snapshot, revision: 9 })
    await userEvent.click(screen.getByRole('button', { name: '恢复平稳节奏' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('已刷新状态')
    await waitFor(() => expect(screen.getByRole('button')).toBeEnabled())
    await userEvent.click(screen.getByRole('button'))
    expect(companionService.recover).toHaveBeenLastCalledWith(9)
  })
  it('读取失败如实呈现，不能操作捏造的初始状态', async () => {
    companionService.get.mockRejectedValue(new Error('offline'))
    render(<CompanionStatePanel />)
    expect(await screen.findByRole('alert')).toHaveTextContent('暂时无法读取')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
  it('恢复失败保留已有状态并允许重试', async () => {
    companionService.recover.mockRejectedValue(new Error('offline'))
    render(<CompanionStatePanel />)
    await userEvent.click(await screen.findByRole('button'))
    expect(await screen.findByRole('alert')).toHaveTextContent('恢复失败')
    expect(screen.getByText('放慢节奏')).toBeInTheDocument()
    expect(screen.getByRole('button')).toBeEnabled()
  })
})
