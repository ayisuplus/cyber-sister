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
      '/api/chat/thread': { id: 'notebook-cat-e2e', messages: [] },
      '/api/chat/openers': { openers: [] },
      '/api/chat/nudges': { nudges: [] },
      '/api/bridge': { bridges: [] },
      '/api/llm/status': { externalFallback: { configured: false, consent: true } },
      '/api/user/external-llm-consent': { accepted: true, version: 'cloud-primary-v1', updatedAt: null },
      '/api/user/profile': { careEnabled: false },
      '/api/asr/status': { available: false },
      '/api/work/status': { capabilities: { backgroundTasks: false } }, '/api/work/tasks': { tasks: [] },
      '/api/admin/model-providers': { providers: [] },
      '/api/pets': { food: 0, foodCap: 30, dailyFood: 3, claimedToday: false, active: null, pets: [] },
      '/api/user/personas': { personas: [{ id: 'gentle', name: '姐妹', active: true, card: { name: '姐妹', speech: '耐心倾听', immersion: 'medium', tone: 'gentle', samples: [] } }] },
      '/api/reminders/sleep': { bedtime: null, wake: null, due: [] },
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
    localStorage.setItem('cyber-sister-auth', JSON.stringify({ state: { token: 'notebook-cat-e2e', user: { id: 'notebook-cat-e2e', nickname: '内测用户', persona: 'gentle' }, isLoggedIn: true }, version: 0 }))
    localStorage.setItem('cyber-sister-disclaimer-shown', 'true')
  })
})

test('本子角上的小猫：点一下醒、来回摸会呼噜，摸它不翻页', async ({ page }) => {
  await mockApi(page, { placeSet: true })
  await page.goto('/chat')
  const cat = page.getByRole('button', { name: '摸摸小猫' })
  await expect(cat).toBeVisible()
  await expect(cat).toHaveAttribute('data-mood', 'idle')
  // 小猫不挡页头的设置按钮
  const catBox = await cat.boundingBox()
  const settingsBox = await page.getByRole('link', { name: '打开设置' }).boundingBox()
  const overlaps = catBox.x < settingsBox.x + settingsBox.width && settingsBox.x < catBox.x + catBox.width
    && catBox.y < settingsBox.y + settingsBox.height && settingsBox.y < catBox.y + catBox.height
  expect(overlaps).toBe(false)

  await cat.click()
  await expect(cat).toHaveAttribute('data-mood', 'peek')

  const box = await cat.boundingBox()
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  await page.mouse.move(cx - 20, cy)
  await page.mouse.down()
  for (const dx of [20, -20, 20, -20]) await page.mouse.move(cx + dx, cy, { steps: 4 })
  await expect(cat).toHaveAttribute('data-mood', 'purr')
  await expect(page.getByText('呼噜呼噜…')).toBeVisible()
  await page.mouse.up()

  // 还停在封面：摸猫不是翻页
  await expect(page.getByRole('navigation', { name: '翻页' })).toContainText('封面')
})
