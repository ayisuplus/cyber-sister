import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { format, subDays } from 'date-fns'

vi.mock('../services/habitService', () => ({
  habitService: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    archive: vi.fn(),
    checkin: vi.fn(),
    cheer: vi.fn(),
  },
}))

import { habitService } from '../services/habitService'
import { useChatStore } from '../stores/chatStore'
import HandbookPage from './HandbookPage'

const renderPage = () => render(<MemoryRouter><HandbookPage /></MemoryRouter>)

const today = format(new Date(), 'yyyy-MM-dd')
const yesterday = format(subDays(new Date(), 1), 'yyyy-MM-dd')

const habit = (overrides = {}) => ({
  id: 'h1',
  name: '喝水',
  icon: 'droplet',
  checkedToday: false,
  streak: 3,
  recentDays: [today, yesterday],
  ...overrides,
})

describe('HandbookPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useChatStore.setState({ llmMode: null })
    habitService.list.mockResolvedValue([])
    habitService.create.mockResolvedValue(habit({ id: 'h2', name: '读书', icon: 'book' }))
    habitService.checkin.mockResolvedValue({ checked: true, day: today })
    habitService.archive.mockResolvedValue({ success: true })
  })

  it('shows a loading status until the list settles', () => {
    habitService.list.mockReturnValue(new Promise(() => {}))

    renderPage()

    expect(screen.getByRole('status')).toHaveTextContent('加载中…')
  })

  it('shows a retryable error when loading fails', async () => {
    const user = userEvent.setup()
    habitService.list.mockRejectedValueOnce(new Error('offline'))

    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent('加载失败，请检查网络后重试')
    await user.click(screen.getByRole('button', { name: '重试' }))
    expect(habitService.list).toHaveBeenCalledTimes(2)
    expect(await screen.findByText('还没有习惯，先加一个吧')).toBeInTheDocument()
  })

  it('renders the habit list with streak and the 30-day dot matrix', async () => {
    habitService.list.mockResolvedValue([habit({ checkedToday: true })])

    renderPage()

    expect(await screen.findByText('喝水')).toBeInTheDocument()
    expect(screen.getByText('连续 3 天')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '打卡 喝水' })).toHaveAttribute('aria-pressed', 'true')
    const dots = screen.getByLabelText('喝水 近 30 天打卡')
    expect(dots.querySelectorAll('span').length).toBe(30)
    expect(dots.querySelectorAll('span.bg-status-local').length).toBe(2)
  })

  it('shows the empty state without any habits', async () => {
    renderPage()

    expect(await screen.findByText('还没有习惯，先加一个吧')).toBeInTheDocument()
  })

  it('toggles today check-in and refreshes the list', async () => {
    const user = userEvent.setup()
    habitService.list
      .mockResolvedValueOnce([habit()])
      .mockResolvedValue([habit({ checkedToday: true, streak: 4 })])

    renderPage()

    await user.click(await screen.findByRole('button', { name: '打卡 喝水' }))

    expect(habitService.checkin).toHaveBeenCalledWith('h1')
    expect(await screen.findByRole('button', { name: '打卡 喝水' })).toHaveAttribute('aria-pressed', 'true')
    expect(await screen.findByText('连续 4 天')).toBeInTheDocument()
  })

  it('creates a habit with name and icon, then refreshes', async () => {
    const user = userEvent.setup()
    habitService.list
      .mockResolvedValueOnce([])
      .mockResolvedValue([habit({ id: 'h2', name: '读书', icon: 'book' })])

    renderPage()

    await user.type(await screen.findByLabelText('习惯名称'), '读书')
    await user.click(screen.getByRole('radio', { name: '阅读' }))
    await user.click(screen.getByRole('button', { name: /添加/ }))

    expect(habitService.create).toHaveBeenCalledWith({ name: '读书', icon: 'book' })
    expect(await screen.findByText('读书')).toBeInTheDocument()
  })

  it('disables the form at the 12-habit limit', async () => {
    habitService.list.mockResolvedValue(
      Array.from({ length: 12 }, (_, i) => habit({ id: `h${i}`, name: `习惯${i}` })),
    )

    renderPage()

    expect(await screen.findByText(/最多 12 个习惯/)).toBeInTheDocument()
    expect(screen.queryByLabelText('习惯名称')).not.toBeInTheDocument()
  })

  it('archives a habit through the confirm dialog', async () => {
    const user = userEvent.setup()
    habitService.list.mockResolvedValue([habit()])

    renderPage()

    await user.click(await screen.findByRole('button', { name: '归档 喝水' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent('归档习惯')
    expect(dialog).toHaveTextContent('历史打卡会保留，但不再显示在列表里')
    await user.click(within(dialog).getByRole('button', { name: '确认归档' }))

    expect(habitService.archive).toHaveBeenCalledWith('h1')
    await waitFor(() => expect(habitService.list).toHaveBeenCalledTimes(2))
  })

  it('keeps the habit when archiving is cancelled', async () => {
    const user = userEvent.setup()
    habitService.list.mockResolvedValue([habit()])

    renderPage()

    await user.click(await screen.findByRole('button', { name: '归档 喝水' }))
    await screen.findByRole('alertdialog')
    await user.click(screen.getByRole('button', { name: '取消' }))

    expect(habitService.archive).not.toHaveBeenCalled()
    expect(screen.getByText('喝水')).toBeInTheDocument()
  })

  it('shows the cheer card after asking the sister', async () => {
    const user = userEvent.setup()
    habitService.list.mockResolvedValue([habit()])
    habitService.cheer.mockResolvedValue({ cheer: '坚持就是胜利，我为你骄傲', source: 'qwen' })

    renderPage()

    await user.click(await screen.findByRole('button', { name: /姐妹说两句/ }))

    expect(await screen.findByText('坚持就是胜利，我为你骄傲')).toBeInTheDocument()
    expect(screen.getByText('云端模型')).toBeInTheDocument()
  })

  it('hints to add a habit first when the cheer is null', async () => {
    const user = userEvent.setup()
    habitService.cheer.mockResolvedValue({ cheer: null, source: null })

    renderPage()

    await user.click(await screen.findByRole('button', { name: /姐妹说两句/ }))

    expect(await screen.findByText('先加一个习惯再让姐妹看看')).toBeInTheDocument()
  })

  it('shows an inline error when the cheer fails', async () => {
    const user = userEvent.setup()
    habitService.list.mockResolvedValue([habit()])
    habitService.cheer.mockRejectedValue({ response: { status: 503, data: { error: '不可用', code: 'LLM_UNAVAILABLE' } } })

    renderPage()

    await user.click(await screen.findByRole('button', { name: /姐妹说两句/ }))

    expect(await screen.findByRole('alert')).toHaveTextContent('姐妹现在有点忙，稍后再试试吧')
    // 不阻塞页面：习惯列表仍在
    expect(screen.getByText('喝水')).toBeInTheDocument()
  })

  it('guides to consent the cloud model when it is not consented', async () => {
    const user = userEvent.setup()
    habitService.list.mockResolvedValue([habit()])
    habitService.cheer.mockRejectedValue({ response: { status: 503, data: { error: '未同意', code: 'CLOUD_NOT_CONSENTED' } } })

    renderPage()

    await user.click(await screen.findByRole('button', { name: /姐妹说两句/ }))

    expect(await screen.findByRole('alert')).toHaveTextContent('还没有同意使用云端模型')
    expect(screen.getByRole('link', { name: /云端模型/ })).toHaveAttribute('href', '/profile')
  })
})
