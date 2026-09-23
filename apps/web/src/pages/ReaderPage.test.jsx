import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../services/readingService', () => ({
  readingService: { listBooks: vi.fn(), saveProgress: vi.fn(), addNote: vi.fn(), listNotes: vi.fn(), deleteNote: vi.fn() },
}))
vi.mock('../services/bookStore', () => ({
  bookStore: { getBook: vi.fn() },
}))

// 伴读问答走的是那段唯一的对话，这里把 store 换成一个能看清入参的替身
const chat = { sendMessage: vi.fn(), isSending: false, messages: [] }
vi.mock('../stores/chatStore', () => ({
  useChatStore: (selector) => selector(chat),
}))

import { readingService } from '../services/readingService'
import { bookStore } from '../services/bookStore'
import ReaderPage from './ReaderPage'

const BOOK = { id: 'b1', title: '活着', author: '余华', status: 'reading', locator: null, percent: null }
const CHAPTERS = [
  { title: '第一章 出门', text: '我比现在年轻十岁的时候，获得了一个游手好闲的职业。' },
  { title: '第二章 回家', text: '那天傍晚下起了雨，他站在门口没有进来。' },
]

const renderReader = (search = '') => render(
  <MemoryRouter initialEntries={[`/tools/reading/b1${search}`]}>
    <Routes><Route path="/tools/reading/:bookId" element={<ReaderPage />} /></Routes>
  </MemoryRouter>
)

const selectText = (text) => {
  vi.spyOn(window, 'getSelection').mockReturnValue({ toString: () => text })
}

beforeEach(() => {
  vi.clearAllMocks()
  chat.isSending = false
  chat.messages = []
  readingService.listBooks.mockResolvedValue([BOOK])
  readingService.saveProgress.mockResolvedValue(BOOK)
  readingService.addNote.mockResolvedValue({ note: { id: 'n1' } })
  readingService.listNotes.mockResolvedValue([])
  readingService.deleteNote.mockResolvedValue({ success: true })
  bookStore.getBook.mockResolvedValue({ id: 'b1', chapters: CHAPTERS })
  chat.sendMessage.mockResolvedValue({ status: 'ok' })
})

afterEach(() => vi.restoreAllMocks())

describe('读一本书', () => {
  it('打开第一章，书名在页头上', async () => {
    renderReader()

    expect(await screen.findByRole('heading', { name: '活着' })).toBeInTheDocument()
    expect(screen.getByText(/我比现在年轻十岁的时候/)).toBeInTheDocument()
    expect(screen.getByText('1 / 2')).toBeInTheDocument()
  })

  it('接着上次读到的地方打开', async () => {
    readingService.listBooks.mockResolvedValue([{ ...BOOK, locator: '1:10', percent: 62 }])
    renderReader()

    expect(await screen.findByText(/那天傍晚下起了雨/)).toBeInTheDocument()
    expect(screen.getByText('2 / 2')).toBeInTheDocument()
  })

  it('目录里点一章就翻过去', async () => {
    const user = userEvent.setup()
    renderReader()
    await screen.findByText(/我比现在年轻十岁的时候/)

    await user.click(screen.getByRole('button', { name: '目录与字号' }))
    await user.click(within(await screen.findByRole('dialog', { name: '目录' })).getByRole('button', { name: '第二章 回家' }))

    expect(await screen.findByText(/那天傍晚下起了雨/)).toBeInTheDocument()
  })

  it('字号选了就记住，下次还是这一档', async () => {
    const user = userEvent.setup()
    renderReader()
    await screen.findByText(/我比现在年轻十岁的时候/)

    await user.click(screen.getByRole('button', { name: '目录与字号' }))
    await user.click(screen.getByRole('button', { name: '大' }))

    expect(localStorage.getItem('amie-reader-font')).toBe('20')
  })

  it('选中一段问她：书名、引文和前后文一起带过去，同一轮也进对话', async () => {
    const user = userEvent.setup()
    renderReader()
    const text = await screen.findByText(/我比现在年轻十岁的时候/)

    selectText('获得了一个游手好闲的职业')
    fireEvent.mouseUp(text)
    await user.click(await screen.findByRole('button', { name: '问问她' }))
    await user.type(screen.getByLabelText('想问她什么'), '他为什么这么说？')
    await user.click(screen.getByRole('button', { name: '问她' }))

    expect(chat.sendMessage).toHaveBeenCalledWith(
      '读《活着》时问：他为什么这么说？\n\n> 获得了一个游手好闲的职业',
      { reading: { bookId: 'b1', passage: CHAPTERS[0].text } },
    )
  })

  it('问她那一格里写明这一段会发给云端模型', async () => {
    const user = userEvent.setup()
    renderReader()
    const text = await screen.findByText(/我比现在年轻十岁的时候/)

    selectText('游手好闲')
    fireEvent.mouseUp(text)
    await user.click(await screen.findByRole('button', { name: '问问她' }))

    expect(screen.getByText(/选中的这一段会一起发给云端的模型/)).toBeInTheDocument()
  })

  it('把她的回答记下来时，回答留在这条笔记上', async () => {
    const user = userEvent.setup()
    chat.messages = [{ id: 'm1', role: 'assistant', content: '因为他那时候还不懂。' }]
    renderReader()
    const text = await screen.findByText(/我比现在年轻十岁的时候/)

    selectText('游手好闲的职业')
    fireEvent.mouseUp(text)
    await user.click(await screen.findByRole('button', { name: '问问她' }))
    await user.type(screen.getByLabelText('想问她什么'), '他为什么这么说？')
    await user.click(screen.getByRole('button', { name: '问她' }))
    await user.click(await screen.findByRole('button', { name: '把这段问答记下来' }))

    expect(readingService.addNote).toHaveBeenCalledWith('b1', {
      content: '他为什么这么说？',
      quote: '游手好闲的职业',
      locator: '0:17',
      aiComment: '因为他那时候还不懂。',
    })
  })

  it('选中一段直接记一笔，原文和位置一起记下', async () => {
    const user = userEvent.setup()
    renderReader()
    const text = await screen.findByText(/我比现在年轻十岁的时候/)

    selectText('游手好闲的职业')
    fireEvent.mouseUp(text)
    await user.click(await screen.findByRole('button', { name: '记一笔' }))
    await user.type(screen.getByLabelText('写下你的感想'), '这句写得真好')
    await user.click(screen.getByRole('button', { name: '记下来' }))

    expect(readingService.addNote).toHaveBeenCalledWith('b1', {
      content: '这句写得真好',
      quote: '游手好闲的职业',
      locator: '0:17',
    })
    expect(chat.sendMessage).not.toHaveBeenCalled()
    expect(await screen.findByText('记下了')).toBeInTheDocument()
  })

  it('往下读一会儿就把进度存回去', async () => {
    vi.useFakeTimers()
    try {
      const { container } = renderReader()
      await vi.waitFor(() => expect(container.textContent).toContain('我比现在年轻十岁的时候'))
      const body = container.querySelector('.overflow-y-auto')
      Object.defineProperty(body, 'scrollHeight', { value: 1000, configurable: true })
      Object.defineProperty(body, 'clientHeight', { value: 500, configurable: true })
      Object.defineProperty(body, 'scrollTop', { value: 250, writable: true, configurable: true })

      fireEvent.scroll(body)
      vi.advanceTimersByTime(1200)

      // 读到第 1 章的一半 → (0 + 0.5) / 2 章 = 25%
      expect(readingService.saveProgress).toHaveBeenCalledWith('b1', { locator: '0:13', percent: 25 })
    } finally {
      vi.useRealTimers()
    }
  })

  it('这台设备上没有这本书的文件时说清楚怎么办', async () => {
    bookStore.getBook.mockResolvedValue(undefined)
    renderReader()

    expect(await screen.findByRole('alert')).toHaveTextContent('文件不在这台设备上')
    expect(screen.getByRole('button', { name: '回书架' })).toBeInTheDocument()
  })
})

const MARKED = {
  id: 'n1', bookId: 'b1', quote: '游手好闲的职业', locator: '0:17',
  content: '这句写得真好', aiComment: '我也记得这句。', aiCommentSource: 'chat',
  createdAt: '2026-09-20T10:00:00.000Z',
}
const LOOSE = {
  id: 'n2', bookId: 'b1', quote: null, locator: null,
  content: '聊天里随口记的', aiComment: null, aiCommentSource: null,
  createdAt: '2026-09-20T11:00:00.000Z',
}

describe('读过的地方看得见', () => {
  it('划过的那句话在正文里标出来，点一下看到当时写的和她说的', async () => {
    const user = userEvent.setup()
    readingService.listNotes.mockResolvedValue([MARKED])
    renderReader()

    const mark = await screen.findByRole('button', { name: '你在这里记过：这句写得真好' })
    expect(mark).toHaveTextContent('游手好闲的职业')

    await user.click(mark)

    const aside = await screen.findByRole('complementary', { name: '你在这里记过' })
    expect(within(aside).getByText('这句写得真好')).toBeInTheDocument()
    expect(within(aside).getByText(/读这段时她说的：/)).toBeInTheDocument()
  })

  it('引文在正文里找不到就不标，也不影响阅读', async () => {
    readingService.listNotes.mockResolvedValue([{ ...MARKED, quote: '这本书里没有这句' }])
    renderReader()

    await screen.findByText(/我比现在年轻十岁的时候/)
    expect(screen.queryByRole('button', { name: /你在这里记过/ })).not.toBeInTheDocument()
  })

  it('别的章的笔记不会标到这一章上', async () => {
    readingService.listNotes.mockResolvedValue([{ ...MARKED, locator: '1:0', quote: '游手好闲的职业' }])
    renderReader()

    await screen.findByText(/我比现在年轻十岁的时候/)
    expect(screen.queryByRole('button', { name: /你在这里记过/ })).not.toBeInTheDocument()
  })

  it('记完一笔立刻重新取，正文上马上就标出来', async () => {
    const user = userEvent.setup()
    renderReader()
    const text = await screen.findByText(/我比现在年轻十岁的时候/)
    expect(readingService.listNotes).toHaveBeenCalledTimes(1)

    selectText('游手好闲的职业')
    fireEvent.mouseUp(text)
    await user.click(await screen.findByRole('button', { name: '记一笔' }))
    readingService.listNotes.mockResolvedValue([MARKED])
    await user.type(screen.getByLabelText('写下你的感想'), '这句写得真好')
    await user.click(screen.getByRole('button', { name: '记下来' }))

    expect(await screen.findByRole('button', { name: '你在这里记过：这句写得真好' })).toBeInTheDocument()
  })

  it('删掉一条，正文上的标记跟着消失', async () => {
    const user = userEvent.setup()
    readingService.listNotes.mockResolvedValue([MARKED])
    renderReader()

    await user.click(await screen.findByRole('button', { name: '你在这里记过：这句写得真好' }))
    readingService.listNotes.mockResolvedValue([])
    await user.click(screen.getByRole('button', { name: '删掉这条笔记' }))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: '确认删除' }))

    expect(readingService.deleteNote).toHaveBeenCalledWith('n1')
    await vi.waitFor(() => expect(screen.queryByRole('button', { name: /你在这里记过/ })).not.toBeInTheDocument())
  })

  it('没有位置的笔记在目录抽屉里列着，点开就能看', async () => {
    const user = userEvent.setup()
    readingService.listNotes.mockResolvedValue([MARKED, LOOSE])
    renderReader()
    await screen.findByText(/我比现在年轻十岁的时候/)

    await user.click(screen.getByRole('button', { name: '目录与字号' }))
    const list = within(await screen.findByRole('dialog', { name: '目录' })).getByRole('navigation', { name: '这本书的笔记' })
    expect(within(list).getByText('没有位置')).toBeInTheDocument()

    await user.click(within(list).getByText('聊天里随口记的'))

    expect(within(await screen.findByRole('complementary', { name: '你在这里记过' })).getByText('聊天里随口记的')).toBeInTheDocument()
  })
})

describe('从手记回看某一处', () => {
  it('落在那一章那一处，并说明不会改掉你读到哪儿', async () => {
    renderReader('?at=1%3A5')

    expect(await screen.findByText(/那天傍晚下起了雨/)).toBeInTheDocument()
    expect(screen.getByText(/正在回看你记过的地方/)).toBeInTheDocument()
  })

  it('回看时滚动不回存进度，按下「从这儿接着读」才恢复', async () => {
    vi.useFakeTimers()
    try {
      const { container } = renderReader('?at=0%3A0')
      await vi.waitFor(() => expect(container.textContent).toContain('我比现在年轻十岁的时候'))
      const body = container.querySelector('.overflow-y-auto')
      Object.defineProperty(body, 'scrollHeight', { value: 1000, configurable: true })
      Object.defineProperty(body, 'clientHeight', { value: 500, configurable: true })
      Object.defineProperty(body, 'scrollTop', { value: 250, writable: true, configurable: true })

      fireEvent.scroll(body)
      vi.advanceTimersByTime(1200)
      expect(readingService.saveProgress).not.toHaveBeenCalled()

      fireEvent.click(screen.getByRole('button', { name: '从这儿接着读' }))
      fireEvent.scroll(body)
      vi.advanceTimersByTime(1200)

      expect(readingService.saveProgress).toHaveBeenCalledWith('b1', { locator: '0:13', percent: 25 })
    } finally {
      vi.useRealTimers()
    }
  })

  it('平常打开不是回看，照旧回存进度', async () => {
    renderReader()

    await screen.findByText(/我比现在年轻十岁的时候/)
    expect(screen.queryByText(/正在回看你记过的地方/)).not.toBeInTheDocument()
  })
})
