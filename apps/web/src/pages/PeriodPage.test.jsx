import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { format } from 'date-fns'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../services/toolsService', () => ({
  toolsService: {
    getTodos: vi.fn(),
    createTodo: vi.fn(),
    updateTodo: vi.fn(),
    deleteTodo: vi.fn(),
    getCountdowns: vi.fn(),
    createCountdown: vi.fn(),
    deleteCountdown: vi.fn(),
    getPeriodRecords: vi.fn(),
    createPeriodRecord: vi.fn(),
    getReminders: vi.fn(),
    updateReminder: vi.fn(),
    getWeather: vi.fn(),
  },
}))

import { toolsService } from '../services/toolsService'
import { useToolsStore } from '../stores/toolsStore'
import PeriodPage from './PeriodPage'

const renderPage = () => render(<MemoryRouter><PeriodPage /></MemoryRouter>)

describe('PeriodPage', () => {
  beforeEach(() => {
    useToolsStore.setState({ periodRecords: [] })
    toolsService.getPeriodRecords.mockResolvedValue([])
  })

  it('loads period records from the server on mount', async () => {
    toolsService.getPeriodRecords.mockResolvedValue([{ id: 'p9', startDate: '2026-08-01', endDate: '2026-08-05', cycleDays: 28 }])
    renderPage()

    expect(toolsService.getPeriodRecords).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('2026-08-01')).toBeInTheDocument()
  })
  it('shows a placeholder countdown and empty history without records', async () => {
    renderPage()

    expect(await screen.findByText('--')).toBeInTheDocument()
    expect(await screen.findByText('暂无记录')).toBeInTheDocument()
  })

  it('shows a loading status until the first load settles', () => {
    toolsService.getPeriodRecords.mockReturnValue(new Promise(() => {}))
    renderPage()

    expect(screen.getByRole('status')).toHaveTextContent('加载中…')
  })

  it('shows a retryable error when loading fails', async () => {
    const user = userEvent.setup()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    toolsService.getPeriodRecords.mockRejectedValueOnce(new Error('offline'))
    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent('加载失败，请检查网络后重试')

    toolsService.getPeriodRecords.mockResolvedValue([{ id: 'p1', startDate: '2026-08-01', endDate: null, cycleDays: 28 }])
    await user.click(screen.getByRole('button', { name: '重试' }))

    expect(await screen.findByText('2026-08-01')).toBeInTheDocument()
    expect(toolsService.getPeriodRecords).toHaveBeenCalledTimes(2)
  })

  it('predicts the next period from the latest record', async () => {
    vi.useFakeTimers()
    try {
      // 固定「今天」为本地 2026-09-01，期望值不依赖真实墙钟
      vi.setSystemTime(new Date(2026, 8, 1, 10))
      toolsService.getPeriodRecords.mockResolvedValue([{ id: 'p1', startDate: '2026-08-22', endDate: null, cycleDays: 28 }])

      const { container } = renderPage()
      await act(async () => {}) // 等 loadPeriodRecords 落库

      // 下次 = 8-22 + 28 天 = 9-19；9-01 → 9-19 恰为 18 个日历日
      expect(container.querySelector('.text-6xl')).toHaveTextContent('18')
      expect(screen.getByText(/预计 9月19日/)).toBeInTheDocument()
      expect(screen.getByText('进行中')).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('恰标出 2026-08-29 至 2026-08-31 三个经期日（不多不少）', async () => {
    vi.useFakeTimers()
    try {
      // 固定「今天」为本地 2026-09-01：日历默认落在 9 月，记录与「今天」互不干扰
      vi.setSystemTime(new Date(2026, 8, 1, 12))
      toolsService.getPeriodRecords.mockResolvedValue([
        { id: 'p1', startDate: '2026-08-29', endDate: '2026-08-31', cycleDays: 28 },
      ])

      const { container } = renderPage()
      await act(async () => {}) // 等 loadPeriodRecords 落库

      // 日历导航回记录所在的 2026 年 8 月
      const heading = screen.getByText(/^\d{4}年\d{1,2}月$/)
      const [prevButton] = heading.parentElement.querySelectorAll('button')
      fireEvent.click(prevButton)
      expect(heading).toHaveTextContent('2026年8月')

      // 粉色高亮的格子恰为 29/30/31 三天：UTC 零点解析会把第一天（29 日）标丢
      const marked = [...container.querySelectorAll('.bg-brand-pink\\/20')].map(el => el.textContent)
      expect(marked).toEqual(['29', '30', '31'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('labels finished records with their duration in days', async () => {
    toolsService.getPeriodRecords.mockResolvedValue([{ id: 'p1', startDate: '2026-08-01', endDate: '2026-08-06', cycleDays: 30 }])

    renderPage()

    expect(await screen.findByText('5天')).toBeInTheDocument()
    expect(screen.getByText('周期 30 天')).toBeInTheDocument()
  })

  it('navigates between months in the calendar', async () => {
    const user = userEvent.setup()
    renderPage()

    const heading = await screen.findByText(/^\d{4}年\d{1,2}月$/)
    const currentLabel = heading.textContent
    const [prevButton, nextButton] = heading.parentElement.querySelectorAll('button')

    await user.click(nextButton)
    expect(heading.textContent).not.toBe(currentLabel)

    await user.click(prevButton)
    expect(heading.textContent).toBe(currentLabel)
  })

  it('marks period days inside the record range', async () => {
    const today = new Date()
    const startDate = format(today, 'yyyy-MM-dd')
    toolsService.getPeriodRecords.mockResolvedValue([{ id: 'p1', startDate, endDate: null, cycleDays: 28 }])

    const { container } = renderPage()
    await screen.findByText('进行中')

    // 今天同时是经期日与今天，渐变样式优先
    expect(container.querySelector('.bg-gradient-pink-purple.text-text-inverse')).not.toBeNull()
  })

  it('marks a past period day with the soft pink highlight', async () => {
    const user = userEvent.setup()
    const start = new Date()
    start.setDate(start.getDate() - 3)
    const end = new Date()
    end.setDate(end.getDate() - 1)
    toolsService.getPeriodRecords.mockResolvedValue([{
      id: 'p1',
      startDate: format(start, 'yyyy-MM-dd'),
      endDate: format(end, 'yyyy-MM-dd'),
      cycleDays: 28,
    }])

    const { container } = renderPage()
    await screen.findByText(/周期 28 天/)

    // 记录在 3 天前，月初几天会整体落到上个月：把日历导航到记录所在月份再断言
    const targetLabel = format(start, 'yyyy年M月')
    const readHeading = () => screen.getByText(/^\d{4}年\d{1,2}月$/)
    while (readHeading().textContent !== targetLabel) {
      await user.click(readHeading().parentElement.querySelector('button'))
    }

    expect(container.querySelectorAll('.bg-brand-pink\\/20').length).toBeGreaterThan(0)
  })

  it('records today as a new period start', async () => {
    const user = userEvent.setup()
    toolsService.createPeriodRecord.mockImplementation(async (startDate, endDate, cycleDays) => ({
      id: 'p-new',
      startDate,
      endDate,
      cycleDays,
    }))
    renderPage()

    await user.click(await screen.findByRole('button', { name: /记录今天/ }))

    const today = format(new Date(), 'yyyy-MM-dd')
    expect(toolsService.createPeriodRecord).toHaveBeenCalledWith(today, null, 28)
    expect(await screen.findByText(today)).toBeInTheDocument()
  })
})
