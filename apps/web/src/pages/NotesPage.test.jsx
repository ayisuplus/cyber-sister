import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { format } from 'date-fns'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../services/diaryService', () => ({
  diaryService: { listMonth: vi.fn(), getDay: vi.fn(), saveDay: vi.fn(), removeDay: vi.fn() },
}))
vi.mock('../services/readingService', () => ({
  readingService: { listRecentNotes: vi.fn(), logNote: vi.fn(), deleteNote: vi.fn(), listBooks: vi.fn(), addNote: vi.fn() },
}))

import { diaryService } from '../services/diaryService'
import { readingService } from '../services/readingService'
import NotesPage from './NotesPage'

const renderPage = () => render(<MemoryRouter><NotesPage /></MemoryRouter>)
const today = format(new Date(), 'yyyy-MM-dd')
const diaryEntry = { id: 'd1', day: today, mood: 'happy', content: '今天去看了桂花', aiComment: null }
const note = { id: 'n1', book: '活着', page: 30, content: '有庆那段看得心里发紧', createdAt: `${today}T10:00:00.000Z`, aiComment: null }

beforeEach(() => {
  vi.clearAllMocks()
  diaryService.listMonth.mockResolvedValue([])
  readingService.listRecentNotes.mockResolvedValue([])
  diaryService.saveDay.mockResolvedValue(diaryEntry)
  readingService.logNote.mockResolvedValue({ bookId: 'b1', title: '活着' })
  readingService.listBooks.mockResolvedValue([])
  readingService.addNote.mockResolvedValue({ note: { id: 'n2' } })
})

describe('手记', () => {
  it('日记和读书笔记排在同一条时间线上，没有页签', async () => {
    diaryService.listMonth.mockResolvedValue([diaryEntry])
    readingService.listRecentNotes.mockResolvedValue([note])

    renderPage()

    const day = await screen.findByRole('region', { name: format(new Date(), 'M月d日') })
    expect(within(day).getByText('今天去看了桂花')).toBeInTheDocument()
    expect(within(day).getByText('有庆那段看得心里发紧')).toBeInTheDocument()
    expect(within(day).getByText(/《活着》/)).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: '手记分类' })).not.toBeInTheDocument()
  })

  it('写一段话就是今天的日记，带上选的心情', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('还没有手记')

    await user.click(screen.getByRole('button', { name: '难过' }))
    await user.type(screen.getByLabelText('手记内容'), '有点累')
    await user.click(screen.getByRole('button', { name: '记下来' }))

    expect(diaryService.saveDay).toHaveBeenCalledWith(today, { content: '有点累', mood: 'sad' })
    expect(await screen.findByText('写好了')).toBeInTheDocument()
    expect(screen.getByLabelText('手记内容')).toHaveValue('')
  })

  it('标成一本书时按书名记，缺书名就先提醒', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('还没有手记')

    await user.click(screen.getByRole('button', { name: /记的是一本书/ }))
    await user.type(screen.getByLabelText('手记内容'), '有庆那段看得心里发紧')
    await user.click(screen.getByRole('button', { name: '记下来' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('写下书名')
    expect(readingService.logNote).not.toHaveBeenCalled()

    await user.type(screen.getByLabelText('书名'), '活着')
    await user.click(screen.getByRole('button', { name: '记下来' }))
    expect(readingService.logNote).toHaveBeenCalledWith({ book: '活着', note: '有庆那段看得心里发紧' })
    expect(diaryService.saveDay).not.toHaveBeenCalled()
  })

  it('今天写过了可以接着改，内容会先填回来', async () => {
    const user = userEvent.setup()
    diaryService.listMonth.mockResolvedValue([diaryEntry])
    renderPage()

    await user.click(await screen.findByRole('button', { name: '改今天写的' }))

    expect(screen.getByLabelText('手记内容')).toHaveValue('今天去看了桂花')
    await user.click(screen.getByRole('button', { name: '记下来' }))
    expect(diaryService.saveDay).toHaveBeenCalledWith(today, { content: '今天去看了桂花', mood: 'happy' })
  })

  it('删除要先确认，失败时内容还在', async () => {
    const user = userEvent.setup()
    diaryService.listMonth.mockResolvedValue([diaryEntry])
    diaryService.removeDay.mockRejectedValue(new Error('offline'))
    renderPage()

    await user.click(await screen.findByRole('button', { name: `删除 ${format(new Date(), 'M月d日')} 的日记` }))
    expect(diaryService.removeDay).not.toHaveBeenCalled()
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: '确认删除' }))

    expect(await screen.findByText('没删掉，请重试')).toBeInTheDocument()
    expect(screen.getByText('今天去看了桂花')).toBeInTheDocument()
  })

  it('加载失败可以重试', async () => {
    const user = userEvent.setup()
    diaryService.listMonth.mockRejectedValueOnce(new Error('offline'))
    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent('加载失败')
    await user.click(screen.getByRole('button', { name: '重试' }))
    expect(await screen.findByText('还没有手记')).toBeInTheDocument()
  })

  it('往回看更早的月份', async () => {
    const user = userEvent.setup()
    diaryService.listMonth.mockResolvedValue([diaryEntry])
    renderPage()
    await screen.findByText('今天去看了桂花')

    await user.click(screen.getByRole('button', { name: '看更早的' }))

    await vi.waitFor(() => expect(diaryService.listMonth).toHaveBeenCalledTimes(3))
    expect(readingService.listRecentNotes).toHaveBeenLastCalledWith({ limit: 40 })
  })
})

describe('手记与读书接起来', () => {
  const shelf = [
    { id: 'b1', title: '活着', status: 'reading' },
    { id: 'b2', title: '我们仨', status: 'want' },
  ]

  it('按下「记的是一本书」才去取书架，只写日记的人不多花这一次请求', async () => {
    const user = userEvent.setup()
    readingService.listBooks.mockResolvedValue(shelf)
    renderPage()
    await screen.findByText('还没有手记')

    expect(readingService.listBooks).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: /记的是一本书/ }))

    expect(readingService.listBooks).toHaveBeenCalledOnce()
    expect(await screen.findByRole('group', { name: '记到哪本书下' })).toBeInTheDocument()
  })

  it('默认记到你在读的那本下，按书的 id 落账而不是书名', async () => {
    const user = userEvent.setup()
    readingService.listBooks.mockResolvedValue(shelf)
    renderPage()
    await screen.findByText('还没有手记')

    await user.click(screen.getByRole('button', { name: /记的是一本书/ }))
    await screen.findByRole('group', { name: '记到哪本书下' })
    expect(screen.getByRole('button', { name: '活着' })).toHaveAttribute('aria-pressed', 'true')

    await user.type(screen.getByLabelText('手记内容'), '有庆那段看得心里发紧')
    await user.click(screen.getByRole('button', { name: '记下来' }))

    expect(readingService.addNote).toHaveBeenCalledWith('b1', { content: '有庆那段看得心里发紧' })
    expect(readingService.logNote).not.toHaveBeenCalled()
    expect(screen.queryByLabelText('书名')).not.toBeInTheDocument()
  })

  it('换一本书记，或者选「不在书架上」手写书名', async () => {
    const user = userEvent.setup()
    readingService.listBooks.mockResolvedValue(shelf)
    renderPage()
    await screen.findByText('还没有手记')
    await user.click(screen.getByRole('button', { name: /记的是一本书/ }))
    await screen.findByRole('group', { name: '记到哪本书下' })

    await user.click(screen.getByRole('button', { name: '我们仨' }))
    await user.type(screen.getByLabelText('手记内容'), '钱瑗那段')
    await user.click(screen.getByRole('button', { name: '记下来' }))
    expect(readingService.addNote).toHaveBeenCalledWith('b2', { content: '钱瑗那段' })

    await user.click(screen.getByRole('button', { name: '不在书架上' }))
    await user.type(screen.getByLabelText('手记内容'), '从图书馆借的')
    await user.type(screen.getByLabelText('书名'), '飘')
    await user.click(screen.getByRole('button', { name: '记下来' }))
    expect(readingService.logNote).toHaveBeenCalledWith({ book: '飘', note: '从图书馆借的' })
  })

  it('读书笔记的字数上限跟服务端一致，不让人写完才被拒', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('还没有手记')

    expect(screen.getByLabelText('手记内容')).toHaveAttribute('maxlength', '2000')
    await user.click(screen.getByRole('button', { name: /记的是一本书/ }))

    expect(screen.getByLabelText('手记内容')).toHaveAttribute('maxlength', '500')
    expect(screen.getByText(/最多 500 个字/)).toBeInTheDocument()
  })

  it('取不到书架时退回手写书名，不挡着记', async () => {
    const user = userEvent.setup()
    readingService.listBooks.mockRejectedValue(new Error('offline'))
    renderPage()
    await screen.findByText('还没有手记')

    await user.click(screen.getByRole('button', { name: /记的是一本书/ }))

    expect(await screen.findByLabelText('书名')).toBeInTheDocument()
  })

  it('读书笔记带着原文，并能回到书里那一处', async () => {
    readingService.listRecentNotes.mockResolvedValue([{
      ...note,
      bookId: 'b1',
      locator: '3:1024',
      quote: '有庆躺在那里，脸色白得像纸',
      aiComment: '她那时候还没缓过来。',
      aiCommentSource: 'chat',
    }])
    renderPage()

    expect(await screen.findByText('有庆躺在那里，脸色白得像纸')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '回到书里这一处' })).toHaveAttribute('href', '/tools/reading/b1?at=3%3A1024')
    expect(screen.getByText(/读这段时她说的：/)).toBeInTheDocument()
  })

  it('没有位置的笔记不给假链接', async () => {
    readingService.listRecentNotes.mockResolvedValue([{ ...note, bookId: 'b1', locator: null }])
    renderPage()

    await screen.findByText('有庆那段看得心里发紧')
    expect(screen.queryByRole('link', { name: '回到书里这一处' })).not.toBeInTheDocument()
  })
})
