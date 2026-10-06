import { expect, test } from '@playwright/test'

const json = (route, status, data) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })

test.use({ timezoneId: 'Asia/Shanghai' })
const AFTERNOON = new Date('2026-09-27T15:10:00+08:00')

const STAGES = [{ min: 0, name: '小不点' }, { min: 100, name: '小可爱' }, { min: 300, name: '大宝贝' }, { min: 700, name: '老朋友' }]
const stageOf = (growth) => {
  let index = 0
  STAGES.forEach((stage, i) => { if (growth >= stage.min) index = i })
  return { index, name: STAGES[index].name, from: STAGES[index].min, to: STAGES[index + 1]?.min ?? null }
}
const heartsOf = (affection) => [10, 40, 90, 160, 250].filter((step) => affection >= step).length

// 一个有状态的宠物服务端替身：领养、领零食、喂、摸，规则与 petService 一致
const mockApi = async (page) => {
  const state = { food: 0, claimedToday: false, active: null, pets: [] }
  const view = (pet) => ({ ...pet, stage: stageOf(pet.growth), hearts: heartsOf(pet.affection), petCap: 10 })
  const snapshot = () => ({ food: state.food, foodCap: 30, dailyFood: 3, claimedToday: state.claimedToday, active: state.active, pets: state.pets.map(view) })
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url())
    const path = url.pathname
    const method = route.request().method()
    if (path === '/api/pets' && method === 'GET') return json(route, 200, snapshot())
    if (path === '/api/pets' && method === 'POST') {
      const { species, name } = route.request().postDataJSON()
      if (!state.pets.some((pet) => pet.species === species)) state.pets.push({ species, name, affection: 0, growth: 0, pettedToday: 0 })
      state.active = species
      return json(route, 200, snapshot())
    }
    if (path === '/api/pets/daily') {
      const granted = state.claimedToday ? 0 : 3
      state.food += granted
      state.claimedToday = true
      return json(route, 200, { granted, ...snapshot() })
    }
    const feed = path.match(/^\/api\/pets\/(\w+)\/feed$/)
    if (feed) {
      if (state.food <= 0) return json(route, 409, { error: '饲料吃完啦，明天再来领', code: 'NO_FOOD' })
      const pet = state.pets.find((item) => item.species === feed[1])
      state.food -= 1
      const before = stageOf(pet.growth).index
      pet.growth += 10
      pet.affection += 2
      return json(route, 200, { pet: view(pet), food: state.food, gained: { growth: 10, affection: 2 }, grewUp: stageOf(pet.growth).index > before })
    }
    const stroke = path.match(/^\/api\/pets\/(\w+)\/pet$/)
    if (stroke) {
      const pet = state.pets.find((item) => item.species === stroke[1])
      if (pet.pettedToday >= 10) return json(route, 200, { pet: view(pet), gained: 0 })
      pet.pettedToday += 1
      pet.affection += 1
      return json(route, 200, { pet: view(pet), gained: 1 })
    }
    if (/^\/api\/compliance\/usage\/(start|heartbeat|end)$/.test(path)) return json(route, 200, { minutes: 0, shouldRemind: false })
    return json(route, 404, { error: 'unmocked' })
  })
  return state
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(AFTERNOON)
  await page.addInitScript(() => {
    localStorage.setItem('cyber-sister-auth', JSON.stringify({ state: { token: 'pet-e2e', user: { id: 'pet-e2e', nickname: '内测用户', persona: 'gentle' }, isLoggedIn: true }, version: 0 }))
    localStorage.setItem('cyber-sister-disclaimer-shown', 'true')
  })
})

test('宠物页：挑一只带回家 → 领今天的零食 → 喂一口 → 摸一摸；本子角上换成它', async ({ page }) => {
  const state = await mockApi(page)
  await page.goto('/tools/pet')
  await expect(page.getByText('挑一只带回家吧')).toBeVisible()
  await page.getByRole('button', { name: '小狗' }).click()
  await page.getByRole('textbox', { name: '给它起个名字' }).fill('小汤圆')
  await page.getByRole('button', { name: '带它回家' }).click()

  await expect(page.getByRole('heading', { name: '小汤圆' })).toBeVisible()
  await expect(page.getByText('今天的小骨头到啦 +3')).toBeVisible()
  await expect(page.getByText('还剩 3 份 · 每天来领 3 份')).toBeVisible()

  await page.getByRole('button', { name: /喂一口小骨头/ }).click()
  await expect(page.getByText('成长 +10')).toBeVisible()
  await expect(page.getByText('10 / 100')).toBeVisible()
  await expect(page.getByText('还剩 2 份 · 每天来领 3 份')).toBeVisible()

  const body = page.getByRole('button', { name: '摸摸小汤圆' })
  const box = await body.boundingBox()
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  await page.mouse.move(cx - 30, cy)
  await page.mouse.down()
  for (const dx of [30, -30, 30, -30]) await page.mouse.move(cx + dx, cy, { steps: 4 })
  await expect(body).toHaveAttribute('data-mood', 'purr')
  await page.mouse.up()
  await expect.poll(() => state.pets[0].affection).toBe(3)

  // 回到对话：本子角上是它
  await page.goto('/chat')
  await expect(page.getByRole('button', { name: '摸摸小汤圆' })).toHaveAttribute('data-species', 'dog')
})
