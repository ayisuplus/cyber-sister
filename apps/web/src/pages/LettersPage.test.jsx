import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../services/letterService', () => ({
  letterService: { list: vi.fn(), get: vi.fn(), generate: vi.fn() },
}))

import { letterService } from '../services/letterService'
import LettersPage from './LettersPage'

const LETTERS = [
  {
    id: 'l2',
    weekStart: '2026-09-07T00:00:00.000Z',
    content: '小赛，见信好。\n\n这周你们聊了 23 轮。\n\n—— 你的姐妹',
    createdAt: '2026-09-09T08:00:00.000Z',
  },
  {
    id: 'l1',
    weekStart: '2026-08-31T00:00:00.000Z',
    content: '上周的信内容',
    createdAt: '2026-09-02T08:00:00.000Z',
  },
]

const renderPage = () => render(<MemoryRouter><LettersPage /></MemoryRouter>)

describe('LettersPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    letterService.list.mockResolvedValue({ letters: LETTERS })
  })

  it('renders letters with the latest expanded and older collapsed', async () => {
    renderPage()

    expect(await screen.findByText('9月7日那周的信')).toBeInTheDocument()
    expect(screen.getByText(/这周你们聊了 23 轮/)).toBeInTheDocument()
    expect(screen.getByText('8月31日那周的信')).toBeInTheDocument()
    expect(screen.queryByText('上周的信内容')).not.toBeInTheDocument()
  })

  it('toggles an older letter open on click', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('8月31日那周的信')

    await user.click(screen.getByRole('button', { name: /8月31日那周的信/ }))

    expect(await screen.findByText('上周的信内容')).toBeInTheDocument()
    expect(screen.queryByText(/这周你们聊了 23 轮/)).not.toBeInTheDocument()
  })

  it('shows the honest empty state when no letters yet', async () => {
    letterService.list.mockResolvedValue({ letters: [] })
    renderPage()

    expect(await screen.findByText(/还没到能写信的时候/)).toBeInTheDocument()
  })

  it('shows a load error', async () => {
    letterService.list.mockRejectedValue(new Error('offline'))
    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent('加载失败，请检查网络后重试')
  })
})
