import { beforeEach, describe, expect, it, vi } from 'vitest'

// 一个极小的内存库：只实现 petService 用到的那几种查询，条件更新按字段相等判断
const store = vi.hoisted(() => ({ user: null, pets: [] }))

vi.mock('../prisma/client.js', () => {
  const matches = (row, where) => Object.entries(where).every(([key, value]) => {
    if (key === 'userId_species') return row.userId === value.userId && row.species === value.species
    if (value && typeof value === 'object' && 'gt' in value) return row[key] > value.gt
    return row[key] === value
  })
  const apply = (row, data) => {
    for (const [key, value] of Object.entries(data)) {
      if (value && typeof value === 'object' && 'increment' in value) row[key] += value.increment
      else if (value && typeof value === 'object' && 'decrement' in value) row[key] -= value.decrement
      else row[key] = value
    }
    return row
  }
  const pick = (row, select) => (select ? Object.fromEntries(Object.keys(select).map((key) => [key, row[key]])) : { ...row })
  const client = {
    user: {
      findUnique: ({ where, select }) => Promise.resolve(store.user && store.user.id === where.id ? pick(store.user, select) : null),
      updateMany: ({ where, data }) => {
        if (!store.user || !matches(store.user, where)) return Promise.resolve({ count: 0 })
        apply(store.user, data)
        return Promise.resolve({ count: 1 })
      },
      update: ({ where, data }) => Promise.resolve(apply(store.user.id === where.id ? store.user : {}, data)),
    },
    pet: {
      findMany: ({ where }) => Promise.resolve(store.pets.filter((pet) => pet.userId === where.userId).map((pet) => ({ ...pet }))),
      findUnique: ({ where }) => {
        const found = store.pets.find((pet) => (where.id ? pet.id === where.id : matches(pet, where)))
        return Promise.resolve(found ? { ...found } : null)
      },
      create: ({ data }) => {
        const pet = { id: `p${store.pets.length + 1}`, affection: 0, growth: 0, pettedDay: null, pettedToday: 0, createdAt: new Date(), ...data }
        store.pets.push(pet)
        return Promise.resolve({ ...pet })
      },
      update: ({ where, data }) => Promise.resolve({ ...apply(store.pets.find((pet) => pet.id === where.id), data) }),
      updateMany: ({ where, data }) => {
        const rows = store.pets.filter((pet) => matches(pet, where))
        rows.forEach((row) => apply(row, data))
        return Promise.resolve({ count: rows.length })
      },
    },
  }
  client.$transaction = (fn) => fn(client)
  return { default: client }
})

import {
  adopt, claimDailyFood, DAILY_FOOD, dayOf, feed, FOOD_CAP, getPets, heartsOf, pet, PET_DAILY_CAP, rename, setActive, stageOf,
} from './petService.js'

// 北京时间 9 月 27 日 23:30（UTC 15:30），和 9 月 28 日 00:30（UTC 16:30）是不同的两天
const NIGHT = new Date('2026-09-27T15:30:00Z')
const AFTER_MIDNIGHT = new Date('2026-09-27T16:30:00Z')

beforeEach(() => {
  store.user = { id: 'u1', petFood: 0, petFoodDay: null, activePetSpecies: null }
  store.pets = []
})

describe('日子与等级', () => {
  it('按北京时间分日子', () => {
    expect(dayOf(NIGHT)).toBe('2026-09-27')
    expect(dayOf(AFTER_MIDNIGHT)).toBe('2026-09-28')
  })

  it('成长阶段与心数', () => {
    expect(stageOf(0)).toMatchObject({ index: 0, name: '小不点', from: 0, to: 100 })
    expect(stageOf(150)).toMatchObject({ index: 1, name: '小可爱', to: 300 })
    expect(stageOf(9999)).toMatchObject({ index: 3, name: '老朋友', to: null })
    expect([0, 10, 39, 40, 250, 999].map(heartsOf)).toEqual([0, 1, 1, 2, 5, 5])
  })
})

describe('每天领饲料', () => {
  it('一天只领一次；过了北京时间零点又能领', async () => {
    expect((await claimDailyFood('u1', NIGHT)).granted).toBe(DAILY_FOOD)
    expect((await claimDailyFood('u1', NIGHT)).granted).toBe(0)
    const next = await claimDailyFood('u1', AFTER_MIDNIGHT)
    expect(next.granted).toBe(DAILY_FOOD)
    expect(next.food).toBe(DAILY_FOOD * 2)
    expect(next.claimedToday).toBe(true)
  })

  it('攒着不扣，但碗有上限；满了也算领过', async () => {
    store.user.petFood = FOOD_CAP - 1
    const result = await claimDailyFood('u1', NIGHT)
    expect(result.granted).toBe(1)
    expect(result.food).toBe(FOOD_CAP)
    store.user.petFoodDay = '2026-09-26'
    expect((await claimDailyFood('u1', NIGHT)).granted).toBe(0)
    expect(store.user.petFoodDay).toBe('2026-09-27')
  })
})

describe('领养、换一只、起名', () => {
  it('领养时用默认名，名字截到 12 个字、去掉控制字符', async () => {
    const first = await adopt('u1', { species: 'cat' }, NIGHT)
    expect(first.active).toBe('cat')
    expect(first.pets[0]).toMatchObject({ species: 'cat', name: '团子', affection: 0, growth: 0, hearts: 0 })
    await adopt('u1', { species: 'dog', name: '  小\u0007狗狗狗狗狗狗狗狗狗狗狗狗  ' }, NIGHT)
    const { pets, active } = await getPets('u1', NIGHT)
    expect(active).toBe('dog')
    expect(pets.find((item) => item.species === 'dog').name).toBe('小狗狗狗狗狗狗狗狗狗狗狗')
  })

  it('同一种不重复领养，只是换成在养它；不认识的种类 400', async () => {
    await adopt('u1', { species: 'rabbit', name: '棉花糖' }, NIGHT)
    await adopt('u1', { species: 'hamster' }, NIGHT)
    await adopt('u1', { species: 'rabbit', name: '改不了' }, NIGHT)
    expect(store.pets).toHaveLength(2)
    expect(store.pets[0].name).toBe('棉花糖')
    expect(store.user.activePetSpecies).toBe('rabbit')
    await expect(adopt('u1', { species: 'dragon' })).rejects.toMatchObject({ statusCode: 400 })
  })

  it('换一只与改名只对领养过的', async () => {
    await adopt('u1', { species: 'cat' }, NIGHT)
    await expect(setActive('u1', 'dog')).rejects.toMatchObject({ statusCode: 404 })
    await expect(rename('u1', 'dog', '豆豆')).rejects.toMatchObject({ statusCode: 404 })
    const renamed = await rename('u1', 'cat', '', NIGHT)
    expect(renamed.pets[0].name).toBe('团子')
  })
})

describe('喂它', () => {
  it('用掉一份饲料，成长值 +10、好感度 +2', async () => {
    await adopt('u1', { species: 'cat' }, NIGHT)
    await claimDailyFood('u1', NIGHT)
    const result = await feed('u1', 'cat', NIGHT)
    expect(result.food).toBe(DAILY_FOOD - 1)
    expect(result.pet).toMatchObject({ growth: 10, affection: 2 })
    expect(result.gained).toEqual({ growth: 10, affection: 2 })
  })

  it('没饲料了 409 NO_FOOD，不欠账、数值不变', async () => {
    await adopt('u1', { species: 'cat' }, NIGHT)
    await expect(feed('u1', 'cat', NIGHT)).rejects.toMatchObject({ statusCode: 409, code: 'NO_FOOD' })
    expect(store.user.petFood).toBe(0)
    expect(store.pets[0].growth).toBe(0)
  })

  it('长到下一阶段时告诉界面', async () => {
    await adopt('u1', { species: 'hamster' }, NIGHT)
    store.pets[0].growth = 95
    store.user.petFood = 1
    expect((await feed('u1', 'hamster', NIGHT)).grewUp).toBe(true)
  })
})

describe('摸它', () => {
  it('每天前 10 次各 +1 好感，之后照样能摸但不加；第二天重新算', async () => {
    await adopt('u1', { species: 'dog' }, NIGHT)
    for (let i = 0; i < PET_DAILY_CAP; i += 1) expect((await pet('u1', 'dog', NIGHT)).gained).toBe(1)
    const capped = await pet('u1', 'dog', NIGHT)
    expect(capped.gained).toBe(0)
    expect(capped.pet).toMatchObject({ affection: PET_DAILY_CAP, pettedToday: PET_DAILY_CAP })
    const tomorrow = await pet('u1', 'dog', AFTER_MIDNIGHT)
    expect(tomorrow.gained).toBe(1)
    expect(tomorrow.pet.pettedToday).toBe(1)
  })

  it('只涨不掉：隔了好多天再来，好感度和成长值原样', async () => {
    await adopt('u1', { species: 'cat' }, NIGHT)
    store.pets[0].affection = 123
    store.pets[0].growth = 456
    const later = await getPets('u1', new Date('2026-12-25T02:00:00Z'))
    expect(later.pets[0]).toMatchObject({ affection: 123, growth: 456, pettedToday: 0 })
  })

  it('没领养的摸不了', async () => {
    await expect(pet('u1', 'cat', NIGHT)).rejects.toMatchObject({ statusCode: 404 })
  })
})
