import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const navigate = vi.fn()
vi.mock('react-router-dom', async () => ({
  ...(await vi.importActual('react-router-dom')),
  useNavigate: () => navigate,
}))
vi.mock('../services/readingService', () => ({
  readingService: { listBooks: vi.fn(), addBook: vi.fn(), deleteBook: vi.fn() },
}))
vi.mock('../services/bookStore', () => ({
  bookStore: { listIds: vi.fn(), putBook: vi.fn(), deleteBook: vi.fn(), estimate: vi.fn() },
}))
vi.mock('../lib/epub', () => ({ readEpub: vi.fn() }))
vi.mock('../lib/plaintext', () => ({ readPlainText: vi.fn() }))

import { readingService } from '../services/readingService'
import { bookStore } from '../services/bookStore'
import { readEpub } from '../lib/epub'
import ReadingPage from './ReadingPage'

const renderPage = () => render(<MemoryRouter><ReadingPage /></MemoryRouter>)
const BOOK = { id: 'b1', title: '活着', author: '余华', status: 'reading', percent: 62, noteCount: 3 }

// jsdom 的 File 没有 arrayBuffer()，浏览器里一直有；这里补上垫片
const fileOf = (name, type) => Object.assign(new File([new Uint8Array([1, 2, 3])], name, { type }), {
  arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
})
const epubFile = () => fileOf('活着.epub', 'application/epub+zip')

beforeEach(() => {
  vi.clearAllMocks()
  readingService.listBooks.mockResolvedValue([])
  readingService.addBook.mockResolvedValue(BOOK)
  readingService.deleteBook.mockResolvedValue({ success: true })
  bookStore.listIds.mockResolvedValue(new Set())
  bookStore.putBook.mockResolvedValue(undefined)
  bookStore.deleteBook.mockResolvedValue(undefined)
  bookStore.estimate.mockResolvedValue(null)
  readEpub.mockResolvedValue({ title: '活着', author: '余华', chapters: [{ title: '第一章', text: '正文' }] })
})

describe('书架', () => {
  it('还没有书时说清楚下一步', async () => {
    renderPage()

    expect(await screen.findByText('书架还空着')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '放一本书进来' })).toBeInTheDocument()
  })

  it('列出书名、作者、进度与笔记数；文件不在本机会标出来', async () => {
    readingService.listBooks.mockResolvedValue([BOOK])
    renderPage()

    expect(await screen.findByText('活着')).toBeInTheDocument()
    expect(screen.getByText(/余华 · 在读 · 读到 62% · 3 条笔记 · 文件不在这台设备上/)).toBeInTheDocument()
  })

  it('放一本 EPUB 进来：解析后上架，文件只存在本机', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('书架还空着')

    await user.upload(screen.getByLabelText('选一本书'), epubFile())

    expect(readEpub).toHaveBeenCalled()
    expect(readingService.addBook).toHaveBeenCalledWith({
      title: '活着', author: '余华', format: 'epub', fileName: '活着.epub',
    })
    expect(bookStore.putBook).toHaveBeenCalledWith('b1', {
      fileName: '活着.epub',
      format: 'epub',
      chapters: [{ title: '第一章', text: '正文' }],
    })
    expect(await screen.findByText('《活着》放好了')).toBeInTheDocument()
  })

  it('PDF 之类先说清楚读不了，不上架', async () => {
    renderPage()
    await screen.findByText('书架还空着')

    // 系统的文件框里可以选「所有文件」，所以 accept 之外的东西也要挡住；这里绕过 accept 直接给一个 PDF
    fireEvent.change(screen.getByLabelText('选一本书'), { target: { files: [fileOf('书.pdf', 'application/pdf')] } })

    expect(await screen.findByRole('alert')).toHaveTextContent('PDF 暂时读不了')
    expect(readingService.addBook).not.toHaveBeenCalled()
  })

  it('书存不进本机时，把刚上架的那本撤掉，不留一本打不开的', async () => {
    const user = userEvent.setup()
    bookStore.putBook.mockRejectedValue(Object.assign(new Error('这台设备的存储空间不够了，先删掉一本再放'), { name: 'BookStoreError' }))
    renderPage()
    await screen.findByText('书架还空着')

    await user.upload(screen.getByLabelText('选一本书'), epubFile())

    expect(await screen.findByRole('alert')).toHaveTextContent('存储空间不够')
    expect(readingService.deleteBook).toHaveBeenCalledWith('b1')
  })

  it('本机没有文件的书点不开，先提示重新放一次', async () => {
    const user = userEvent.setup()
    readingService.listBooks.mockResolvedValue([BOOK])
    renderPage()

    await user.click(await screen.findByText('活着'))

    expect(navigate).not.toHaveBeenCalled()
    expect(await screen.findByRole('alert')).toHaveTextContent('重新放一次')
  })

  it('本机有文件就直接打开', async () => {
    const user = userEvent.setup()
    readingService.listBooks.mockResolvedValue([BOOK])
    bookStore.listIds.mockResolvedValue(new Set(['b1']))
    renderPage()

    await user.click(await screen.findByRole('button', { name: /^活着/ }))

    expect(navigate).toHaveBeenCalledWith('/tools/reading/b1')
  })

  it('删除要先确认，服务端和本机两边都清掉', async () => {
    const user = userEvent.setup()
    readingService.listBooks.mockResolvedValue([BOOK])
    renderPage()

    await user.click(await screen.findByRole('button', { name: '删除《活着》' }))
    expect(readingService.deleteBook).not.toHaveBeenCalled()

    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: '确认删除' }))

    expect(readingService.deleteBook).toHaveBeenCalledWith('b1')
    expect(bookStore.deleteBook).toHaveBeenCalledWith('b1')
  })

  it('加载失败可以重试', async () => {
    const user = userEvent.setup()
    readingService.listBooks.mockRejectedValueOnce(new Error('offline'))
    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent('书架没打开')
    await user.click(screen.getByRole('button', { name: '重试' }))

    expect(await screen.findByText('书架还空着')).toBeInTheDocument()
  })
})

describe('接着读', () => {
  it('在读又有文件的那本排在最上面，一点就接着读', async () => {
    const user = userEvent.setup()
    readingService.listBooks.mockResolvedValue([BOOK])
    bookStore.listIds.mockResolvedValue(new Set(['b1']))
    renderPage()

    const resume = await screen.findByRole('button', { name: /接着读/ })
    expect(resume).toHaveTextContent('活着')
    expect(resume).toHaveTextContent('读到 62%')

    await user.click(resume)
    expect(navigate).toHaveBeenCalledWith('/tools/reading/b1')
  })

  it('文件不在这台设备上就不摆「接着读」，免得点了打不开', async () => {
    readingService.listBooks.mockResolvedValue([BOOK])
    renderPage()

    await screen.findByRole('button', { name: /^活着/ })
    expect(screen.queryByRole('button', { name: /接着读/ })).not.toBeInTheDocument()
  })

  it('没有在读的书就不摆', async () => {
    readingService.listBooks.mockResolvedValue([{ ...BOOK, status: 'finished' }])
    bookStore.listIds.mockResolvedValue(new Set(['b1']))
    renderPage()

    await screen.findByRole('button', { name: /^活着/ })
    expect(screen.queryByRole('button', { name: /接着读/ })).not.toBeInTheDocument()
  })
})
