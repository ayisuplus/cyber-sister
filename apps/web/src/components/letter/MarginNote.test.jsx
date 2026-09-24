import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import MarginNote from './MarginNote'
import MarginNoteSetting from '../profile/MarginNoteSetting'
import { useMarginNoteStore } from '../../stores/marginNoteStore'
import { bookStore } from '../../services/bookStore'

vi.mock('../../services/bookStore', () => ({ bookStore: { listIds: vi.fn(() => Promise.resolve(new Set())) } }))

const TWO_BOOKS = [
  {
    book: 'body-care',
    title: '女生呵护指南',
    author: '六层楼',
    edition: '浙江科学技术出版社，2019',
    setAside: '性别本质化、羞辱与夸张恐吓',
    boundary: 'Amie 选择性改编，一般健康信息，不是诊断或医疗服务。',
    chapters: [{ id: 'ch02-period', title: '经期与记录', origin: '第二章', use: '月经、痛经、经前变化' }],
  },
  {
    book: 'emotion-reflection',
    title: '嫉羡与感恩',
    author: '梅兰妮·克莱因',
    edition: '九州出版社，2017',
    setAside: '死本能等病因推论作为事实',
    boundary: 'Amie 选择性改编，理论参考，不是诊断或治疗。',
    chapters: [{ id: 'repair', title: '内疚与修复', origin: '第二章', use: '责任核实与有限补救' }],
  },
]

afterEach(() => {
  localStorage.clear()
  useMarginNoteStore.setState({ marginNotes: 'on' })
})

describe('页边铅笔批注', () => {
  it('一行写出翻过哪本书的哪一章；点开是书签小卡，再点收起', async () => {
    const user = userEvent.setup()
    render(<MarginNote notes={TWO_BOOKS} />)
    const toggle = screen.getByRole('button', { name: '她写这段时翻过的书 · 《女生呵护指南》第二章；《嫉羡与感恩》第二章' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText(/没有采纳/)).not.toBeInTheDocument()

    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    const card = document.getElementById(toggle.getAttribute('aria-controls'))
    expect(card).toHaveTextContent('《嫉羡与感恩》 · 梅兰妮·克莱因 · 九州出版社，2017')
    expect(card).toHaveTextContent('第二章 · 内疚与修复：责任核实与有限补救')
    expect(card).toHaveTextContent('没有采纳：死本能等病因推论作为事实')
    expect(card).toHaveTextContent('Amie 选择性改编，一般健康信息，不是诊断或医疗服务。')

    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText(/没有采纳/)).not.toBeInTheDocument()
  })

  it('小卡压在这一页上，不挤动分页；按 Esc 或点别处就收起', async () => {
    const user = userEvent.setup()
    render(<><MarginNote notes={TWO_BOOKS} /><p>别处</p></>)
    const toggle = screen.getByRole('button', { name: /她写这段时翻过的书/ })

    await user.click(toggle)
    expect(document.getElementById(toggle.getAttribute('aria-controls'))).toHaveAttribute('data-placement', 'below')
    await user.keyboard('{Escape}')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')

    await user.click(toggle)
    await user.click(screen.getByText('别处'))
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
  })

  it('只点名了书、没翻到具体章时只写书名', () => {
    render(<MarginNote notes={[{ ...TWO_BOOKS[1], chapters: [] }]} />)
    expect(screen.getByRole('button', { name: '她写这段时翻过的书 · 《嫉羡与感恩》' })).toBeInTheDocument()
  })

  it('没有批注或数据不对时什么都不画', () => {
    const { container, rerender } = render(<MarginNote notes={null} />)
    expect(container).toBeEmptyDOMElement()
    rerender(<MarginNote notes={[{ title: 42 }, 'x']} />)
    expect(container).toBeEmptyDOMElement()
  })
})

const HER_BOOK = {
  book: 'user:b1',
  userBook: true,
  bookId: 'b1',
  title: '被讨厌的勇气',
  author: '岸见一郎',
  chapters: [{ id: 'p1', title: '课题分离', origin: '第 2 章', locator: '1:120' }],
}

describe('页边批注：她自己放进书架的书', () => {
  it('写第几章、注明 Amie 没审校；没有用途和「没采纳」', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><MarginNote notes={[HER_BOOK]} /></MemoryRouter>)
    const toggle = screen.getByRole('button', { name: '她写这段时翻过的书 · 《被讨厌的勇气》第 2 章' })

    await user.click(toggle)
    const card = document.getElementById(toggle.getAttribute('aria-controls'))
    expect(card).toHaveTextContent('《被讨厌的勇气》 · 岸见一郎')
    expect(card).toHaveTextContent('第 2 章 · 课题分离')
    expect(card).toHaveTextContent('这是你放进书架的书，Amie 没有审校它的内容。')
    expect(card).not.toHaveTextContent('没有采纳')
    expect(screen.queryByRole('link', { name: '翻到这一段' })).not.toBeInTheDocument()
  })

  it('书在这台设备上时，可以翻到那一段', async () => {
    const user = userEvent.setup()
    bookStore.listIds.mockResolvedValueOnce(new Set(['b1']))
    render(<MemoryRouter><MarginNote notes={[HER_BOOK]} /></MemoryRouter>)

    await user.click(screen.getByRole('button', { name: /她写这段时翻过的书/ }))

    expect(await screen.findByRole('link', { name: '翻到这一段' })).toHaveAttribute('href', '/tools/reading/b1?at=1%3A120&from=margin')
  })
})

describe('设置里的页边批注开关', () => {
  it('默认有；关掉立刻生效，这台设备记住', async () => {
    const user = userEvent.setup()
    render(<MarginNoteSetting />)
    expect(screen.getByRole('radio', { name: '页边批注：有' })).toBeChecked()

    await user.click(screen.getByRole('radio', { name: '页边批注：没有' }))
    expect(useMarginNoteStore.getState().marginNotes).toBe('off')
    expect(localStorage.getItem('amie-margin-notes')).toBe('off')
  })
})
