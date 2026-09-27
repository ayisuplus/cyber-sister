/**
 * 宠物（路线图 C17，2026-09-27 修订）：内置小猫、小狗、小兔、仓鼠四只，每天第一次来领一份饲料；
 * 喂它长成长值，摸它长好感度。
 *
 * 只涨不掉：几天不来它不会饿、不会难过，好感度和成长值都不降，饲料攒着（有上限）。
 * 摸出来的好感度每只每天有上限，防连点刷数；过了上限照样能摸，只是不再加。
 * 日子按北京时间算，和产品其余部分一致。以后开了图片编辑，再让用户自定义宠物。
 */
import prisma from '../prisma/client.js'
import { HttpError } from '../utils/dbHelpers.js'
import { localClock } from './contextBlocks.js'

export const SPECIES = ['cat', 'dog', 'rabbit', 'hamster']
export const DEFAULT_NAMES = { cat: '团子', dog: '豆豆', rabbit: '棉花', hamster: '栗子' }
export const DAILY_FOOD = 3
export const FOOD_CAP = 30
export const FEED_GROWTH = 10
export const FEED_AFFECTION = 2
export const PET_AFFECTION = 1
export const PET_DAILY_CAP = 10
// 成长阶段：每天喂满三口约 +30，四五天长一级，一个来月到「老朋友」
export const STAGES = [
  { min: 0, name: '小不点' },
  { min: 100, name: '小可爱' },
  { min: 300, name: '大宝贝' },
  { min: 700, name: '老朋友' },
]
// 好感度到这些值各点亮一颗心（一共五颗）
export const HEART_STEPS = [10, 40, 90, 160, 250]
const MAX_NAME = 12

/** 北京时间的日子，yyyy-MM-dd。 */
export const dayOf = (now = new Date()) => new Date(localClock(now).dayKey).toISOString().slice(0, 10)

export function stageOf(growth) {
  let index = 0
  for (let i = 0; i < STAGES.length; i += 1) if (growth >= STAGES[i].min) index = i
  const next = STAGES[index + 1]
  return { index, name: STAGES[index].name, from: STAGES[index].min, to: next ? next.min : null }
}

export const heartsOf = (affection) => HEART_STEPS.filter((step) => affection >= step).length

function assertSpecies(species) {
  if (!SPECIES.includes(species)) throw new HttpError('没有这只宠物', 400)
}

function cleanName(name, species) {
  if (name === undefined || name === null) return DEFAULT_NAMES[species]
  if (typeof name !== 'string') throw new HttpError('名字要是一段文字', 400)
  // 控制字符直接去掉；空名字回到默认名
  const trimmed = name.replace(/\p{Cc}/gu, '').trim()
  return trimmed ? [...trimmed].slice(0, MAX_NAME).join('') : DEFAULT_NAMES[species]
}

function view(pet, today) {
  return {
    species: pet.species,
    name: pet.name,
    affection: pet.affection,
    growth: pet.growth,
    stage: stageOf(pet.growth),
    hearts: heartsOf(pet.affection),
    pettedToday: pet.pettedDay === today ? pet.pettedToday : 0,
    petCap: PET_DAILY_CAP,
  }
}

async function loadUser(client, userId) {
  const user = await client.user.findUnique({ where: { id: userId }, select: { petFood: true, petFoodDay: true, activePetSpecies: true } })
  if (!user) throw new HttpError('用户不存在', 404)
  return user
}

/** 宠物页与本子角共用：饲料、今天领过没有、在养哪一只、每一只的数值。只读，不发饲料。 */
export async function getPets(userId, now = new Date()) {
  const [user, pets] = await Promise.all([
    loadUser(prisma, userId),
    prisma.pet.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
  ])
  const today = dayOf(now)
  const active = pets.some((pet) => pet.species === user.activePetSpecies) ? user.activePetSpecies : pets[0]?.species ?? null
  return {
    food: user.petFood,
    foodCap: FOOD_CAP,
    dailyFood: DAILY_FOOD,
    claimedToday: user.petFoodDay === today,
    active,
    pets: pets.map((pet) => view(pet, today)),
  }
}

/** 每天第一次来领一份饲料；同一天再来是 0。碗满了也算领过。 */
export async function claimDailyFood(userId, now = new Date()) {
  const today = dayOf(now)
  const granted = await prisma.$transaction(async (tx) => {
    const user = await loadUser(tx, userId)
    if (user.petFoodDay === today) return 0
    const next = Math.min(FOOD_CAP, user.petFood + DAILY_FOOD)
    // 条件更新：并发的两次领取只有一次生效
    const { count } = await tx.user.updateMany({
      where: { id: userId, petFoodDay: user.petFoodDay, petFood: user.petFood },
      data: { petFood: next, petFoodDay: today },
    })
    return count ? next - user.petFood : 0
  })
  return { granted, ...(await getPets(userId, now)) }
}

/** 领养（已经有这一只就只是换成在养它）。 */
export async function adopt(userId, { species, name } = {}, now = new Date()) {
  assertSpecies(species)
  await prisma.$transaction(async (tx) => {
    const existing = await tx.pet.findUnique({ where: { userId_species: { userId, species } } })
    if (!existing) await tx.pet.create({ data: { userId, species, name: cleanName(name, species) } })
    await tx.user.update({ where: { id: userId }, data: { activePetSpecies: species } })
  })
  return getPets(userId, now)
}

export async function setActive(userId, species, now = new Date()) {
  assertSpecies(species)
  const pet = await prisma.pet.findUnique({ where: { userId_species: { userId, species } } })
  if (!pet) throw new HttpError('还没有领养这一只', 404)
  await prisma.user.update({ where: { id: userId }, data: { activePetSpecies: species } })
  return getPets(userId, now)
}

export async function rename(userId, species, name, now = new Date()) {
  assertSpecies(species)
  const { count } = await prisma.pet.updateMany({ where: { userId, species }, data: { name: cleanName(name, species) } })
  if (!count) throw new HttpError('还没有领养这一只', 404)
  return getPets(userId, now)
}

/** 喂一口：用掉一份饲料，成长值与好感度上涨。没饲料了 409，不欠账。 */
export function feed(userId, species, now = new Date()) {
  assertSpecies(species)
  const today = dayOf(now)
  return prisma.$transaction(async (tx) => {
    const pet = await tx.pet.findUnique({ where: { userId_species: { userId, species } } })
    if (!pet) throw new HttpError('还没有领养这一只', 404)
    const { count } = await tx.user.updateMany({ where: { id: userId, petFood: { gt: 0 } }, data: { petFood: { decrement: 1 } } })
    if (!count) {
      const error = new HttpError('饲料吃完啦，明天再来领', 409)
      error.code = 'NO_FOOD'
      throw error
    }
    const updated = await tx.pet.update({
      where: { id: pet.id },
      data: { growth: { increment: FEED_GROWTH }, affection: { increment: FEED_AFFECTION } },
    })
    const user = await loadUser(tx, userId)
    return {
      pet: view(updated, today),
      food: user.petFood,
      gained: { growth: FEED_GROWTH, affection: FEED_AFFECTION },
      grewUp: stageOf(updated.growth).index > stageOf(pet.growth).index,
    }
  })
}

/** 摸一摸：每只每天前 PET_DAILY_CAP 次各 +1 好感；之后照样能摸，只是不再加。 */
export function pet(userId, species, now = new Date()) {
  assertSpecies(species)
  const today = dayOf(now)
  return prisma.$transaction(async (tx) => {
    const current = await tx.pet.findUnique({ where: { userId_species: { userId, species } } })
    if (!current) throw new HttpError('还没有领养这一只', 404)
    const petted = current.pettedDay === today ? current.pettedToday : 0
    if (petted >= PET_DAILY_CAP) return { pet: view(current, today), gained: 0 }
    const { count } = await tx.pet.updateMany({
      where: { id: current.id, pettedDay: current.pettedDay, pettedToday: current.pettedToday },
      data: { affection: { increment: PET_AFFECTION }, pettedDay: today, pettedToday: petted + 1 },
    })
    const updated = await tx.pet.findUnique({ where: { id: current.id } })
    return { pet: view(updated, today), gained: count ? PET_AFFECTION : 0 }
  })
}
