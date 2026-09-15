import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getActive: vi.fn(), start: vi.fn(), finish: vi.fn(), cancel: vi.fn(),
  getSummary: vi.fn(),
  listSessions: vi.fn(),
  recordSession: vi.fn(),
  requestSessionComment: vi.fn(),
}))

vi.mock('../services/studyService', () => ({
  studyService: {
    getActive: mocks.getActive, start: mocks.start, finish: mocks.finish, cancel: mocks.cancel,
    getSummary: mocks.getSummary,
    listSessions: mocks.listSessions,
    recordSession: mocks.recordSession,
    requestSessionComment: mocks.requestSessionComment,
  },
}))

// 短评来源徽标依赖聊天全局状态，本页测试不关心其展示
vi.mock('../components/ui/SourceBadge', () => ({ default: () => null }))

import StudyPage from './StudyPage'

const renderPage = () => render(<MemoryRouter><StudyPage /></MemoryRouter>)

const flush = async () => { await act(async () => {}) }

describe('StudyPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ shouldAdvanceTime: true })
    mocks.getSummary.mockResolvedValue({ todayMinutes: 30, weekMinutes: 50, streak: 2, totalSessions: 3 })
    mocks.listSessions.mockResolvedValue([])
    mocks.getActive.mockResolvedValue(null)
    let current
    mocks.start.mockImplementation(async data => {
      current = { ...data, id: 'run-1', status: 'running', startedAt: new Date().toISOString(), serverNow: new Date().toISOString() }
      return current
    })
    mocks.finish.mockImplementation(async () => ({ ...current, status: 'finished', actualMinutes: 1, serverNow: new Date().toISOString() }))
    mocks.cancel.mockResolvedValue({ cancelled: true })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders the summary bar', async () => {
    renderPage()
    await flush()

    expect(screen.getByText(/今天 30 分钟 · 本周 50 分钟 · 连续 2 天/)).toBeInTheDocument()
  })

  it('counts down from 25:00 to 24:59 after one second', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderPage()
    await flush()

    await user.click(screen.getByRole('button', { name: '开始自习' }))
    expect(screen.getByText('25:00')).toBeInTheDocument()

    act(() => { vi.advanceTimersByTime(1000) })
    expect(screen.getByText('24:59')).toBeInTheDocument()
  })

  it('records a server-finished run without trusting client timing and offers the next round', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    mocks.recordSession.mockResolvedValue({ id: 's1', actualMinutes: 1, aiComment: null })
    renderPage()
    await flush()

    await user.click(screen.getByRole('button', { name: '开始自习' }))
    act(() => { vi.advanceTimersByTime(1000) })
    await user.click(screen.getByRole('button', { name: '提前完成' }))
    await user.type(screen.getByLabelText('一句话收获'), '背完一章')
    await user.click(screen.getByRole('button', { name: '记下这次' }))
    await flush()

    expect(mocks.finish).toHaveBeenCalledWith('run-1')
    expect(mocks.recordSession).toHaveBeenCalledWith({
      runId: 'run-1',
      note: '背完一章',
    })
    expect(mocks.getSummary).toHaveBeenCalledTimes(2)
    await user.click(screen.getByRole('button', { name: '再来一轮' }))
    expect(screen.getByRole('button', { name: '开始自习' })).toBeEnabled()
  })

  it('resumes a running session after a page reload using the server clock', async () => {
    mocks.getActive.mockResolvedValue({ id: 'resumed', status: 'running', plannedMinutes: 25, subject: '阅读', startedAt: new Date(Date.now() - 60000).toISOString(), serverNow: new Date().toISOString() })
    renderPage()
    await flush()
    expect(screen.getByText('24:00')).toBeInTheDocument()
    expect(mocks.start).not.toHaveBeenCalled()
  })

  it('shows recovery errors instead of starting a competing session', async () => {
    mocks.getActive.mockRejectedValue(new Error('offline'))
    renderPage()
    await flush()
    expect(screen.getByRole('alert')).toHaveTextContent('计时状态加载失败')
    expect(screen.getByRole('button', { name: '开始自习' })).toBeDisabled()
  })

  it('does not repeatedly call finish when the expired timer receives a server error', async () => {
    mocks.getActive.mockResolvedValue({ id: 'expired', status: 'running', plannedMinutes: 1, startedAt: new Date(Date.now() - 120000).toISOString(), serverNow: new Date().toISOString() })
    mocks.finish.mockRejectedValue(new Error('offline'))
    renderPage()
    await flush()
    expect(mocks.finish).toHaveBeenCalledTimes(1)
    act(() => { vi.advanceTimersByTime(5000) })
    await flush()
    expect(mocks.finish).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('alert')).toHaveTextContent('结束计时失败')
  })

  it('labels mock comments as unsaved previews', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    mocks.getActive.mockResolvedValue({ id: 'saved', status: 'saved', actualMinutes: 25, plannedMinutes: 25, startedAt: new Date().toISOString(), serverNow: new Date().toISOString(), savedSession: { id: 's1' } })
    mocks.requestSessionComment.mockResolvedValue({ aiComment: '模拟短评', source: 'cloud_mock', execution: { persisted: false } })
    renderPage()
    await flush()
    await user.click(screen.getByRole('button', { name: '让姐妹看看' }))
    expect(screen.getByText('模拟短评')).toBeInTheDocument()
    expect(screen.getByText(/这是模拟回应，未连接云端，也未保存到自习记录/)).toBeInTheDocument()
    expect(mocks.recordSession).not.toHaveBeenCalled()
  })
})
