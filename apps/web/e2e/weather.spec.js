import { expect, test } from '@playwright/test'

const json = (route, status, data) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })

// 深夜 23 点（北京时间）：页头看明天
test.use({ timezoneId: 'Asia/Shanghai' })
const LATE_NIGHT = new Date('2026-09-27T23:10:00+08:00')

const HANGZHOU = { name: '杭州', admin1: '浙江', country: '中国', latitude: 30.29365, longitude: 120.16142, timezone: 'Asia/Shanghai' }
const WEATHER = {
  place: { name: '杭州', admin1: '浙江', country: '中国' },
  current: { temperature: 18, condition: '小雨', icon: 'rain' },
  today: { date: '2026-09-27', condition: '小雨', icon: 'rain', min: 14, max: 19, precipitation: 80 },
  tomorrow: { date: '2026-09-28', condition: '晴', icon: 'clear', min: 6, max: 12, precipitation: 0 },
  source: 'Open-Meteo',
}

// 每个测试自己决定一开始有没有填城市；其余接口一律固定、写操作只放行天气
const mockApi = async (page, { placeSet }) => {
  const state = { placeSet, writes: [] }
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname
    const method = route.request().method()
    const responses = {
      '/api/chat/thread': { id: 'weather-e2e', messages: [] },
      '/api/chat/openers': { openers: [] },
      '/api/chat/nudges': { nudges: [] },
      '/api/bridge': { bridges: [] },
      '/api/llm/status': { externalFallback: { configured: false, consent: true } },
      '/api/user/external-llm-consent': { accepted: true, version: 'cloud-primary-v1', updatedAt: null },
      '/api/user/profile': { careEnabled: false },
      '/api/asr/status': { available: false },
      '/api/work/status': { capabilities: { backgroundTasks: false } }, '/api/work/tasks': { tasks: [] },
      '/api/admin/model-providers': { providers: [] },
    }
    if (/^\/api\/user\/assets\/(bg-home|bg-chat|avatar)$/.test(path)) return json(route, 404, {})
    if (/^\/api\/compliance\/usage\/(start|heartbeat|end)$/.test(path)) return json(route, 200, { minutes: 0, shouldRemind: false })
    if (path === '/api/weather') return json(route, 200, state.placeSet ? WEATHER : { place: null })
    if (path === '/api/weather/places') return json(route, 200, { places: [HANGZHOU, { ...HANGZHOU, admin1: '四川', latitude: 30.06, longitude: 102.19 }] })
    if (path === '/api/weather/place' && method === 'PUT') {
      state.writes.push(route.request().postDataJSON())
      state.placeSet = true
      return json(route, 200, { place: WEATHER.place })
    }
    if (path === '/api/weather/place' && method === 'DELETE') {
      state.placeSet = false
      return json(route, 200, { place: null })
    }
    if (path === '/api/admin/model-providers') return json(route, 403, { error: 'forbidden' })
    expect(method, `Unexpected write to ${path}`).toBe('GET')
    expect(Object.hasOwn(responses, path), `Unmocked API request: ${path}`).toBe(true)
    return json(route, 200, responses[path])
  })
  return state
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(LATE_NIGHT)
  await page.addInitScript(() => {
    localStorage.setItem('cyber-sister-auth', JSON.stringify({ state: { token: 'weather-e2e', user: { id: 'weather-e2e', nickname: '内测用户', persona: 'gentle' }, isLoggedIn: true }, version: 0 }))
    localStorage.setItem('cyber-sister-disclaimer-shown', 'true')
  })
})

test('每日天气：没填城市时页头没有天气；设置里填了之后，深夜看到明天，点开是小卡片', async ({ page }) => {
  const state = await mockApi(page, { placeSet: false })
  await page.goto('/chat')
  await expect(page.getByRole('heading', { name: 'Amie', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /明天 ·/ })).toHaveCount(0)

  await page.goto('/settings')
  const card = page.getByRole('region', { name: '天气' }).or(page.locator('section[aria-labelledby="weather-place-title"]'))
  await expect(card.getByText(/不用定位/)).toBeVisible()
  await card.getByRole('textbox', { name: '城市名' }).fill('杭州')
  await card.getByRole('button', { name: '找一找' }).click()
  await card.getByRole('button', { name: '杭州 · 浙江 · 中国' }).click()
  await expect(card.getByText('记下了：杭州')).toBeVisible()
  expect(state.writes).toEqual([HANGZHOU])

  await page.goto('/chat')
  const line = page.getByRole('button', { name: '明天 · 晴 6–12°' })
  await expect(line).toBeVisible()
  await line.click()
  const dialog = page.getByRole('dialog', { name: '杭州 · 浙江' })
  await expect(dialog).toContainText('明天降温了，多穿一件')
  await expect(dialog).toContainText('数据来自 Open-Meteo')
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(line).toBeFocused()
})
