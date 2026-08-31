import { render, screen } from '@testing-library/react'
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
  it('shows a placeholder countdown and empty history without records', () => {
    renderPage()

    expect(screen.getByText('--')).toBeInTheDocument()
    expect(screen.getByText('暂无记录')).toBeInTheDocument()
  })

  it('predicts the next period from the latest record', async () => {
    const start = new Date()
    start.setDate(start.getDate() - 10)
    const startDate = format(start, 'yyyy-MM-dd')
    toolsService.getPeriodRecords.mockResolvedValue([{ id: 'p1', startDate, endDate: null, cycleDays: 28 }])

    const { container } = renderPage()
    await screen.findByText('进行中')

    // 日历格子也是数字，只查 Hero 大数字；与 store 同口径计算预期值
    const next = new Date(startDate)
    next.setDate(next.getDate() + 28)
    const midnight = new Date()
    midnight.setHours(0, 0, 0, 0)
    const expectedDays = Math.max(0, Math.ceil((next - midnight) / 86400000))
    expect(container.querySelector('.text-6xl')).toHaveTextContent(String(expectedDays))
    expect(screen.getByText(/预计 /)).toBeInTheDocument()
    expect(screen.getByText('进行中')).toBeInTheDocument()
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

    const heading = screen.getByText(/^\d{4}年\d{1,2}月$/)
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
    expect(container.querySelector('.bg-gradient-pink-purple.text-white')).not.toBeNull()
  })

  it('marks a past period day with the soft pink highlight', async () => {
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

    await user.click(screen.getByRole('button', { name: /记录今天/ }))

    const today = format(new Date(), 'yyyy-MM-dd')
    expect(toolsService.createPeriodRecord).toHaveBeenCalledWith(today, null, 28)
    expect(await screen.findByText(today)).toBeInTheDocument()
  })
})
