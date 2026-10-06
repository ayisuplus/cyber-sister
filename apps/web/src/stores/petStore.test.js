import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../services/petService', () => ({
  petService: { list: vi.fn(), claimDaily: vi.fn(), adopt: vi.fn(), setActive: vi.fn(), rename: vi.fn(), feed: vi.fn(), pet: vi.fn() },
}))

import { petService } from '../services/petService'
import { resetSession } from '../services/sessionLifecycle'
import { activePetOf, usePetStore } from './petStore'

const CAT = { species: 'cat', name: '团子', affection: 0, growth: 0, hearts: 0, pettedToday: 0, petCap: 10, stage: { index: 0, name: '小不点', from: 0, to: 100 } }
const DATA = { food: 3, foodCap: 30, dailyFood: 3, claimedToday: true, active: 'cat', pets: [CAT] }

describe('petStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    usePetStore.getState().reset()
  })

  it('读出来的是服务端的数；在养哪一只', async () => {
    petService.list.mockResolvedValue(DATA)
    await usePetStore.getState().load()
    expect(usePetStore.getState()).toMatchObject({ status: 'ready', food: 3, active: 'cat' })
    expect(activePetOf(usePetStore.getState())).toEqual(CAT)
  })

  it('读失败时标成 error，不编数据', async () => {
    petService.list.mockRejectedValue(new Error('offline'))
    await usePetStore.getState().load()
    expect(usePetStore.getState()).toMatchObject({ status: 'error', pets: [] })
  })

  it('领今天的零食：返回领到几份', async () => {
    petService.claimDaily.mockResolvedValue({ granted: 3, ...DATA, food: 6 })
    expect(await usePetStore.getState().claimDaily()).toBe(3)
    expect(usePetStore.getState().food).toBe(6)
  })

  it('喂和摸只替换那一只的数值', async () => {
    petService.list.mockResolvedValue({ ...DATA, pets: [CAT, { ...CAT, species: 'dog', name: '豆豆' }] })
    await usePetStore.getState().load()
    petService.feed.mockResolvedValue({ pet: { ...CAT, growth: 10, affection: 2 }, food: 2, gained: { growth: 10, affection: 2 }, grewUp: false })
    await usePetStore.getState().feed('cat')
    petService.pet.mockResolvedValue({ pet: { ...CAT, species: 'dog', name: '豆豆', affection: 1 }, gained: 1 })
    await usePetStore.getState().pet('dog')
    const { pets, food } = usePetStore.getState()
    expect(food).toBe(2)
    expect(pets.find((item) => item.species === 'cat')).toMatchObject({ growth: 10, affection: 2 })
    expect(pets.find((item) => item.species === 'dog')).toMatchObject({ affection: 1 })
  })

  it('退出登录清空；退出前发出的请求回来也不写回', async () => {
    let resolve
    petService.list.mockReturnValue(new Promise((done) => { resolve = done }))
    const pending = usePetStore.getState().load()
    resetSession()
    resolve(DATA)
    await pending
    expect(usePetStore.getState()).toMatchObject({ status: 'idle', pets: [] })
  })
})
