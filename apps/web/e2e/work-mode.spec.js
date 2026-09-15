/* global document, window */
import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

const GROUPS = [
  { title: '安排今天', routes: ['/tools/planner', '/tools/study', '/tools/handbook'] },
  { title: '记录生活', routes: ['/tools/diary', '/tools/reading', '/tools/period'] },
  { title: '灵感装扮', routes: ['/tools/makeup-room', '/tools/wardrobe'] },
  { title: '关于我们', routes: ['/tools/workspace', '/tools/letters'] },
]

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('cyber-sister-auth', JSON.stringify({
      state: {
        token: 'work-mode-e2e-token',
        user: { id: 'work-mode-e2e', nickname: '内测用户', persona: 'gentle' },
        isLoggedIn: true,
      },
      version: 0,
    }))
    localStorage.setItem('cyber-sister-disclaimer-shown', 'true')
  })
  // No API request leaves the browser: unexpected requests fail instead of touching a real account.
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname
    const responses = {
      '/api/chat/conversations': [],
      '/api/llm/status': { externalFallback: { configured: false, consent: true } },
      '/api/care/touchpoints': { touchpoints: [] },
      '/api/reminders/due': { deliveries: [] },
      '/api/asr/status': { available: false },
      '/api/letters': { letters: [] },
    }
    if (/^\/api\/user\/assets\/(bg-home|bg-chat)$/.test(path)) {
      return route.fulfill({ status: 404, body: '' })
    }
    if (/^\/api\/compliance\/usage\/(start|heartbeat|end)$/.test(path)) {
      expect(route.request().method()).toBe('POST')
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ minutes: 0, shouldRemind: false }) })
    }
    expect(route.request().method(), `Unexpected write to ${path}`).toBe('GET')
    expect(Object.hasOwn(responses, path), `Unmocked API request: ${path}`).toBe(true)
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(responses[path]) })
  })
})

async function openWorkMode(page) {
  await page.goto('/chat')
  await page.getByRole('group', { name: '会话模式' }).getByRole('button', { name: '工作', exact: true }).click()
  const desktop = page.getByRole('navigation', { name: '功能桌面' })
  await expect(desktop).toBeVisible()
  await expect(page.locator('.chat-paper')).toHaveClass(/animate-page-turn/)
  await expect(page.locator('.chat-paper')).toHaveCSS('opacity', '1')
  return desktop
}

async function expectNoHorizontalOverflow(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  const desktop = page.getByRole('navigation', { name: '功能桌面' })
  expect(await desktop.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true)
}

async function expectAccessibleWorkView(page) {
  const results = await new AxeBuilder({ page }).include('nav[aria-label="功能桌面"]').analyze()
  expect(results.violations.filter(item => ['serious', 'critical'].includes(item.impact))).toEqual([])
}

test('work mode: themes keep the first view small and all ten tools reachable', async ({ page }, testInfo) => {
  const desktop = await openWorkMode(page)
  const picker = desktop.getByRole('group', { name: '选择工作主题' })
  await expect(picker.getByRole('button')).toHaveCount(4)
  await expect(picker.getByRole('button', { name: '安排今天', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(desktop.getByRole('link')).toHaveCount(3)
  await page.screenshot({ path: testInfo.outputPath('work-desktop.png'), fullPage: true, scale: 'css' })

  const discovered = []
  for (const { title, routes } of GROUPS) {
    await picker.getByRole('button', { name: title, exact: true }).click()
    await expect(picker.locator('[aria-pressed="true"]')).toHaveCount(1)
    await expect(desktop.getByRole('region', { name: title, exact: true })).toBeVisible()
    await expect(desktop.getByRole('link')).toHaveCount(routes.length)
    const links = await desktop.getByRole('link').evaluateAll(nodes => nodes.map(node => node.getAttribute('href')))
    expect(links).toEqual(routes)
    discovered.push(...links)
    await expectNoHorizontalOverflow(page)
    await expectAccessibleWorkView(page)
  }
  expect(new Set(discovered).size).toBe(10)
  await desktop.getByRole('link', { name: /她的信/ }).click()
  await expect(page).toHaveURL(/\/tools\/letters$/)
})

test('work mode: pausing motion keeps newly selected tools visible and usable', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  const desktop = await openWorkMode(page)
  await desktop.getByRole('button', { name: '暂停动效', exact: true }).click()
  await expect(desktop.getByRole('button', { name: '开启动效', exact: true })).toBeVisible()
  await desktop.getByRole('button', { name: '记录生活', exact: true }).click()
  for (const link of await desktop.getByRole('link').all()) {
    await expect(link).toBeVisible()
    await expect(link).toHaveCSS('opacity', '1')
    await expect(link).toHaveCSS('animation-name', 'none')
  }
  expect(await desktop.locator('video').evaluateAll(videos => videos.every(video => video.paused))).toBe(true)
  await desktop.getByRole('button', { name: '开启动效', exact: true }).click()
  await expect(desktop.getByRole('button', { name: '暂停动效', exact: true })).toBeVisible()
})

test('work mode: reduced motion uses a static desk and keeps narrow phones inside the viewport', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 720 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const desktop = await openWorkMode(page)
  await expect(desktop.locator('video')).toHaveCount(0)
  await expect(desktop.locator('.work-desk-media')).toHaveAttribute('src', /\.(png|webp|jpg)$/)
  await expect(desktop.locator('.work-desk-eyebrow svg')).toHaveCSS('animation-name', 'none')
  await expectNoHorizontalOverflow(page)
  await expectAccessibleWorkView(page)
  await page.screenshot({ path: testInfo.outputPath('work-mobile-320.png'), fullPage: true, scale: 'css' })
})

test('work mode: landscape shares the selected theme and pause state, traps focus, and restores portrait', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const desktop = await openWorkMode(page)
  const selected = desktop.getByRole('button', { name: '记录生活', exact: true })
  await selected.click()
  await page.setViewportSize({ width: 844, height: 390 })
  const dialog = page.getByRole('dialog', { name: '沉浸书桌', exact: true })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: '关闭沉浸模式', exact: true })).toBeFocused()
  await expect(dialog.getByRole('button', { name: '记录生活', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await dialog.getByRole('button', { name: '关于我们', exact: true }).click()
  await expect(dialog.getByRole('link')).toHaveCount(2)
  await dialog.getByRole('button', { name: '暂停动效', exact: true }).click()
  await expect(dialog.getByRole('button', { name: '开启动效', exact: true })).toBeVisible()
  expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true)

  await dialog.getByRole('link').last().focus()
  await page.keyboard.press('Tab')
  await expect(dialog.getByRole('button', { name: '开启动效', exact: true })).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(dialog.getByRole('link').last()).toBeFocused()
  const results = await new AxeBuilder({ page }).include('[role="dialog"][aria-label="沉浸书桌"]').analyze()
  expect(results.violations.filter(item => ['serious', 'critical'].includes(item.impact))).toEqual([])
  await page.screenshot({ path: testInfo.outputPath('work-landscape.png'), fullPage: true, scale: 'css' })

  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(selected).toBeFocused()
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(desktop.getByRole('button', { name: '关于我们', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(desktop.getByRole('button', { name: '开启动效', exact: true })).toBeVisible()
  await expectNoHorizontalOverflow(page)
})
