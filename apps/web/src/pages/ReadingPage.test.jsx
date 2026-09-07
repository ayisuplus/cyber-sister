import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  listBooks: vi.fn(),
  addBook: vi.fn(),
  updateBook: vi.fn(),
  deleteBook: vi.fn(),
  listNotes: vi.fn(),
  addNote: vi.fn(),
  deleteNote: vi.fn(),
  requestNoteComment: vi.fn(),
}))

vi.mock('../services/readingService', () => ({
  readingService: {
    listBooks: mocks.listBooks,
    addBook: mocks.addBook,
    updateBook: mocks.updateBook,
    deleteBook: mocks.deleteBook,
    listNotes: mocks.listNotes,
    addNote: mocks.addNote,
    deleteNote: mocks.deleteNote,
    requestNoteComment: mocks.requestNoteComment,
  },
}))

// 短评来源徽标依赖聊天全局状态，本页测试不关心其展示
vi.mock('../components/ui/SourceBadge', () => ({ default: () => null }))

import ReadingPage from './ReadingPage'

const BOOK = {
  id: 'b1',
  title: '活着',
  author: '余华',
  status: 'reading',
  totalPages: 200,
  currentPage: 30,
  noteCount: 1,
  createdAt: '2026-09-01T00:00:00.000Z',
}

const NOTE = {
  id: 'n1',
  bookId: 'b1',
  page: 30,
  content: '有庆那段看得心里发紧',
  aiComment: null,
  aiCommentSource: null,
  createdAt: '2026-09-02T00:00:00.000Z',
}

const renderPage = () => render(<MemoryRouter><ReadingPage /></MemoryRouter>)

describe('ReadingPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listBooks.mockResolvedValue([])
    mocks.listNotes.mockResolvedValue([])
  })

  it('shows the empty shelf hint when there are no books', async () => {
    renderPage()

    expect(await screen.findByText('书架还空着，先加一本想读的书吧')).toBeInTheDocument()
  })

  it('adds a book and clears the form', async () => {
    mocks.addBook.mockResolvedValue({ ...BOOK })
    renderPage()

    await userEvent.type(screen.getByLabelText('书名'), '活着')
    await userEvent.click(screen.getByRole('button', { name: '放上书架' }))

    await waitFor(() => expect(mocks.addBook).toHaveBeenCalledWith({ title: '活着', author: undefined, totalPages: undefined }))
    expect(screen.getByLabelText('书名')).toHaveValue('')
    expect(mocks.listBooks).toHaveBeenCalledTimes(2)
  })

  it('renders the note comment after 让姐妹看看 succeeds', async () => {
    mocks.listBooks.mockResolvedValue([BOOK])
    mocks.listNotes.mockResolvedValue([NOTE])
    mocks.requestNoteComment.mockResolvedValue({ aiComment: '这段写得真好，我也被戳了一下。', source: 'local_model', reused: false })
    renderPage()

    await screen.findByText('有庆那段看得心里发紧')
    await userEvent.click(screen.getByRole('button', { name: /让姐妹看看/ }))

    expect(await screen.findByText('这段写得真好，我也被戳了一下。')).toBeInTheDocument()
    expect(mocks.requestNoteComment).toHaveBeenCalledWith('n1')
  })

  it('points to local model settings when LOCAL_LLM_NOT_CONFIGURED', async () => {
    mocks.listBooks.mockResolvedValue([BOOK])
    mocks.listNotes.mockResolvedValue([NOTE])
    mocks.requestNoteComment.mockRejectedValue({ response: { data: { code: 'LOCAL_LLM_NOT_CONFIGURED', error: '本地模型未配置' } } })
    renderPage()

    await screen.findByText('有庆那段看得心里发紧')
    await userEvent.click(screen.getByRole('button', { name: /让姐妹看看/ }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('还没有配置本地模型')
    expect(screen.getByRole('link', { name: /本地模型/ })).toHaveAttribute('href', '/profile/local-model')
  })
})
