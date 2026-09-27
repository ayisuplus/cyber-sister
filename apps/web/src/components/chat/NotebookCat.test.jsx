import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import NotebookCat, { isNight } from './NotebookCat'

// jsdom 没有 PointerEvent：补一个带 pointerType 的
class PointerEvent extends MouseEvent {
  constructor(type, init = {}) {
    super(type, init)
    this.pointerType = init.pointerType ?? 'touch'
    this.pointerId = init.pointerId ?? 1
  }
}

const cat = () => screen.getByRole('button', { name: '摸摸小猫' })
const frame = () => cat().getAttribute('data-frame')
const visibleFrame = () => [...cat().querySelectorAll('img')].find((img) => img.style.opacity === '1')?.getAttribute('src')

const stroke = (target, moves, stepMs = 0) => {
  fireEvent.pointerDown(target, { clientX: 10, clientY: 10 })
  moves.forEach((x, index) => {
    if (stepMs) act(() => { vi.advanceTimersByTime(stepMs) })
    fireEvent.pointerMove(target, { clientX: x, clientY: 10 + (index % 2) })
  })
}

describe('NotebookCat', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 8, 27, 15, 0))
    vi.stubGlobal('PointerEvent', PointerEvent)
    vi.stubGlobal('fetch', vi.fn())
    Object.defineProperty(navigator, 'vibrate', { configurable: true, writable: true, value: vi.fn(() => true) })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('平时睡着；四帧都在，只有睡着那一帧看得见，全是装饰图', () => {
    render(<NotebookCat />)
    expect(frame()).toBe('sleep')
    const images = cat().querySelectorAll('img')
    expect(images).toHaveLength(4)
    images.forEach((img) => expect(img).toHaveAttribute('alt', ''))
    expect(visibleFrame()).toBe('/design-assets/cat/cat-sleep.webp')
  })

  it('轻点：醒一下，一会儿又睡回去', () => {
    render(<NotebookCat />)
    fireEvent.pointerDown(cat(), { clientX: 10, clientY: 10 })
    fireEvent.pointerUp(cat(), { clientX: 10, clientY: 10 })
    expect(frame()).toBe('peek')
    expect(screen.getByText('小猫醒了一下')).toBeInTheDocument()
    act(() => { vi.advanceTimersByTime(1300) })
    expect(frame()).toBe('sleep')
  })

  it('来回摸：呼噜，飘出手写的「呼噜呼噜…」，手机上轻轻震一下；松手后睡回去', () => {
    render(<NotebookCat />)
    stroke(cat(), [40, 10, 40])
    expect(frame()).toBe('purr')
    expect(screen.getByText('呼噜呼噜…')).toBeInTheDocument()
    expect(navigator.vibrate).toHaveBeenCalledTimes(1)
    fireEvent.pointerUp(cat(), { clientX: 40, clientY: 10 })
    act(() => { vi.advanceTimersByTime(1600) })
    expect(frame()).toBe('sleep')
    expect(screen.queryByText('呼噜呼噜…')).not.toBeInTheDocument()
  })

  it('一直摸：呼噜时震动有节制，摸久了伸个懒腰', () => {
    render(<NotebookCat />)
    stroke(cat(), [40, 10, 40, 10, 40, 10, 40], 500)
    expect(frame()).toBe('stretch')
    // 3 秒里最多震三次（开始一次，之后每 1.2 秒一次）
    expect(navigator.vibrate.mock.calls.length).toBeLessThanOrEqual(3)
  })

  it('连点三下也算在摸', () => {
    render(<NotebookCat />)
    for (let i = 0; i < 3; i += 1) {
      fireEvent.pointerDown(cat(), { clientX: 10, clientY: 10 })
      fireEvent.pointerUp(cat(), { clientX: 10, clientY: 10 })
    }
    expect(frame()).toBe('purr')
  })

  it('键盘回车也能摸（不震动）', () => {
    render(<NotebookCat />)
    fireEvent.click(cat(), { detail: 0 })
    expect(frame()).toBe('purr')
    expect(navigator.vibrate).not.toHaveBeenCalled()
  })

  it('摸它不会翻页：手势不传给外面的信纸', () => {
    const outerDown = vi.fn()
    const outerUp = vi.fn()
    render(<div onPointerDown={outerDown} onPointerUp={outerUp}><NotebookCat /></div>)
    stroke(cat(), [40, 10])
    fireEvent.pointerUp(cat(), { clientX: 10, clientY: 10 })
    expect(outerDown).not.toHaveBeenCalled()
    expect(outerUp).not.toHaveBeenCalled()
  })

  it('不发请求、不存东西、不计数', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    render(<NotebookCat />)
    stroke(cat(), [40, 10, 40])
    fireEvent.pointerUp(cat(), { clientX: 40, clientY: 10 })
    expect(fetch).not.toHaveBeenCalled()
    expect(setItem).not.toHaveBeenCalled()
    expect(document.body.textContent).not.toMatch(/\d+\s*次/)
  })

  it('画没加载出来就整只不显示，不留破图', () => {
    render(<NotebookCat />)
    fireEvent.error(cat().querySelector('img[src$="cat-sleep.webp"]'))
    expect(screen.queryByRole('button', { name: '摸摸小猫' })).not.toBeInTheDocument()
  })

  it('深夜是 22 点到清晨 5 点', () => {
    expect([21, 22, 3, 4, 5].map(isNight)).toEqual([false, true, true, true, false])
  })
})
