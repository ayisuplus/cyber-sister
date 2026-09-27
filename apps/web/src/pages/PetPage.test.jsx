import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../services/petService', () => ({
  petService: { list: vi.fn(), claimDaily: vi.fn(), adopt: vi.fn(), setActive: vi.fn(), rename: vi.fn(), feed: vi.fn(), pet: vi.fn() },
}))

import { petService } from '../services/petService'
import { usePetStore } from '../stores/petStore'
import PetPage from './PetPage'

const stage = (index = 0) => [
  { index: 0, name: '小不点', from: 0, to: 100 },
  { index: 1, name: '小可爱', from: 100, to: 300 },
][index]
const cat = (overrides = {}) => ({ species: 'cat', name: '团子', affection: 12, growth: 40, stage: stage(0), hearts: 1, pettedToday: 0, petCap: 10, ...overrides })
const state = (overrides = {}) => ({ food: 2, foodCap: 30, dailyFood: 3, claimedToday: true, active: 'cat', pets: [cat()], ...overrides })

const renderPage = () => render(<MemoryRouter><PetPage /></MemoryRouter>)

describe('PetPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    usePetStore.getState().reset()
    vi.setSystemTime(new Date(2026, 8, 27, 15, 0))
  })

  it('还没养：挑一只、起名字、带回家；带回来就领今天的零食', async () => {
    const user = userEvent.setup()
    petService.list.mockResolvedValue(state({ active: null, pets: [], claimedToday: false, food: 0 }))
    petService.adopt.mockResolvedValue(state({ active: 'rabbit', pets: [cat({ species: 'rabbit', name: '棉花糖' })], claimedToday: false, food: 0 }))
    petService.claimDaily.mockResolvedValue({ granted: 3, ...state({ active: 'rabbit', pets: [cat({ species: 'rabbit', name: '棉花糖' })], food: 3 }) })
    renderPage()

    expect(await screen.findByText('挑一只带回家吧')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '小兔' }))
    const name = screen.getByRole('textbox', { name: '给它起个名字' })
    expect(name).toHaveValue('棉花')
    await user.clear(name)
    await user.type(name, '棉花糖')
    await user.click(screen.getByRole('button', { name: '带它回家' }))

    expect(petService.adopt).toHaveBeenCalledWith('rabbit', '棉花糖')
    expect(await screen.findByRole('heading', { name: '棉花糖' })).toBeInTheDocument()
    expect(await screen.findByText('今天的胡萝卜到啦 +3')).toBeInTheDocument()
    expect(screen.getByText('还剩 3 份 · 每天来领 3 份')).toBeInTheDocument()
  })

  it('养着一只：名字、阶段、好感度的心、成长值进度都在；今天领过就不再提示', async () => {
    petService.list.mockResolvedValue(state())
    petService.claimDaily.mockResolvedValue({ granted: 0, ...state() })
    renderPage()
    expect(await screen.findByRole('heading', { name: '团子' })).toBeInTheDocument()
    expect(screen.getByText('小不点')).toBeInTheDocument()
    expect(screen.getByText('好感度 12，1 颗心')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: '成长值' })).toHaveAttribute('aria-valuenow', '40')
    expect(screen.getByText('40 / 100')).toBeInTheDocument()
    await act(async () => { await Promise.resolve() })
    expect(screen.queryByText(/到啦/)).not.toBeInTheDocument()
    expect(screen.getByText(/只会往上涨/)).toBeInTheDocument()
  })

  it('喂一口：换成吃东西的那一帧，成长值上涨，零食少一份', async () => {
    const user = userEvent.setup()
    petService.list.mockResolvedValue(state())
    petService.claimDaily.mockResolvedValue({ granted: 0, ...state() })
    petService.feed.mockResolvedValue({ pet: cat({ growth: 50, affection: 14 }), food: 1, gained: { growth: 10, affection: 2 }, grewUp: false })
    renderPage()
    await user.click(await screen.findByRole('button', { name: /喂一口小鱼干/ }))
    expect(petService.feed).toHaveBeenCalledWith('cat')
    expect(screen.getByRole('button', { name: '摸摸团子' })).toHaveAttribute('data-frame', 'eat')
    expect(await screen.findByText('成长 +10')).toBeInTheDocument()
    expect(screen.getByText('50 / 100')).toBeInTheDocument()
    expect(screen.getByText('还剩 1 份 · 每天来领 3 份')).toBeInTheDocument()
  })

  it('零食吃完了：按钮说明天再来，不能点', async () => {
    petService.list.mockResolvedValue(state({ food: 0 }))
    petService.claimDaily.mockResolvedValue({ granted: 0, ...state({ food: 0 }) })
    renderPage()
    expect(await screen.findByRole('button', { name: /小鱼干吃完啦，明天再来/ })).toBeDisabled()
  })

  it('摸够了今天的上限：照样能摸，只是告诉你它已经很满足了', async () => {
    petService.list.mockResolvedValue(state())
    petService.claimDaily.mockResolvedValue({ granted: 0, ...state() })
    petService.pet.mockResolvedValue({ pet: cat({ pettedToday: 10 }), gained: 0 })
    renderPage()
    const body = await screen.findByRole('button', { name: '摸摸团子' })
    body.click()
    body.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }))
    expect(await screen.findByText('今天摸够啦，团子已经很满足了')).toBeInTheDocument()
  })

  it('换一只：领养过的直接换；没领养的点一下起名带回家', async () => {
    const user = userEvent.setup()
    const dog = cat({ species: 'dog', name: '豆豆' })
    petService.list.mockResolvedValue(state({ pets: [cat(), dog] }))
    petService.claimDaily.mockResolvedValue({ granted: 0, ...state({ pets: [cat(), dog] }) })
    petService.setActive.mockResolvedValue(state({ active: 'dog', pets: [cat(), dog] }))
    renderPage()
    await user.click(await screen.findByRole('button', { name: '换成豆豆' }))
    expect(petService.setActive).toHaveBeenCalledWith('dog')
    expect(await screen.findByRole('heading', { name: '豆豆' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '领养一只仓鼠' }))
    const form = screen.getByText('给仓鼠起个名字').parentElement
    expect(within(form).getByRole('textbox')).toHaveValue('栗子')
  })

  it('深夜它在睡觉，也能轻轻摸', async () => {
    vi.setSystemTime(new Date(2026, 8, 27, 23, 30))
    petService.list.mockResolvedValue(state())
    petService.claimDaily.mockResolvedValue({ granted: 0, ...state() })
    renderPage()
    const body = await screen.findByRole('button', { name: '摸摸团子' })
    expect(body).toHaveAttribute('data-frame', 'sleep')
    expect(screen.getByText('团子睡着啦，轻轻摸摸它')).toBeInTheDocument()
  })
})
