import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import MarginNote from './MarginNote'
import MarginNoteSetting from '../profile/MarginNoteSetting'
import { useMarginNoteStore } from '../../stores/marginNoteStore'

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
