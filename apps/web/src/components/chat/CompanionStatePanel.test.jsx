import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CompanionStatePanel from './CompanionStatePanel'
import { companionService } from '../../services/companionService'

vi.mock('../../services/companionService', () => ({ companionService: { get: vi.fn(), recover: vi.fn() } }))
const snapshot = { revision: 7, state: { protection: { mode: 'guarded' }, experienceCount: 7, trust: 0.9, learning: { brevity: 0.8, samples: 4 } } }
beforeEach(() => { vi.clearAllMocks(); companionService.get.mockResolvedValue(snapshot) })

describe('CompanionStatePanel', () => {
  it('平常时只有一句话：没有按钮、没有计数，也不显示信任', async () => {
    companionService.get.mockResolvedValue({ revision: 1, state: { protection: { mode: 'open' }, experienceCount: 120, trust: 0.9, learning: { brevity: 0.5, samples: 0 } } })
    render(<CompanionStatePanel />)
    expect(await screen.findByText('她现在是平常的节奏。')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByText(/120|已纳入的经历|学习依据|熟悉|信任/)).not.toBeInTheDocument()
  })
  it('不平常时说清楚、给出恢复；恢复时发送版本，学到的长短偏好仍在', async () => {
    companionService.recover.mockResolvedValue({ ...snapshot, revision: 8, state: { ...snapshot.state, protection: { mode: 'open' } } })
    render(<CompanionStatePanel />)
    expect(await screen.findByText('这会儿她放慢了节奏。')).toBeInTheDocument()
    expect(screen.getByText('你说过喜欢简短一些，她记着。')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '恢复平稳节奏' }))
    expect(companionService.recover).toHaveBeenCalledWith(7)
    expect(await screen.findByText('她现在是平常的节奏。')).toBeInTheDocument()
    expect(screen.getByText('你说过喜欢简短一些，她记着。')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
  it('学到想听详细的也说一句；没有明确反馈过就不说', async () => {
    companionService.get.mockResolvedValue({ revision: 1, state: { protection: { mode: 'open' }, learning: { brevity: 0.3, samples: 3 } } })
    const { unmount } = render(<CompanionStatePanel />)
    expect(await screen.findByText('你说过想听详细一些，她记着。')).toBeInTheDocument()
    unmount()
    companionService.get.mockResolvedValue({ revision: 1, state: { protection: { mode: 'open' }, learning: { brevity: 0.8, samples: 0 } } })
    render(<CompanionStatePanel />)
    await screen.findByText('她现在是平常的节奏。')
    expect(screen.queryByText(/她记着/)).not.toBeInTheDocument()
  })
  it('并发变化时刷新版本，下一次恢复使用新版本', async () => {
    companionService.recover.mockRejectedValueOnce({ response: { status: 409 } }).mockResolvedValue({ ...snapshot, revision: 10 })
    render(<CompanionStatePanel />)
    await screen.findByText('这会儿她放慢了节奏。')
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
    expect(screen.getByText('这会儿她放慢了节奏。')).toBeInTheDocument()
    expect(screen.getByRole('button')).toBeEnabled()
  })
})
