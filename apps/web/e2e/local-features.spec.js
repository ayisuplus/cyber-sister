/* global document, window */
import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEUlEQVR4nGP4z8AAQv//Q0kASMgJ9xYlCaIAAAAASUVORK5CYII=', 'base64')
// 四个生活入口及其页签：只有一个 Web 版，每一处都能直接打开，也不再挂「云端接口预览」横幅
const LIFE_ENTRIES = [
  ['/tools/calendar', '日历'],
  ['/tools/notes', '手记'],
  ['/tools/style?tab=makeup', '装扮'],
  ['/tools/style?tab=wardrobe', '装扮'],
]
const insight = { id: 'saved-insight', kind: 'pattern', status: 'active', confidence: 'medium', content: '已有的理解草稿', evidence: [], createdAt: '2026-09-01T00:00:00.000Z' }
const json = (route, status, data) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('cyber-sister-auth', JSON.stringify({ state: { token: 'local-features-e2e', user: { id: 'local-features-e2e', nickname: '内测用户', persona: 'gentle' }, isLoggedIn: true }, version: 0 }))
    localStorage.setItem('cyber-sister-disclaimer-shown', 'true')
    localStorage.setItem('amie-theme', 'dark')
  })
  // Every application API request is handled here; an unexpected read or write fails instead of reaching a real account.
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname
    const method = route.request().method()
    const responses = {
      '/api/chat/thread': { id: 'thread-e2e', messages: [] }, '/api/bridge': { bridges: [] }, '/api/llm/status': { externalFallback: { configured: false, consent: true } },
      '/api/chat/nudges': { nudges: [] }, '/api/asr/status': { available: false },
      '/api/chat/openers': { openers: [] },
      '/api/user/profile': { careEnabled: false }, '/api/user/external-llm-consent': { accepted: true },
      '/api/reminders/scheduled': { reminders: [] }, '/api/tools/period': [],
      '/api/tools/period/summary': { nextDate: null, daysUntil: null }, '/api/tools/period/consent': { accepted: true }, '/api/tools/period/tone': { enabled: false, updatedAt: null },
      '/api/diary': [], '/api/reading/notes': { notes: [] }, '/api/collection': { items: [] },
      // 模型供应商管理接口（2026-09-22）：普通用户看不到卡片，也就不会请求它，先登记着
      '/api/admin/model-providers': { providers: [] },
      '/api/derived': { insights: [insight] }, '/api/derived/edges': { edges: [] }, '/api/derived/followups': { followUps: [] },
      '/api/user/companion': { revision: 1, state: { protection: { mode: 'open' }, experienceCount: 3, learning: { brevity: 0.5, samples: 2 } } },
      '/api/work/status': { capabilities: { backgroundTasks: false } }, '/api/work/tasks': { tasks: [] },
    }
    if (/^\/api\/user\/assets\/(bg-home|bg-chat)$/.test(path)) return json(route, 404, {})
    if (method === 'GET' && /^\/api\/diary\/\d{4}-\d{2}-\d{2}$/.test(path)) return json(route, 404, { error: '没有当天日记' })
    if (/^\/api\/compliance\/usage\/(start|heartbeat|end)$/.test(path)) return json(route, 200, { minutes: 0, shouldRemind: false })
    expect(method, `Unexpected write to ${path}`).toBe('GET')
    expect(Object.hasOwn(responses, path), `Unmocked API request: ${path}`).toBe(true)
    return json(route, 200, responses[path])
  })
})

async function accessible(page) {
  const audit = await new AxeBuilder({ page }).analyze()
  expect(audit.violations.filter(item => ['serious', 'critical'].includes(item.impact))).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
}

test('shared memory: pending understandings and relations sit in one list, confirmed and surviving reload', async ({ page }) => {
  let drafts = [{ ...insight, revision: 1, sources: [{ type: 'memory', id: 'from', revision: 1, quote: '喜欢散步' }] }]
  let edge = { id: 'edge-e2e', revision: 1, status: 'derived', relation: 'related',
    from: { id: 'from', content: '喜欢散步', revision: 1 }, to: { id: 'to', content: '周末去公园', revision: 2 } }
  await page.route('**/api/derived**', route => {
    const path = new URL(route.request().url()).pathname
    const method = route.request().method()
    if (method === 'GET' && path === '/api/derived') return json(route, 200, { insights: drafts })
    if (method === 'GET' && path === '/api/derived/edges') return json(route, 200, { edges: [edge] })
    if (method === 'GET' && path === '/api/derived/followups') return json(route, 200, { followUps: [] })
    expect(method).toBe('POST')
    if (path === '/api/derived/saved-insight/promote') {
      expect(route.request().postDataJSON()).toMatchObject({ expectedRevision: 1, asManual: false })
      drafts = []
      return json(route, 200, { memory: { id: 'confirmed-memory' } })
    }
    expect(path).toBe('/api/derived/edges/edge-e2e/promote')
    expect(route.request().postDataJSON()).toEqual({ expectedRevision: 1, expectedFromRevision: 1, expectedToRevision: 2 })
    edge = { ...edge, status: 'canonical', revision: 2 }
    return json(route, 200, { edge })
  })
  await page.goto('/her?tab=pending')
  await expect(page.getByText('已有的理解草稿', { exact: true })).toBeVisible()
  // 同一处既有她的理解，也有记忆之间的关系
  await expect(page.getByText('周末去公园', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '记住', exact: true }).first().click()
  await expect(page.getByText('已有的理解草稿', { exact: true })).toHaveCount(0)
  await page.reload()
  await expect(page.getByText('已有的理解草稿', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '记住', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: '她记下这层关系了' })).toBeVisible()
  await page.reload()
  await expect(page.getByText(/她还没想到什么/)).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('local schedule: ending a recurring series keeps it completed after reload', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 })
  let task = { id: 'series-e2e', content: '每日散步', freq: 'daily', time: '18:00', status: 'active', nextFireAt: '2026-09-20T10:00:00.000Z' }
  await page.route('**/api/reminders/scheduled**', route => {
    if (route.request().method() === 'GET') return json(route, 200, { reminders: [task] })
    expect(route.request().method()).toBe('PUT')
    expect(new URL(route.request().url()).pathname).toBe('/api/reminders/scheduled/series-e2e')
    expect(route.request().postDataJSON()).toEqual({ status: 'done' })
    task = { ...task, status: 'done' }
    return json(route, 200, { reminder: task })
  })
  await page.goto('/tools/calendar')
  await expect(page.getByRole('button', { name: '结束重复：每日散步' }).first()).toBeVisible()
  await accessible(page)
  await page.getByRole('button', { name: '结束重复：每日散步' }).first().click()
  await expect(page.getByRole('button', { name: '结束重复：每日散步' })).toHaveCount(0)
  await page.reload()
  await page.getByRole('button', { name: /已完成/ }).click()
  await expect(page.getByText('每日散步', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '结束重复：每日散步' })).toHaveCount(0)
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('life entries: every entry and tab opens directly, with no mock banner', async ({ page }) => {
  for (const [path, title] of LIFE_ENTRIES) {
    await page.goto(path)
    await expect(page).toHaveURL(path)
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible()
    await expect(page.getByText(/云端接口预览/)).toHaveCount(0)
    await expect(page.getByRole('alert')).toHaveCount(0)
  }
})

test('life entries: the wardrobe keeps a photo compressed on this device, with no face model or 3D viewer', async ({ page }, testInfo) => {
  const posts = []
  const forbidden = []
  page.on('request', request => {
    if (/mediapipe|face_landmarker|\.wasm(?:\?|$)|model-viewer/.test(request.url())) forbidden.push(request.url())
  })
  await page.route(/\/api\/collection(?:\?|$)/, route => {
    if (route.request().method() !== 'POST') return json(route, 200, { items: [] })
    posts.push(route.request())
    return json(route, 200, { id: 'c1', shelf: 'wardrobe', category: null, name: '风衣', note: null, status: 'have', link: null, photoUrl: null, thumbUrl: null })
  })
  await page.goto('/tools/style?tab=wardrobe')
  await expect(page.getByText(/衣柜还空着/)).toBeVisible()
  await page.getByRole('button', { name: '放进来' }).click()
  await page.getByLabel('从相册选一张').setInputFiles({ name: 'coat.png', mimeType: 'image/png', buffer: PNG })
  const form = page.getByRole('form', { name: '放进衣柜' })
  await form.getByLabel('名字').fill('风衣')
  await accessible(page)
  await form.getByRole('button', { name: '存下来' }).click()
  await expect(page.getByRole('button', { name: '风衣' })).toBeVisible()

  // 传上去的是这台设备上重画过的两张 JPEG（原图 + 缩略图），不是原文件
  expect(posts).toHaveLength(1)
  expect(posts[0].headers()['content-type']).toContain('multipart/form-data')
  const body = posts[0].postDataBuffer().toString('latin1')
  expect(body).toContain('name="photo"')
  expect(body).toContain('name="thumb"')
  expect(body.match(/Content-Type: image\/jpeg/g)).toHaveLength(2)
  expect(body).not.toContain('image/png')
  expect(forbidden).toEqual([])
  await accessible(page)
  await page.screenshot({ path: testInfo.outputPath('cloud-wardrobe.png'), fullPage: true })
})

test('life entries: pending understandings show saved history only, with no mock buttons', async ({ page }, testInfo) => {
  await page.goto('/her?tab=pending')
  await expect(page.getByText('已有的理解草稿', { exact: true })).toBeVisible()
  for (const name of ['预览整理', '预览重建']) await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0)
  await accessible(page)
  await page.screenshot({ path: testInfo.outputPath('pending.png'), fullPage: true })
})

test('life entries: period asks for separate consent before anything can be recorded', async ({ page }) => {
  let accepted = false
  await page.route('**/api/tools/period/consent', route => {
    if (route.request().method() === 'PUT') accepted = route.request().postDataJSON().accepted === true
    return json(route, 200, { accepted, updatedAt: accepted ? '2026-09-19T00:00:00.000Z' : null })
  })
  await page.goto('/tools/calendar')
  await expect(page.getByRole('heading', { name: '记录经期之前' })).toBeVisible()
  await expect(page.getByRole('button', { name: '在这天记经期' })).toHaveCount(0)
  await accessible(page)
  await page.getByRole('button', { name: '同意并开始记录' }).click()
  await expect(page.getByRole('button', { name: '在这天记经期' })).toBeVisible()
  expect(accepted).toBe(true)
  await page.reload()
  await expect(page.getByRole('heading', { name: '记录经期之前' })).toHaveCount(0)
})

test('life entries: period record controls remain readable at 320px in night mode', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 740 })
  await page.route('**/api/tools/period', route => json(route, 200, [{ id: 'period-e2e', startDate: '2026-09-01T00:00:00.000Z', endDate: '2026-09-05T00:00:00.000Z', cycleDays: 28 }]))
  await page.goto('/tools/calendar')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.getByRole('button', { name: '9月1日，经期中' }).click()
  await expect(page.getByRole('button', { name: '编辑 2026-09-01 的记录' })).toBeVisible()
  await expect(page.getByRole('button', { name: '删除 2026-09-01 的记录' })).toBeVisible()
  await accessible(page)
  await page.screenshot({ path: testInfo.outputPath('cloud-period-320.png'), fullPage: true })
  await page.getByRole('button', { name: '编辑 2026-09-01 的记录' }).click()
  await expect(page.getByLabel('开始日期')).toHaveValue('2026-09-01')
  await expect(page.getByRole('button', { name: '保存记录' })).toBeVisible()
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await page.getByRole('button', { name: '删除 2026-09-01 的记录' }).click()
  await expect(page.getByRole('alertdialog', { name: '删除经期记录' })).toBeVisible()
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await expect(page.getByRole('button', { name: '编辑 2026-09-01 的记录' })).toBeVisible()
})
