/* global document, window */
import { expect, test } from '@playwright/test'

async function openNotebook(page) {
  await page.addInitScript(() => {
    localStorage.setItem('cyber-sister-auth', JSON.stringify({ state: { token: 'layout-test', user: { id: 'layout-test', persona: 'gentle' }, isLoggedIn: true }, version: 0 }))
    localStorage.setItem('cyber-sister-disclaimer-shown', 'true')
  })
  const messages = Array.from({ length: 36 }, (_, index) => ({
    id: `layout-${index}`, role: index % 2 ? 'assistant' : 'user', source: 'local_template',
    content: `第 ${index + 1} 段。${'这是用来检查分页的合成文字，窗口变宽、变窄时都应该能够继续阅读。'.repeat(4)}`,
    createdAt: '2026-11-06T10:00:00.000Z',
  }))
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname
    const values = {
      '/api/chat/thread': { id: 'layout-test', messages },
      '/api/chat/openers': { openers: [] }, '/api/chat/nudges': { nudges: [] },
      '/api/llm/status': { externalFallback: { configured: false, consent: true } },
      '/api/user/profile': { careEnabled: false }, '/api/weather': { place: null },
      '/api/user/personas': { personas: [] }, '/api/asr/status': { available: false },
      '/api/reminders/sleep': { bedtime: null, wake: null, due: [] },
      '/api/pets': { food: 0, pets: [], active: null }, '/api/bridge': { bridges: [] },
      '/api/work/status': { capabilities: { backgroundTasks: false } }, '/api/work/tasks': { tasks: [] },
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(values[path] || {}) })
  })
  await page.goto('/chat')
  await expect(page.getByRole('region', { name: '信纸', exact: true })).toHaveAttribute('data-ready', 'true')
  await page.evaluate(() => document.fonts.ready)
}

test('notebook adapts: wide desktop pages turn vertically; phone pages keep horizontal navigation', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1920, height: 1080 })
  await openNotebook(page)
  const book = page.locator('.letter-book')
  const viewport = page.getByRole('region', { name: '信纸', exact: true })
  const nav = page.getByRole('navigation', { name: '翻页', exact: true })
  const desktop = await book.boundingBox()
  expect(desktop.width).toBeGreaterThan(1000)
  expect(desktop.width / desktop.height).toBeGreaterThan(1.3)
  await page.getByRole('button', { name: '上一页', exact: true }).focus()
  const before = await nav.innerText()
  await page.keyboard.press('ArrowUp')
  await expect(nav).not.toHaveText(before)
  await page.screenshot({ path: testInfo.outputPath('notebook-desktop.png') })

  await page.setViewportSize({ width: 390, height: 844 })
  await expect.poll(async () => (await book.boundingBox()).width).toBeLessThan(391)
  const phone = await book.boundingBox()
  expect(phone.height).toBeGreaterThan(phone.width * 1.2)
  await page.getByRole('button', { name: '上一页', exact: true }).focus()
  const mobileBefore = await nav.innerText()
  await page.keyboard.press('ArrowLeft')
  await expect(nav).not.toHaveText(mobileBefore)
  await expect(viewport).toHaveAttribute('data-ready', 'true')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('notebook-phone.png') })
})
