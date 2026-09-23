/* global document, window */
import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

const json = (route, status, data) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })

const accessible = async page => {
  const audit = await new AxeBuilder({ page }).analyze()
  expect(audit.violations.filter(item => ['serious', 'critical'].includes(item.impact))).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
}

const seedAuth = page => page.addInitScript(() => {
  localStorage.setItem('cyber-sister-auth', JSON.stringify({ state: { token: 'model-providers-e2e', user: { id: 'model-providers-e2e', nickname: '内测用户', persona: 'gentle' }, isLoggedIn: true }, version: 0 }))
  localStorage.setItem('cyber-sister-disclaimer-shown', 'true')
})

const jia = { id: 'p-1', name: '甲家', baseUrl: 'https://api.jia.example/v1', model: 'jia-chat', scenes: ['chat'], priority: 1, enabled: true, hasKey: true }

/**
 * 设置页的严格模拟：管理员接口一个一个对上，写请求只允许出现在预期的路径与载荷上；
 * 其余只读请求给空对象，免得这里跟着设置页上别的卡片一起漂。
 */
async function mockSettings(page, { isInstanceAdmin, providers, writes }) {
  const status = () => ({
    mode: 'external_primary',
    local: { configured: false, state: 'removed' },
    isInstanceAdmin,
    externalFallback: { configured: true, primary: true, consent: true, version: 'cloud-primary-v4', providers: providers.map(provider => ({ name: provider.name, model: provider.model })) },
  })
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname
    const method = route.request().method()
    if (path === '/api/llm/status') return json(route, 200, status())
    if (path === '/api/admin/model-providers') {
      if (method === 'GET') return json(route, 200, { providers })
      expect(method).toBe('POST')
      const body = route.request().postDataJSON()
      writes.push({ method, path, body })
      const created = { id: 'p-2', name: body.name, baseUrl: body.baseUrl, model: body.model, scenes: body.scenes, priority: providers.length + 1, enabled: true, hasKey: Boolean(body.apiKey) }
      providers.push(created)
      return json(route, 200, { provider: created })
    }
    if (path.startsWith('/api/admin/model-providers/')) {
      const id = path.split('/').at(-1)
      if (method === 'POST' && path.endsWith('/test')) {
        writes.push({ method, path })
        return json(route, 200, { ok: true, latencyMs: 180, model: 'jia-chat', reply: '好' })
      }
      expect(method).toBe('PUT')
      const body = route.request().postDataJSON()
      writes.push({ method, path, body })
      const index = providers.findIndex(provider => provider.id === id)
      providers[index] = { ...providers[index], ...body }
      return json(route, 200, { provider: providers[index] })
    }
    expect(method, `Unexpected write to ${path}`).toBe('GET')
    return json(route, 200, {})
  })
}

test('model providers: the instance admin adds one from settings and switches it off', async ({ page }, testInfo) => {
  const providers = [{ ...jia }]
  const writes = []
  await seedAuth(page)
  await mockSettings(page, { isInstanceAdmin: true, providers, writes })

  await page.goto('/settings')
  const card = page.getByRole('region', { name: '模型供应商' })
  await expect(card).toBeVisible()
  await expect(card.getByText('甲家')).toBeVisible()
  await expect(card.getByText(/第 1 位 · 聊天 · 密钥已保存/)).toBeVisible()
  // 现在用的是哪一家，写在聊天模型那张卡里
  await expect(page.getByText('当前在用的模型供应商：甲家。前一家不通时，会自动换下一家。')).toBeVisible()
  await accessible(page)

  // 新增一家：密钥只写不显示，接口只回 hasKey
  await card.getByRole('button', { name: '新增供应商' }).click()
  const form = card.getByRole('form', { name: '新增供应商' })
  await form.getByLabel('显示名').fill('乙家')
  await form.getByLabel(/接口地址/).fill('https://api.yi.example/v1')
  await form.getByLabel('模型名').fill('yi-chat')
  await form.getByLabel('密钥').fill('sk-e2e-never-shown')
  await card.getByRole('button', { name: '保存' }).click()
  await expect(card.getByText('乙家', { exact: true })).toBeVisible()
  expect(writes[0]).toEqual({
    method: 'POST',
    path: '/api/admin/model-providers',
    body: { name: '乙家', baseUrl: 'https://api.yi.example/v1', model: 'yi-chat', scenes: ['chat'], apiKey: 'sk-e2e-never-shown' },
  })
  // 表单收起后，页面上再也不该有那个密钥
  await expect(card.getByRole('form')).toHaveCount(0)
  expect(await page.content()).not.toContain('sk-e2e-never-shown')
  await accessible(page)

  // 启停：走 PUT，只带 enabled
  await card.getByRole('switch', { name: '启用：甲家' }).click()
  await expect(card.getByRole('switch', { name: '启用：甲家' })).toHaveAttribute('aria-checked', 'false')
  expect(writes[1]).toEqual({ method: 'PUT', path: '/api/admin/model-providers/p-1', body: { enabled: false } })

  // 试一下：界面先写清会花一点钱，再给结果
  await expect(card.getByText(/会产生一点点费用/)).toBeVisible()
  await card.getByRole('button', { name: '试一下：乙家' }).click()
  await expect(card.getByRole('status')).toContainText('「乙家」通了：jia-chat，用时 180 毫秒')
  expect(writes[2]).toEqual({ method: 'POST', path: '/api/admin/model-providers/p-2/test' })

  // 最窄的手机上这张卡也不横向滚
  await page.setViewportSize({ width: 320, height: 740 })
  await accessible(page)
  await page.screenshot({ path: testInfo.outputPath('model-providers-admin-320.png'), fullPage: true })
})

test('model providers: an ordinary user never sees the card and never reaches the admin API', async ({ page }) => {
  const providers = [{ ...jia }]
  const writes = []
  const requested = []
  page.on('request', request => {
    if (request.url().includes('/api/admin/model-providers')) requested.push(request.url())
  })
  await seedAuth(page)
  await mockSettings(page, { isInstanceAdmin: false, providers, writes })

  await page.goto('/settings')
  await expect(page.getByRole('heading', { name: '聊天模型', exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: '模型供应商' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '新增供应商' })).toHaveCount(0)
  await expect(page.getByText('当前在用的模型供应商：甲家。前一家不通时，会自动换下一家。')).toBeVisible()
  expect(requested).toEqual([])
  expect(writes).toEqual([])
  await accessible(page)
})
