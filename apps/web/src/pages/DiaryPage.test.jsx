import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { format, addMonths } from 'date-fns'

vi.mock('../services/diaryService', () => ({
  diaryService: {
    listMonth: vi.fn(),
    getDay: vi.fn(),
    saveDay: vi.fn(),
    removeDay: vi.fn(),
    requestComment: vi.fn(),
  },
}))

import { diaryService } from '../services/diaryService'
import DiaryPage from './DiaryPage'

const renderPage = () => render(<MemoryRouter><DiaryPage /></MemoryRouter>)

const now = new Date()
const today = format(now, 'yyyy-MM-dd')
const todayLabel = format(now, 'M月d日')
const monthKey = format(now, 'yyyy-MM')
// 当前月内一个不是今天的日子，用于「点选历史」
const otherDate = new Date(now)
otherDate.setDate(now.getDate() === 1 ? 2 : 1)
const otherDay = format(otherDate, 'yyyy-MM-dd')
const otherLabel = format(otherDate, 'M月d日')

const notFound = () => ({ response: { status: 404, data: { error: '这一天还没有日记' } } })
const todayEntry = (overrides = {}) => ({
  id: 'd1',
  day: today,
  mood: 'happy',
  content: '今天很开心',
  aiComment: null,
  aiCommentSource: null,
  updatedAt: '2026-09-04T10:00:00Z',
  ...overrides,
})

describe('DiaryPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    diaryService.listMonth.mockResolvedValue([])
    diaryService.getDay.mockRejectedValue(notFound())
    diaryService.saveDay.mockImplementation(async (day, data) => ({ id: 'd1', day, ...data, aiComment: null, aiCommentSource: null }))
    diaryService.removeDay.mockResolvedValue({ success: true })
  })

  it('shows a loading status until the month load settles', () => {
    diaryService.listMonth.mockReturnValue(new Promise(() => {}))
    diaryService.getDay.mockReturnValue(new Promise(() => {}))

    renderPage()

    expect(screen.getByRole('status')).toHaveTextContent('加载中…')
  })

  it('shows a retryable error when loading fails', async () => {
    const user = userEvent.setup()
    diaryService.listMonth.mockRejectedValueOnce(new Error('offline'))

    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent('加载失败，请检查网络后重试')
    await user.click(screen.getByRole('button', { name: '重试' }))
    expect(diaryService.listMonth).toHaveBeenCalledTimes(2)
    expect(await screen.findByLabelText('日记内容')).toBeInTheDocument()
  })

  it('loads the month and fills today into the editor with a mood dot on the calendar', async () => {
    diaryService.listMonth.mockResolvedValue([todayEntry()])
    diaryService.getDay.mockResolvedValue(todayEntry())

    renderPage()

    expect(diaryService.listMonth).toHaveBeenCalledWith(monthKey)
    expect(await screen.findByLabelText('日记内容')).toHaveValue('今天很开心')
    const dayButton = screen.getByRole('button', { name: todayLabel })
    expect(dayButton.querySelector('span.bg-status-local')).not.toBeNull()
  })

  it('keeps an empty editor when the day has no diary (404)', async () => {
    renderPage()

    expect(await screen.findByLabelText('日记内容')).toHaveValue('')
    expect(screen.getByRole('button', { name: /让姐妹看看/ })).toBeDisabled()
    expect(screen.getByText('先保存今天的日记，姐妹才能看到哦')).toBeInTheDocument()
  })

  it('saves today with the selected mood', async () => {
    const user = userEvent.setup()
    diaryService.getDay.mockResolvedValue(todayEntry({ mood: 'neutral', content: '旧内容' }))

    renderPage()

    const textarea = await screen.findByLabelText('日记内容')
    await user.clear(textarea)
    await user.type(textarea, '今天完成了好多事')
    await user.click(screen.getByRole('radio', { name: '开心' }))
    await user.click(screen.getByRole('button', { name: '保存' }))

    expect(diaryService.saveDay).toHaveBeenCalledWith(today, { content: '今天完成了好多事', mood: 'happy' })
    expect(await screen.findByText('已保存')).toBeInTheDocument()
  })

  it('shows the AI comment after asking the sister', async () => {
    const user = userEvent.setup()
    diaryService.getDay.mockResolvedValue(todayEntry())
    diaryService.requestComment.mockResolvedValue({ aiComment: '今天辛苦啦，抱抱你', source: 'qwen', reused: false })

    renderPage()

    await screen.findByLabelText('日记内容')
    await user.click(screen.getByRole('button', { name: /让姐妹看看/ }))

    expect(diaryService.requestComment).toHaveBeenCalledWith(today)
    expect(await screen.findByText('今天辛苦啦，抱抱你')).toBeInTheDocument()
    expect(screen.getByText('云端模型')).toBeInTheDocument()
  })

  it('labels the comment source as cloud model', async () => {
    diaryService.getDay.mockResolvedValue(todayEntry({ aiComment: '云端回应', aiCommentSource: 'qwen' }))

    renderPage()

    expect(await screen.findByText('云端回应')).toBeInTheDocument()
    expect(screen.getByText('云端模型')).toBeInTheDocument()
    expect(screen.queryByText('云端备用')).not.toBeInTheDocument()
  })

  it('guides to consent the cloud model when it is not consented', async () => {
    const user = userEvent.setup()
    diaryService.getDay.mockResolvedValue(todayEntry())
    diaryService.requestComment.mockRejectedValue({ response: { status: 503, data: { error: '未同意', code: 'CLOUD_NOT_CONSENTED' } } })

    renderPage()

    await screen.findByLabelText('日记内容')
    await user.click(screen.getByRole('button', { name: /让姐妹看看/ }))

    expect(await screen.findByRole('alert')).toHaveTextContent('还没有同意使用云端模型')
    expect(screen.getByRole('link', { name: /云端模型/ })).toHaveAttribute('href', '/profile')
  })

  it('shows a retry-later message when the model is unavailable', async () => {
    const user = userEvent.setup()
    diaryService.getDay.mockResolvedValue(todayEntry())
    diaryService.requestComment.mockRejectedValue({ response: { status: 503, data: { error: '不可用', code: 'LLM_UNAVAILABLE' } } })

    renderPage()

    await screen.findByLabelText('日记内容')
    await user.click(screen.getByRole('button', { name: /让姐妹看看/ }))

    expect(await screen.findByRole('alert')).toHaveTextContent('姐妹现在有点忙，稍后再让她看看吧')
  })

  it('loads a past day into the editor when its calendar cell is clicked', async () => {
    const user = userEvent.setup()
    const past = { id: 'd0', day: otherDay, mood: 'sad', content: '那天有点难过', aiComment: null, aiCommentSource: null }
    diaryService.listMonth.mockResolvedValue([todayEntry(), past])
    diaryService.getDay.mockResolvedValue(todayEntry())

    renderPage()

    expect(await screen.findByLabelText('日记内容')).toHaveValue('今天很开心')
    await user.click(screen.getByRole('button', { name: otherLabel }))

    expect(screen.getByLabelText('日记内容')).toHaveValue('那天有点难过')
    // 点选走已加载的月数据，不再请求单日接口
    expect(diaryService.getDay).toHaveBeenCalledTimes(1)
  })

  it('switches month and refetches the month list', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByLabelText('日记内容')

    await user.click(screen.getByRole('button', { name: '下个月' }))

    await waitFor(() => {
      expect(diaryService.listMonth).toHaveBeenCalledWith(format(addMonths(now, 1), 'yyyy-MM'))
    })
  })

  it('deletes the entry through the confirm dialog', async () => {
    const user = userEvent.setup()
    diaryService.getDay.mockResolvedValue(todayEntry())

    renderPage()

    expect(await screen.findByLabelText('日记内容')).toHaveValue('今天很开心')
    await user.click(screen.getByRole('button', { name: '删除这篇日记' }))

    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent('删除这篇日记')
    await user.click(screen.getByRole('button', { name: '确认删除' }))

    expect(diaryService.removeDay).toHaveBeenCalledWith(today)
    await waitFor(() => expect(screen.getByLabelText('日记内容')).toHaveValue(''))
  })

  it('keeps the entry when deletion is cancelled', async () => {
    const user = userEvent.setup()
    diaryService.getDay.mockResolvedValue(todayEntry())

    renderPage()

    expect(await screen.findByLabelText('日记内容')).toHaveValue('今天很开心')
    await user.click(screen.getByRole('button', { name: '删除这篇日记' }))
    await screen.findByRole('alertdialog')
    await user.click(screen.getByRole('button', { name: '取消' }))

    expect(diaryService.removeDay).not.toHaveBeenCalled()
    expect(screen.getByLabelText('日记内容')).toHaveValue('今天很开心')
  })
})
