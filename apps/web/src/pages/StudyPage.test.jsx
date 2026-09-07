import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSummary: vi.fn(),
  listSessions: vi.fn(),
  recordSession: vi.fn(),
  requestSessionComment: vi.fn(),
}))

vi.mock('../services/studyService', () => ({
  studyService: {
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

  it('records at least one minute when finished early', async () => {
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

    expect(mocks.recordSession).toHaveBeenCalledWith(expect.objectContaining({
      plannedMinutes: 25,
      actualMinutes: 1,
      note: '背完一章',
    }))
    expect(mocks.recordSession.mock.calls[0][0].actualMinutes).toBeGreaterThanOrEqual(1)
    expect(mocks.getSummary).toHaveBeenCalledTimes(2)
  })
})
