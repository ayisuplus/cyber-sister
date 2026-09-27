import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../services/petService', () => ({
  petService: { list: vi.fn(), pet: vi.fn(), claimDaily: vi.fn(), adopt: vi.fn(), setActive: vi.fn(), rename: vi.fn(), feed: vi.fn() },
}))

import { petService } from '../../services/petService'
import { usePetStore } from '../../stores/petStore'
import { isNight } from '../../features/pets'
import NotebookCat from './NotebookCat'

// jsdom 没有 PointerEvent：补一个带 pointerType 的
class PointerEvent extends MouseEvent {
  constructor(type, init = {}) {
    super(type, init)
    this.pointerType = init.pointerType ?? 'touch'
    this.pointerId = init.pointerId ?? 1
  }
}

const NONE = { food: 0, foodCap: 30, dailyFood: 3, claimedToday: false, active: null, pets: [] }
const DOG = { species: 'dog', name: '豆豆', affection: 3, growth: 0, stage: { index: 0, name: '小不点', from: 0, to: 100 }, hearts: 0, pettedToday: 0, petCap: 10 }

const cat = () => screen.getByRole('button', { name: /^摸摸/ })
const mood = () => cat().getAttribute('data-mood')
const visibleFrame = () => [...cat().querySelectorAll('img')].find((img) => img.style.opacity === '1')?.getAttribute('src')

const stroke = (target, moves, stepMs = 0) => {
  fireEvent.pointerDown(target, { clientX: 10, clientY: 10 })
  moves.forEach((x, index) => {
    if (stepMs) act(() => { vi.advanceTimersByTime(stepMs) })
    fireEvent.pointerMove(target, { clientX: x, clientY: 10 + (index % 2) })
  })
}

const renderWith = async (data) => {
  petService.list.mockResolvedValue(data)
  render(<NotebookCat />)
  await act(async () => { await Promise.resolve() })
}

describe('NotebookCat', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 8, 27, 15, 0))
    vi.stubGlobal('PointerEvent', PointerEvent)
    vi.clearAllMocks()
    usePetStore.getState().reset()
    Object.defineProperty(navigator, 'vibrate', { configurable: true, writable: true, value: vi.fn(() => true) })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('还没养宠物：是封面那只小猫，四帧都在，平时睡着，全是装饰图', async () => {
    await renderWith(NONE)
    expect(cat()).toHaveAccessibleName('摸摸小猫')
    expect(mood()).toBe('idle')
    const images = cat().querySelectorAll('img')
    expect(images).toHaveLength(4)
    images.forEach((img) => expect(img).toHaveAttribute('alt', ''))
    expect(visibleFrame()).toBe('/design-assets/pets/cat/sleep-sm.webp')
  })

  it('养了宠物：本子角上换成你养的那一只', async () => {
    await renderWith({ ...NONE, active: 'dog', pets: [DOG] })
    expect(cat()).toHaveAccessibleName('摸摸豆豆')
    expect(cat()).toHaveAttribute('data-species', 'dog')
    expect(visibleFrame()).toBe('/design-assets/pets/dog/sleep-sm.webp')
  })

  it('轻点：醒一下，一会儿又睡回去', async () => {
    await renderWith(NONE)
    fireEvent.pointerDown(cat(), { clientX: 10, clientY: 10 })
    fireEvent.pointerUp(cat(), { clientX: 10, clientY: 10 })
    expect(mood()).toBe('peek')
    expect(visibleFrame()).toBe('/design-assets/pets/cat/awake-sm.webp')
    expect(screen.getByText('小猫醒了一下')).toBeInTheDocument()
    act(() => { vi.advanceTimersByTime(1300) })
    expect(mood()).toBe('idle')
  })

  it('来回摸：呼噜，飘出手写的「呼噜呼噜…」，手机上轻轻震一下；松手后睡回去', async () => {
    await renderWith(NONE)
    stroke(cat(), [40, 10, 40])
    expect(mood()).toBe('purr')
    expect(screen.getByText('呼噜呼噜…')).toBeInTheDocument()
    expect(navigator.vibrate).toHaveBeenCalledTimes(1)
    fireEvent.pointerUp(cat(), { clientX: 40, clientY: 10 })
    act(() => { vi.advanceTimersByTime(1600) })
    expect(mood()).toBe('idle')
    expect(screen.queryByText('呼噜呼噜…')).not.toBeInTheDocument()
  })

  it('一直摸：震动有节制，摸久了伸个懒腰（小猫有专门的一帧）', async () => {
    await renderWith(NONE)
    stroke(cat(), [40, 10, 40, 10, 40, 10, 40], 500)
    expect(mood()).toBe('stretch')
    expect(visibleFrame()).toBe('/design-assets/pets/cat/stretch-sm.webp')
    expect(navigator.vibrate.mock.calls.length).toBeLessThanOrEqual(3)
  })

  it('连点三下也算在摸；键盘回车也能摸（不震动）', async () => {
    await renderWith(NONE)
    for (let i = 0; i < 3; i += 1) {
      fireEvent.pointerDown(cat(), { clientX: 10, clientY: 10 })
      fireEvent.pointerUp(cat(), { clientX: 10, clientY: 10 })
    }
    expect(mood()).toBe('purr')
    act(() => { vi.advanceTimersByTime(1600) })
    navigator.vibrate.mockClear()
    fireEvent.click(cat(), { detail: 0 })
    expect(mood()).toBe('purr')
    expect(navigator.vibrate).not.toHaveBeenCalled()
  })

  it('摸它不会翻页：手势不传给外面的信纸', async () => {
    petService.list.mockResolvedValue(NONE)
    const outerDown = vi.fn()
    const outerUp = vi.fn()
    render(<div onPointerDown={outerDown} onPointerUp={outerUp}><NotebookCat /></div>)
    await act(async () => { await Promise.resolve() })
    stroke(cat(), [40, 10])
    fireEvent.pointerUp(cat(), { clientX: 10, clientY: 10 })
    expect(outerDown).not.toHaveBeenCalled()
    expect(outerUp).not.toHaveBeenCalled()
  })

  it('没养宠物时摸了不记数、不发请求', async () => {
    await renderWith(NONE)
    stroke(cat(), [40, 10, 40])
    fireEvent.pointerUp(cat(), { clientX: 40, clientY: 10 })
    expect(petService.pet).not.toHaveBeenCalled()
  })

  it('养了宠物：一段摸只报一次好感，长了就飘一颗小心', async () => {
    petService.pet.mockResolvedValue({ pet: { ...DOG, affection: 4, pettedToday: 1 }, gained: 1 })
    await renderWith({ ...NONE, active: 'dog', pets: [DOG] })
    stroke(cat(), [40, 10, 40, 10, 40])
    fireEvent.pointerUp(cat(), { clientX: 40, clientY: 10 })
    await act(async () => { await Promise.resolve() })
    expect(petService.pet).toHaveBeenCalledTimes(1)
    expect(petService.pet).toHaveBeenCalledWith('dog')
    expect(screen.getByText('♥ +1')).toBeInTheDocument()
    expect(usePetStore.getState().pets[0].affection).toBe(4)
  })

  it('画没加载出来就整只不显示，不留破图', async () => {
    await renderWith(NONE)
    fireEvent.error(cat().querySelector('img[src$="sleep-sm.webp"]'))
    expect(screen.queryByRole('button', { name: /^摸摸/ })).not.toBeInTheDocument()
  })

  it('深夜是 22 点到清晨 5 点', () => {
    expect([21, 22, 3, 4, 5].map(isNight)).toEqual([false, true, true, true, false])
  })
})
