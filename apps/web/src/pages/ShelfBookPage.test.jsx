import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../services/readingService', () => ({ readingService: { getShelfBook: vi.fn() } }))

import { readingService } from '../services/readingService'
import ShelfBookPage from './ShelfBookPage'

const BOOK = {
  name: 'emotional-first-aid',
  title: '情绪急救',
  author: '盖伊·温奇',
  edition: '上海社会科学院出版社，2015',
  boundary: 'Amie 选择性改编，日常心理伤口的一般处理方法，不是诊断或治疗。',
  setAside: '按恋爱时长推算恢复期',
  chapters: [{ id: 'loss', title: '失去与分手', origin: '第三章', use: '失去之后按她自己的方式伤心', content: '# 失去与分手\n\n先问清她此刻想怎样。' }],
}

const renderPage = () => render(
  <MemoryRouter initialEntries={['/tools/reading/shelf/emotional-first-aid']}>
    <Routes><Route path="/tools/reading/shelf/:name" element={<ShelfBookPage />} /></Routes>
  </MemoryRouter>
)

beforeEach(() => {
  vi.clearAllMocks()
  readingService.getShelfBook.mockResolvedValue(BOOK)
})

describe('Amie 的藏书：点开一本', () => {
  it('写清出处、边界和没采纳的部分；章节点开是改编正文', async () => {
    const user = userEvent.setup()
    renderPage()

    expect(await screen.findByText('盖伊·温奇 · 上海社会科学院出版社，2015')).toBeInTheDocument()
    expect(readingService.getShelfBook).toHaveBeenCalledWith('emotional-first-aid')
    expect(screen.getByText(BOOK.boundary)).toBeInTheDocument()
    expect(screen.getByText('没有采纳：按恋爱时长推算恢复期')).toBeInTheDocument()

    await user.click(screen.getByText('失去与分手'))
    expect(screen.getByText('原书第三章 · 失去之后按她自己的方式伤心')).toBeInTheDocument()
    expect(screen.getByText('先问清她此刻想怎样。')).toBeVisible()
  })

  it('打不开时给回书架的路', async () => {
    readingService.getShelfBook.mockRejectedValue(new Error('404'))
    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent('这本书没打开')
    expect(screen.getByRole('button', { name: '回书架' })).toBeInTheDocument()
  })
})
