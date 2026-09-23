import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import LetterPad from './LetterPad'
import { pageGeometry, pageLabel, pageOf } from './pagedLayout'

// jsdom 不排版：用替身给出纸的尺寸，并让结尾标记落在第 pages 页（一页宽 400px，步长正好是一页）
const paper = { width: 400, height: 34 * 12, pages: 3 }
const rect = (left) => ({ left, right: left + 1, top: 0, bottom: 1, width: 1, height: 1, x: left, y: 0, toJSON() {} })

function Letter({ items, hasOlder = false, onLoadOlder, cover = null }) {
  return (
    <>
      <LetterPad
        cover={cover}
        firstKey={items[0]}
        lastKey={items.at(-1)}
        lastVersion={`${items.at(-1)}:${items.length}`}
        hasOlder={hasOlder}
        onLoadOlder={onLoadOlder}
      >
        {items.map((item, index) => <p key={item} data-page={index % paper.pages}><a href={`#${item}`}>{item}</a></p>)}
      </LetterPad>
      <textarea aria-label="聊天消息" />
    </>
  )
}

const strip = () => document.querySelector('.letter-strip')
const host = () => document.querySelector('.letter-ghost-host')
const label = () => screen.getByRole('navigation', { name: '翻页' })
// 翻页的拓印也留在 DOM 里，查封面要只看信纸这一层
const viewport = () => screen.getByRole('region', { name: '信纸' })
const cover = () => within(viewport()).queryByText('封面上的她')

// jsdom 没有 PointerEvent：补一个带 pointerType 的
class PointerEvent extends MouseEvent {
  constructor(type, init = {}) {
    super(type, init)
    this.pointerType = init.pointerType ?? 'mouse'
  }
}

beforeEach(() => {
  vi.stubGlobal('PointerEvent', PointerEvent)
  paper.width = 400
  paper.pages = 3
  vi.stubGlobal('requestAnimationFrame', (callback) => { callback(0); return 1 })
  vi.stubGlobal('cancelAnimationFrame', () => {})
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function width() {
    return this.classList.contains('letter-viewport') ? paper.width : 0
  })
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function height() {
    return this.classList.contains('letter-viewport') ? paper.height : 0
  })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function position() {
    if (this.classList.contains('letter-end')) return rect((paper.pages - 1) * paper.width + 5)
    const page = this.closest('[data-page]')?.dataset.page
    return rect(page === undefined ? 0 : Number(page) * paper.width + 5)
  })
  // 纸带里「有没有真的写出东西」看这个：jsdom 里只有写了字的段落算占地方
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function rects() {
    return this.matches('[data-page]') ? [rect(0)] : []
  })
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('本子的版面', () => {
  it('高度取整到整行，顶上留一行；一次只有一页；页码写法', () => {
    expect(pageGeometry(400, 34 * 12 + 20, 34)).toMatchObject({ columnWidth: 328, gap: 72, pageWidth: 400, pageHeight: 34 * 11 })
    // 宽屏也只摊开一页：一页就是整个纸宽
    expect(pageGeometry(960, 600, 36)).toMatchObject({ columnWidth: 888, pageWidth: 960 })
    expect(pageGeometry(0, 600)).toBeNull()
    expect(pageOf(805, { pageWidth: 400 })).toBe(2)
    expect(pageLabel(2, 8)).toMatchObject({ text: '3 / 8', sr: '第 3 页，共 8 页' })
    expect(pageLabel(0, 8, true)).toMatchObject({ text: '封面', sr: '封面' })
    expect(pageLabel(1, 8, true)).toMatchObject({ text: '1 / 8' })
    expect(pageLabel(99, 8)).toMatchObject({ text: '8 / 8' })
  })
})

describe('翻页', () => {
  it('打开就在最新一页；往后翻是眼前这一页绕左边封线翻过去', async () => {
    const user = userEvent.setup()
    render(<Letter items={['a', 'b', 'c']} />)

    expect(label()).toHaveTextContent('3 / 3')
    expect(strip()).toHaveStyle({ transform: 'translateX(-800px)' })
    expect(screen.getByRole('button', { name: '下一页' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: '上一页' }))
    expect(label()).toHaveTextContent('2 / 3')
    expect(strip()).toHaveStyle({ transform: 'translateX(-400px)' })
    const ghost = document.querySelector('.letter-ghost--back')
    expect(ghost).toHaveAttribute('aria-hidden', 'true')
    expect(ghost.querySelector('[role="region"]')).toBeNull()
    // 翻动层在给景深的父层里（绕左边封线的旋转写在 CSS）
    expect(host()).toContainElement(ghost)
  })

  it('往前翻是两层：旧页的静影 + 从左边翻回来的新一页', async () => {
    const user = userEvent.setup()
    render(<Letter items={['a', 'b', 'c']} />)

    await user.click(screen.getByRole('button', { name: '上一页' }))
    expect(host().children).toHaveLength(2)
    const still = host().firstElementChild
    expect(still).toHaveClass('letter-ghost')
    expect(still.className).not.toContain('letter-ghost--')
    expect(still).toHaveAttribute('aria-hidden', 'true')
    expect(host().lastElementChild).toHaveClass('letter-ghost--back')
  })

  it('在最后一页时，新写的字把这一页写满就自动翻过去', async () => {
    const { rerender } = render(<Letter items={['a', 'b', 'c']} />)
    expect(label()).toHaveTextContent('3 / 3')

    paper.pages = 4
    await act(async () => rerender(<Letter items={['a', 'b', 'c', 'd']} />))
    expect(label()).toHaveTextContent('4 / 4')
    expect(document.querySelector('.letter-ghost--forward')).not.toBeNull()
  })

  it('往回翻看时她回信了：不拽走你，只亮出「翻到最新一页」', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<Letter items={['a', 'b', 'c']} />)
    await user.click(screen.getByRole('button', { name: '上一页' }))

    paper.pages = 4
    await act(async () => rerender(<Letter items={['a', 'b', 'c', 'd']} />))
    expect(label()).toHaveTextContent('2 / 4')
    await user.click(screen.getByRole('button', { name: '她回信了 · 翻到最新一页' }))
    expect(label()).toHaveTextContent('4 / 4')
    expect(screen.queryByRole('button', { name: '她回信了 · 翻到最新一页' })).not.toBeInTheDocument()
  })

  it('翻到第一页还要往前：取更早的信，取回后往前翻一页，内容不跳', async () => {
    const user = userEvent.setup()
    let resolve
    const onLoadOlder = vi.fn(() => new Promise((done) => { resolve = done }))
    paper.pages = 1
    const { rerender } = render(<Letter items={['c']} hasOlder onLoadOlder={onLoadOlder} />)
    expect(label()).toHaveTextContent('1 / 1')

    await user.click(screen.getByRole('button', { name: '上一页' }))
    expect(onLoadOlder).toHaveBeenCalledOnce()
    expect(label()).toHaveTextContent('正在翻出更早的信')

    paper.pages = 3
    await act(async () => {
      rerender(<Letter items={['a', 'b', 'c']} hasOlder={false} onLoadOlder={onLoadOlder} />)
      resolve()
    })
    // 新取回两页；原来那一页变成第 3 页，往前翻一页就是第 2 页
    expect(label()).toHaveTextContent('2 / 3')
  })

  it('没有更早的信时，第一页的「上一页」是灰的', () => {
    paper.pages = 1
    render(<Letter items={['a']} />)
    expect(screen.getByRole('button', { name: '上一页' })).toBeDisabled()
  })

  it('键盘 ← → 翻页；在输入框里打字时不翻', async () => {
    const user = userEvent.setup()
    render(<Letter items={['a', 'b', 'c']} />)
    fireEvent.keyDown(document.body, { key: 'ArrowLeft' })
    expect(label()).toHaveTextContent('2 / 3')
    fireEvent.keyDown(document.body, { key: 'PageDown' })
    expect(label()).toHaveTextContent('3 / 3')

    await user.click(screen.getByRole('textbox', { name: '聊天消息' }))
    await user.keyboard('{ArrowLeft}')
    expect(label()).toHaveTextContent('3 / 3')
  })

  it('用 Tab 移到别的页上的链接时，翻到那一页', () => {
    render(<Letter items={['a', 'b', 'c']} />)
    act(() => screen.getByRole('link', { name: 'a' }).focus())
    expect(label()).toHaveTextContent('1 / 3')
  })

  it('手机上左滑往后、右滑往前；鼠标拖动不算', () => {
    render(<Letter items={['a', 'b', 'c']} />)
    const viewport = screen.getByRole('region', { name: '信纸' })
    fireEvent.pointerDown(viewport, { pointerType: 'touch', clientX: 100, clientY: 100 })
    fireEvent.pointerUp(viewport, { pointerType: 'touch', clientX: 220, clientY: 110 })
    expect(label()).toHaveTextContent('2 / 3')
    fireEvent.pointerDown(viewport, { pointerType: 'mouse', clientX: 300, clientY: 100 })
    fireEvent.pointerUp(viewport, { pointerType: 'mouse', clientX: 100, clientY: 100 })
    expect(label()).toHaveTextContent('2 / 3')
  })

  it('字体到了、版面重排导致页数变多：直接翻到最新一页，不播翻页动画', async () => {
    const { rerender } = render(<Letter items={['a', 'b', 'c']} />)
    paper.pages = 4
    // 内容没变，只是重排（比如手写字体加载完）：换个宽度触发重新分页
    paper.width = 401
    await act(async () => rerender(<Letter items={['a', 'b', 'c']} />))
    window.dispatchEvent(new Event('resize'))
    document.querySelector('.letter-strip').append(document.createTextNode(''))
    await act(async () => {})
    expect(label()).toHaveTextContent('4 / 4')
    expect(document.querySelector('.letter-ghost')).toBeNull()
  })

  it('读屏读得到页码', () => {
    render(<Letter items={['a', 'b', 'c']} />)
    expect(screen.getByText('第 3 页，共 3 页')).toHaveClass('sr-only')
  })

  it('量不出尺寸时就是一页，不平移，内容照常可读', () => {
    paper.width = 0
    render(<Letter items={['a', 'b']} />)
    expect(label()).toHaveTextContent('1 / 1')
    expect(strip()).toHaveStyle({ transform: 'none' })
    expect(screen.getByRole('link', { name: 'b' })).toBeInTheDocument()
  })
})

describe('封面', () => {
  it('封面是第 0 页，页码写「封面」；空对话就停在封面，底下的信纸不参与点选与读屏', () => {
    render(<Letter items={[]} cover={<p>封面上的她</p>} />)

    expect(cover()).toBeInTheDocument()
    expect(label()).toHaveTextContent('封面')
    expect(strip()).toHaveAttribute('inert')
    expect(strip()).toHaveStyle({ transform: 'none' })
    expect(screen.getByRole('button', { name: '下一页' })).toBeDisabled()
  })

  it('点开场话题写下去，就翻开到第一页', async () => {
    paper.pages = 1
    const { rerender } = render(<Letter items={[]} cover={<p>封面上的她</p>} />)
    expect(label()).toHaveTextContent('封面')

    await act(async () => rerender(<Letter items={['a']} cover={<p>封面上的她</p>} />))
    expect(label()).toHaveTextContent('1 / 1')
    expect(cover()).not.toBeInTheDocument()
    expect(strip()).not.toHaveAttribute('inert')
    expect(strip()).toHaveStyle({ transform: 'none' })
  })

  it('有对话时打开仍在最新一页；一直往前翻，翻过最早的信就回到封面', async () => {
    const user = userEvent.setup()
    render(<Letter items={['a', 'b', 'c']} cover={<p>封面上的她</p>} />)
    expect(label()).toHaveTextContent('3 / 3')

    await user.click(screen.getByRole('button', { name: '上一页' }))
    await user.click(screen.getByRole('button', { name: '上一页' }))
    expect(label()).toHaveTextContent('1 / 3')

    await user.click(screen.getByRole('button', { name: '上一页' }))
    expect(label()).toHaveTextContent('封面')
    expect(cover()).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '上一页' })).toBeDisabled()
  })

  it('还有更早的信时，第一页的「上一页」先去取更早的信，不是回封面', async () => {
    const user = userEvent.setup()
    let resolve
    const onLoadOlder = vi.fn(() => new Promise((done) => { resolve = done }))
    paper.pages = 1
    render(<Letter items={['a']} cover={<p>封面上的她</p>} hasOlder onLoadOlder={onLoadOlder} />)
    await user.click(screen.getByRole('button', { name: '上一页' }))
    expect(onLoadOlder).toHaveBeenCalledOnce()
    expect(label()).toHaveTextContent('正在翻出更早的信')
    expect(cover()).not.toBeInTheDocument()
    await act(async () => resolve())
  })
})
