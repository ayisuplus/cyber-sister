/* global document, window */
import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEUlEQVR4nGP4z8AAQv//Q0kASMgJ9xYlCaIAAAAASUVORK5CYII=', 'base64')
const GROUPS = [
  ['安排今天', ['schedule']],
  ['记录生活', ['diary', 'reading', 'period']],
  ['灵感装扮', ['makeup-room', 'wardrobe']],
  ['关于我们', ['workspace', 'letters']],
]
const execution = { mode: 'mock', cloudConnected: false, persisted: false }
const mockMedia = kind => ({ requestId: `e2e-${kind}`, source: 'cloud_mock', execution, result: kind === 'image'
  ? { kind, imageUrl: null, params: { smooth: 60, whiten: 20, slim: 10, eye: 10 }, message: '模拟校验已完成，尚未连接云端服务，未生成或保存图片。' }
  : { kind, modelUrl: null, name: '风衣', message: '模拟校验已完成，尚未连接云端服务，未生成模型，也未添加到衣柜。' } })
const insight = { id: 'saved-insight', kind: 'pattern', status: 'active', confidence: 'medium', content: '已有的理解草稿', evidence: [], createdAt: '2026-09-01T00:00:00.000Z' }
const letter = { id: 'saved-letter', weekStart: '2026-09-07T00:00:00.000Z', content: '已有的来信内容' }
const json = (route, status, data) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('cyber-sister-auth', JSON.stringify({ state: { token: 'work-cloud-e2e', user: { id: 'work-cloud-e2e', nickname: '内测用户', persona: 'gentle' }, isLoggedIn: true }, version: 0 }))
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

async function workDesktop(page) {
  await page.goto('/chat')
  await page.getByRole('group', { name: '会话模式' }).getByRole('button', { name: '工作', exact: true }).click()
  const desktop = page.getByRole('navigation', { name: '功能桌面' })
  await expect(desktop).toBeVisible()
  await expect(page.locator('.chat-paper')).toHaveClass(/animate-page-turn/)
  await expect(page.locator('.chat-paper')).toHaveCSS('opacity', '1')
  return desktop
}

test('work cloud: all ten task routes remain reachable and explain mock execution', async ({ page }) => {
  for (const [group, routes] of GROUPS) {
    for (const tool of routes) {
      const desktop = await workDesktop(page)
      await desktop.getByRole('button', { name: group, exact: true }).click()
      await desktop.locator(`a[href="/tools/${tool}"]`).click()
      await expect(page).toHaveURL(new RegExp(`/tools/${tool}$`))
      await expect(page.getByText('云端接口预览 · 尚未连接云服务。个人记录照常保存，模拟结果不入库。')).toBeVisible()
      await expect(page.getByRole('alert')).toHaveCount(0)
    }
  }
})

test('work cloud: makeup uploads explicit parameters and wardrobe never offers a fake model', async ({ page }, testInfo) => {
  const writes = []
  const forbiddenInference = []
  page.on('request', request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname.startsWith('/api/')) writes.push(request)
    if (/mediapipe|face_landmarker|\.wasm(?:\?|$)/.test(request.url())) forbiddenInference.push(request.url())
  })
  await page.goto('/tools/makeup-room')
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

  await page.goto('/tools/wardrobe')
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

test('work cloud: workspace and letters keep mock output separate from saved history', async ({ page }, testInfo) => {
  await page.goto('/tools/workspace')
  await expect(page.getByText('已有的理解草稿', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '让她现在整理一下' }).click()
  const preview = page.getByRole('region', { name: '模拟理解预览' })
  await expect(preview).toContainText('模拟理解示例')
  await expect(preview.getByRole('button', { name: '这条算数' })).toHaveCount(0)
  await expect(page.getByText('已有的理解草稿', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '重建工作台', exact: true }).click()
  await page.getByRole('button', { name: '确认重建', exact: true }).click()
  await expect(page.getByText('已有的理解草稿', { exact: true })).toBeVisible()
  await expect(preview).toBeVisible()
  await accessible(page)
  await page.screenshot({ path: testInfo.outputPath('cloud-workspace.png'), fullPage: true })
  await page.reload()
  await expect(page.getByText('已有的理解草稿', { exact: true })).toBeVisible()
  await expect(preview).toHaveCount(0)

  await page.goto('/tools/letters')
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

test('work cloud: period record controls remain readable at 320px in night mode', async ({ page }, testInfo) => {
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
