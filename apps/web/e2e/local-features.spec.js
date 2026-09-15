/* global document, window */
import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEUlEQVR4nGP4z8AAQv//Q0kASMgJ9xYlCaIAAAAASUVORK5CYII=', 'base64')
// 本地客户端的四个入口及其页签：每一处都要如实声明云端接口仍是模拟
const LOCAL_ENTRIES = [
  ['/tools/schedule', '安排'],
  ['/tools/notes?tab=diary', '手记'],
  ['/tools/notes?tab=reading', '手记'],
  ['/tools/notes?tab=letters', '手记'],
  ['/tools/period', '经期'],
  ['/tools/style?tab=makeup', '装扮'],
  ['/tools/style?tab=wardrobe', '装扮'],
]
const CLOUD_NOTICE = '云端接口预览 · 尚未连接云服务。个人记录照常保存，模拟结果不入库。'
const execution = { mode: 'mock', cloudConnected: false, persisted: false }
const mockMedia = kind => ({ requestId: `e2e-${kind}`, source: 'cloud_mock', execution, result: kind === 'image'
  ? { kind, imageUrl: null, params: { smooth: 60, whiten: 20, slim: 10, eye: 10 }, message: '模拟校验已完成，尚未连接云端服务，未生成或保存图片。' }
  : { kind, modelUrl: null, name: '风衣', message: '模拟校验已完成，尚未连接云端服务，未生成模型，也未添加到衣柜。' } })
const insight = { id: 'saved-insight', kind: 'pattern', status: 'active', confidence: 'medium', content: '已有的理解草稿', evidence: [], createdAt: '2026-09-01T00:00:00.000Z' }
const letter = { id: 'saved-letter', weekStart: '2026-09-07T00:00:00.000Z', content: '已有的来信内容' }
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
      '/api/chat/conversations': [], '/api/llm/status': { externalFallback: { configured: false, consent: true } },
      '/api/care/touchpoints': { touchpoints: [] }, '/api/reminders/due': { deliveries: [] }, '/api/asr/status': { available: false },
      '/api/user/profile': { careEnabled: false }, '/api/user/external-llm-consent': { accepted: true },
      '/api/reminders/scheduled': { reminders: [] }, '/api/tools/period': [],
      '/api/tools/period/summary': { nextDate: null, daysUntil: null },
      '/api/diary': [], '/api/reading/books': [], '/api/makeup-presets': [], '/api/wardrobe': [],
      '/api/derived': { insights: [insight] }, '/api/derived/edges': { edges: [] }, '/api/letters': { letters: [letter] },
      '/api/user/companion': { revision: 1, state: { protection: { mode: 'open' }, experienceCount: 3, learning: { brevity: 0.5, samples: 2 } } },
      '/api/work/status': { capabilities: { backgroundTasks: false } }, '/api/work/tasks': { tasks: [] },
    }
    if (/^\/api\/user\/assets\/(bg-home|bg-chat)$/.test(path)) return json(route, 404, {})
    if (method === 'GET' && /^\/api\/diary\/\d{4}-\d{2}-\d{2}$/.test(path)) return json(route, 404, { error: '没有当天日记' })
    if (/^\/api\/compliance\/usage\/(start|heartbeat|end)$/.test(path)) return json(route, 200, { minutes: 0, shouldRemind: false })
    if (method === 'POST' && path === '/api/work/media/makeup/preview') return json(route, 200, mockMedia('image'))
    if (method === 'POST' && path === '/api/work/media/wardrobe/preview') return json(route, 200, mockMedia('model'))
    if (method === 'POST' && ['/api/derived/analyze', '/api/derived/rebuild'].includes(path)) return json(route, 200, { source: 'cloud_mock', execution, preview: { content: '模拟理解示例，不是关于用户的真实结论。' }, created: 0, cleared: 0 })
    if (method === 'POST' && path === '/api/letters/generate') return json(route, 200, { source: 'cloud_mock', execution, preview: { content: '模拟来信示例，不是真实生成的来信。' } })
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

test('local entries: every entry and tab is reachable and explains that cloud output is only a mock', async ({ page }) => {
  for (const [path, title] of LOCAL_ENTRIES) {
    await page.goto(path)
    await expect(page).toHaveURL(path)
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible()
    await expect(page.getByText(CLOUD_NOTICE)).toBeVisible()
    await expect(page.getByRole('alert')).toHaveCount(0)
  }
})

test('local entries: makeup uploads explicit parameters and wardrobe never offers a fake model', async ({ page }, testInfo) => {
  const writes = []
  const forbiddenInference = []
  page.on('request', request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname.startsWith('/api/')) writes.push(request)
    if (/mediapipe|face_landmarker|\.wasm(?:\?|$)/.test(request.url())) forbiddenInference.push(request.url())
  })
  await page.goto('/tools/style?tab=makeup')
  await expect(page.getByRole('button', { name: '提交模拟预览' })).toBeDisabled()
  await page.locator('input[aria-label="选择照片"]').setInputFiles({ name: 'face.png', mimeType: 'image/png', buffer: PNG })
  await page.getByRole('slider', { name: '磨皮' }).fill('60')
  await expect(page.getByAltText('原图预览：face.png')).toBeVisible()
  expect(writes.filter(request => request.url().includes('/work/media/'))).toHaveLength(0)
  await page.getByRole('button', { name: '提交模拟预览' }).click()
  await expect(page.getByRole('status', { name: '模拟预览结果' })).toContainText('未生成或保存图片')
  const makeup = writes.find(request => request.url().includes('/makeup/preview'))
  expect(makeup.headers()['content-type']).toContain('multipart/form-data')
  expect(makeup.postDataBuffer().toString()).toContain('"smooth":60')
  await expect(page.getByRole('button', { name: '保存到相册' })).toHaveCount(0)
  expect(forbiddenInference).toEqual([])
  await page.getByRole('status', { name: '模拟预览结果' }).scrollIntoViewIfNeeded()
  await accessible(page)
  await page.screenshot({ path: testInfo.outputPath('cloud-makeup.png'), fullPage: true })

  await page.getByRole('button', { name: '衣柜', exact: true }).click()
  await expect(page).toHaveURL(/\/tools\/style\?tab=wardrobe$/)
  await page.locator('input[aria-label="选择单品照片"]').setInputFiles({ name: 'coat.png', mimeType: 'image/png', buffer: PNG })
  await page.getByLabel('单品名字').fill('风衣')
  await page.getByRole('button', { name: '提交模拟预览' }).click()
  await expect(page.getByRole('status', { name: '模拟预览结果' })).toContainText('未添加到衣柜')
  await expect(page.getByText('衣柜还空着', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: '下载模型' })).toHaveCount(0)
  await expect(page.locator('model-viewer')).toHaveCount(0)
  expect(writes.some(request => new URL(request.url()).pathname === '/api/wardrobe')).toBe(false)
  await page.getByRole('status', { name: '模拟预览结果' }).scrollIntoViewIfNeeded()
  await accessible(page)
  await page.screenshot({ path: testInfo.outputPath('cloud-wardrobe.png'), fullPage: true })
  await page.reload()
  await expect(page.getByText('衣柜还空着', { exact: true })).toBeVisible()
  await expect(page.getByRole('status', { name: '模拟预览结果' })).toHaveCount(0)
})

test('local entries: pending understandings and letters keep mock output separate from saved history', async ({ page }, testInfo) => {
  await page.goto('/her?tab=pending')
  await expect(page.getByText('已有的理解草稿', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '预览整理', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: '模拟理解示例' })).toBeVisible()
  await expect(page.getByText('已有的理解草稿', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '预览重建', exact: true }).click()
  // 预览请求进行中按钮是禁用态；等它们恢复可用后再审计，避免把禁用态的淡色当成对比度问题
  await expect(page.getByRole('button', { name: '预览重建', exact: true })).toBeEnabled()
  await expect(page.getByText('已有的理解草稿', { exact: true })).toBeVisible()
  await accessible(page)
  await page.screenshot({ path: testInfo.outputPath('cloud-pending.png'), fullPage: true })
  await page.reload()
  await expect(page.getByText('已有的理解草稿', { exact: true })).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: '模拟理解示例' })).toHaveCount(0)

  await page.goto('/tools/notes?tab=letters')
  await expect(page.getByText('已有的来信内容', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '预览一封信' }).click()
  await expect(page.getByRole('region', { name: '模拟来信预览' })).toContainText('不会保存到你的信箱')
  await expect(page.getByRole('article')).toHaveCount(1)
  await accessible(page)
  await page.screenshot({ path: testInfo.outputPath('cloud-letters.png'), fullPage: true })
  await page.reload()
  await expect(page.getByRole('article')).toHaveCount(1)
  await expect(page.getByRole('region', { name: '模拟来信预览' })).toHaveCount(0)
})

test('local entries: period record controls remain readable at 320px in night mode', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 740 })
  await page.route('**/api/tools/period', route => json(route, 200, [{ id: 'period-e2e', startDate: '2026-09-01T00:00:00.000Z', endDate: '2026-09-05T00:00:00.000Z', cycleDays: 28 }]))
  await page.goto('/tools/period')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
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
