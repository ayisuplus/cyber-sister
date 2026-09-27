import { create } from 'zustand'
import { petService } from '../services/petService'
import { getSessionVersion, onSessionReset } from '../services/sessionLifecycle'

const initial = {
  status: 'idle', // idle 还没读 / ready / error
  food: 0,
  foodCap: 30,
  dailyFood: 3,
  claimedToday: false,
  active: null,
  pets: [],
}

/** 宠物页与本子角共用一份：本子角上摸一下，宠物页的好感度同一份在涨。 */
export const usePetStore = create((set, get) => {
  const apply = (data) => {
    if (!data || !Array.isArray(data.pets)) return
    const { food, foodCap, dailyFood, claimedToday, active, pets } = data
    set({ status: 'ready', food, foodCap, dailyFood, claimedToday, active, pets })
  }
  const guarded = async (request) => {
    const version = getSessionVersion()
    const data = await request()
    if (version !== getSessionVersion()) return null
    return data
  }
  const replacePet = (next) => {
    if (!next) return
    set({ pets: get().pets.map((item) => (item.species === next.species ? next : item)) })
  }

  return {
    ...initial,

    async load() {
      try {
        apply(await guarded(() => petService.list()))
      } catch {
        if (get().status === 'idle') set({ status: 'error' })
      }
    },

    /** 每天第一次来：领今天的零食，返回领到几份（今天领过就是 0）。 */
    async claimDaily() {
      const data = await guarded(() => petService.claimDaily())
      apply(data)
      return data?.granted ?? 0
    },

    async adopt(species, name) { apply(await guarded(() => petService.adopt(species, name))) },
    async setActive(species) { apply(await guarded(() => petService.setActive(species))) },
    async rename(species, name) { apply(await guarded(() => petService.rename(species, name))) },

    async feed(species) {
      const result = await guarded(() => petService.feed(species))
      if (!result) return null
      replacePet(result.pet)
      set({ food: result.food })
      return result
    },

    /** 摸一摸：一段手势只报一次；返回这次长了几点好感（今天摸够了就是 0）。 */
    async pet(species) {
      const result = await guarded(() => petService.pet(species))
      if (!result) return null
      replacePet(result.pet)
      return result
    },

    reset() {
      set(initial)
    },
  }
})

export const activePetOf = (state) => state.pets.find((item) => item.species === state.active) ?? null

onSessionReset(() => usePetStore.getState().reset())
