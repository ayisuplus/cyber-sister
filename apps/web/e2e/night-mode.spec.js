/* global document, window */
import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { writeFile } from 'node:fs/promises'

const conversation = {
  id: 'night-e2e-conversation', title: '睡前的小聊', mode: 'chat', updatedAt: '2026-09-12T12:00:00.000Z',
  messages: [
    { id: 'night-user', role: 'user', content: '今天的事情已经做完了，想慢慢休息。', createdAt: '2026-09-12T12:00:00.000Z' },
    { id: 'night-assistant', role: 'assistant', content: '辛苦啦，喝点水，给自己留一点安静的时间。', source: 'qwen', createdAt: '2026-09-12T12:00:01.000Z' },
  ],
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    // Seed this isolated browser tab once so reloads really test persisted preferences.
    if (!sessionStorage.getItem('night-e2e-seeded')) {
      localStorage.setItem('cyber-sister-auth', JSON.stringify({
        state: { token: 'night-e2e-token', user: { id: 'night-e2e', nickname: '内测用户', persona: 'gentle' }, isLoggedIn: true },
        version: 0,
      }))
      localStorage.setItem('cyber-sister-disclaimer-shown', 'true')
      sessionStorage.setItem('night-e2e-seeded', 'true')
    }
  })
  // All API traffic is fulfilled here; neither account data nor a live model is used.
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname
    const responses = {
      '/api/chat/conversations': [conversation],
      '/api/chat/conversations/night-e2e-conversation': conversation,
      '/api/llm/status': { externalFallback: { configured: false, consent: true } },
      '/api/care/touchpoints': { touchpoints: [] },
      '/api/reminders/due': { deliveries: [] },
      '/api/asr/status': { available: false },
      '/api/user/profile': { careEnabled: true },
      '/api/tools/reminders': [
        { id: 'night-water', type: 'water', isActive: true },
        { id: 'night-sleep', type: 'sleep', isActive: false },
        { id: 'night-period', type: 'period', isActive: false },
      ],
      '/api/tools/todos': [{ id: 'night-done', content: '已经读完一章', isDone: true, dueDate: '2026-09-12T00:00:00.000Z', dueTime: '20:30', createdAt: '2026-09-12T10:00:00.000Z' }],
      '/api/tools/countdowns': [],
      '/api/reminders/scheduled': { reminders: [{ id: 'night-paused', content: '睡前收好手机', freq: 'daily', time: '22:30', status: 'paused', nextFireAt: '2026-09-12T14:30:00.000Z' }] },
      '/api/tools/period': [{ id: 'night-period-record', startDate: '2026-09-03', endDate: '2026-09-08', cycleDays: 28 }],
      '/api/tools/period/summary': { nextDate: '2026-10-01', daysUntil: 19, source: 'server_calculation' },
    }
    if (/^\/api\/user\/assets\/(bg-home|bg-chat)$/.test(path)) return route.fulfill({ status: 404, body: '' })
    if (/^\/api\/compliance\/usage\/(start|heartbeat|end)$/.test(path)) {
      expect(route.request().method()).toBe('POST')
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ minutes: 0, shouldRemind: false }) })
    }
    expect(route.request().method(), `Unexpected write to ${path}`).toBe('GET')
    expect(Object.hasOwn(responses, path), `Unmocked API request: ${path}`).toBe(true)
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(responses[path]) })
  })
})

async function chooseNight(page) {
  await page.goto('/settings')
  await page.getByRole('radio', { name: '夜间', exact: true }).check()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
}

async function inspectSurface(page, testInfo, name) {
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'dark')
  await page.waitForLoadState('networkidle')
  const paper = page.locator('.chat-paper')
  if (await paper.count()) {
    await expect(paper).toHaveClass(/animate-page-turn/)
    await expect(paper).toHaveCSS('opacity', '1')
  }
  // Audit the settled surface, not intermediate colors while route/theme transitions finish.
  await page.evaluate(() => Promise.all(document.getAnimations()
    .filter(animation => animation.effect?.getTiming().iterations !== Infinity)
    .map(animation => animation.finished.catch(() => {}))))
  expect.soft(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${name}: viewport overflow`).toBe(true)
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
  const auditPath = testInfo.outputPath(`${name}-axe.json`)
  await writeFile(auditPath, JSON.stringify({
    testEngine: result.testEngine, timestamp: result.timestamp, url: result.url,
    violations: result.violations, incomplete: result.incomplete,
    passedRules: result.passes.map(rule => rule.id),
  }, null, 2))
  await testInfo.attach(`${name}-axe`, { path: auditPath, contentType: 'application/json' })
  const failures = result.violations.filter(item => ['critical', 'serious'].includes(item.impact))
  expect.soft(failures, `${name}: accessibility and contrast`).toEqual([])
  await page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: true, scale: 'css' })
}

test('night mode: explicit choices survive reload and system changes only affect system mode', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' })
  await page.goto('/chat')
  await expect(page.getByRole('group', { name: '会话模式' })).toBeVisible()
  const settingsLink = page.getByRole('link', { name: '设置', exact: true })
  if (!await settingsLink.isVisible()) await page.getByRole('button', { name: '打开会话列表', exact: true }).click()
  await settingsLink.click()
  await expect(page).toHaveURL(/\/settings$/)
  await expect(page.getByRole('dialog', { name: '会话列表抽屉', exact: true })).toHaveCount(0)
  await expect(page.getByRole('radio', { name: '跟随系统', exact: true })).toBeChecked()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')

  await page.getByRole('radio', { name: '夜间', exact: true }).check()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  expect(await page.evaluate(() => localStorage.getItem('amie-theme'))).toBe('dark')
  await page.reload()
  await expect(page.getByRole('radio', { name: '夜间', exact: true })).toBeChecked()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.emulateMedia({ colorScheme: 'light' })
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')

  await page.getByRole('radio', { name: '日间', exact: true }).check()
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  expect(await page.evaluate(() => localStorage.getItem('amie-theme'))).toBe('light')
  await page.getByRole('radio', { name: '跟随系统', exact: true }).check()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.emulateMedia({ colorScheme: 'light' })
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await page.reload()
  await expect(page.getByRole('radio', { name: '跟随系统', exact: true })).toBeChecked()
  expect(await page.evaluate(() => localStorage.getItem('amie-theme'))).toBe('system')
})

test('night mode: settings, chat bubbles, all work themes, planner inputs and login remain readable', async ({ page }, testInfo) => {
  await chooseNight(page)
  await inspectSurface(page, testInfo, 'night-settings')

  await page.goto('/chat')
  await expect(page.getByText(conversation.messages[1].content)).toBeVisible()
  await inspectSurface(page, testInfo, 'night-chat')
  await page.getByRole('group', { name: '会话模式' }).getByRole('button', { name: '工作', exact: true }).click()
  const desktop = page.getByRole('navigation', { name: '功能桌面' })
  await expect(desktop).toBeVisible()
  for (const [index, title] of ['安排今天', '记录生活', '灵感装扮', '关于我们'].entries()) {
    await desktop.getByRole('button', { name: title, exact: true }).click()
    await expect(desktop.getByRole('region', { name: title, exact: true })).toBeVisible()
    await inspectSurface(page, testInfo, `night-work-${index + 1}`)
  }

  await page.goto('/tools/planner')
  await expect(page.getByText('已经读完一章')).toBeVisible()
  await page.getByRole('button', { name: '添加日程', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '日程内容' })).toBeVisible()
  await inspectSurface(page, testInfo, 'night-planner')
  await page.getByRole('group', { name: '日程与提醒页签' }).getByRole('button', { name: '提醒', exact: true }).click()
  await expect(page.getByText('睡前收好手机')).toBeVisible()
  await inspectSurface(page, testInfo, 'night-reminders')
  await page.goto('/tools/period')
  await expect(page.getByText('周期 28 天')).toBeVisible()
  await inspectSurface(page, testInfo, 'night-period')

  // The login route must use the same device preference before authentication.
  await page.evaluate(() => localStorage.removeItem('cyber-sister-auth'))
  await page.goto('/login')
  await expect(page.getByRole('textbox', { name: '手机号' })).toBeVisible()
  await inspectSurface(page, testInfo, 'night-login')
})

test('night mode: immersive work stays dark and accessible after rotation', async ({ page }, testInfo) => {
  await chooseNight(page)
  await page.goto('/chat')
  await page.getByRole('group', { name: '会话模式' }).getByRole('button', { name: '工作', exact: true }).click()
  await page.setViewportSize({ width: 320, height: 740 })
  await expect(page.getByRole('navigation', { name: '功能桌面' })).toBeVisible()
  await inspectSurface(page, testInfo, 'night-work-320')
  await page.setViewportSize({ width: 844, height: 390 })
  const dialog = page.getByRole('dialog', { name: '沉浸书桌' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('Amie · AI 陪伴')).toBeVisible()
  expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true)
  await inspectSurface(page, testInfo, 'night-landscape')
  await dialog.getByRole('button', { name: '关闭沉浸模式' }).click()
  await expect(dialog).toHaveCount(0)
})
