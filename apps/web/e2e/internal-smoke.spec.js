import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

const json = (route, status, body) => route.fulfill({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
})

const expectNoSeriousAxeFindings = async page => {
  const results = await new AxeBuilder({ page }).analyze()
  expect(results.violations.filter(item => ['critical', 'serious'].includes(item.impact))).toEqual([])
}

const seedAuth = page => page.addInitScript(() => {
  localStorage.setItem('cyber-sister-auth', JSON.stringify({
    state: {
      token: 'e2e-access-token',
      user: { id: 'user-e2e', nickname: '内测用户', persona: 'gentle' },
      isLoggedIn: true,
    },
    version: 0,
  }))
  localStorage.setItem('cyber-sister-disclaimer-shown', 'true')
})

const mockChatBootstrap = async (page, accepted) => {
  await page.route('**/api/chat/conversations', route => {
    if (route.request().method() === 'GET') return json(route, 200, [])
    return json(route, 201, { id: 'conversation-e2e', messages: [] })
  })
  await page.route('**/api/user/external-llm-consent', route => {
    if (route.request().method() === 'GET') {
      return json(route, 200, { accepted, version: 'qwen-fallback-v1', updatedAt: null })
    }
    const choice = route.request().postDataJSON().accepted
    return json(route, 200, { accepted: choice, version: 'qwen-fallback-v1', updatedAt: '2026-08-29T00:00:00.000Z' })
  })
}

test('login is keyboard-accessible and has no serious axe findings', async ({ page }) => {
  await page.route('**/api/auth/login', route => json(route, 401, { error: 'INVALID_CREDENTIALS' }))
  await page.goto('/login')

  await page.getByRole('textbox', { name: '手机号' }).fill('13900000000')
  await page.getByRole('textbox', { name: '内测验证码' }).fill('000000')
  await page.getByRole('button', { name: '开始聊天' }).press('Enter')
  await expect(page.getByRole('alert')).toHaveText('手机号或验证码错误')

  await expectNoSeriousAxeFindings(page)
})

test('local model failure never forces cloud consent and preserves the original input', async ({ page }) => {
  await seedAuth(page)
  await mockChatBootstrap(page, null)
  await page.route('**/api/chat/conversations/conversation-e2e/messages', route => (
    json(route, 503, { code: 'LOCAL_LLM_UNAVAILABLE' })
  ))
  await page.goto('/chat')

  await expect(page.getByRole('dialog', { name: /云端备用模型/ })).toHaveCount(0)
  const input = page.getByRole('textbox', { name: '聊天消息' })
  await input.fill('这条消息需要重试')
  await page.getByRole('button', { name: '发送消息' }).click()

  await expect(page.getByText(/本地模型暂时不可用，且没有在未授权时转发到云端/)).toBeVisible()
  await expect(input).toHaveValue('这条消息需要重试')
  await expectNoSeriousAxeFindings(page)
})

test('a blocked crisis response is rendered without a provider reply', async ({ page }) => {
  await seedAuth(page)
  await mockChatBootstrap(page, true)
  await page.route('**/api/chat/conversations/conversation-e2e/messages', route => json(route, 200, {
    status: 'blocked',
    userMessage: { id: 'u1', role: 'user', content: '冻结危机输入' },
    intervention: { level: 'high', message: '固定且已批准的干预内容', resources: [] },
  }))
  await page.goto('/chat')

  await page.getByRole('textbox', { name: '聊天消息' }).fill('冻结危机输入')
  await page.getByRole('button', { name: '发送消息' }).click()

  await expect(page.getByRole('alertdialog', { name: '我很担心你' })).toContainText('固定且已批准的干预内容')
  await expect(page.getByRole('button', { name: '我知道了' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: '我知道了' })).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(page.getByRole('button', { name: '我知道了' })).toBeFocused()
  await expect(page.getByText('冻结危机输入')).toHaveCount(1)
  await expectNoSeriousAxeFindings(page)
})

test('persona switches immediately and explicit memories support CRUD', async ({ page }) => {
  await seedAuth(page)
  let memories = []
  await page.route('**/api/user/external-llm-consent', route => json(route, 200, {
    accepted: true,
    version: 'qwen-fallback-v1',
    updatedAt: '2026-08-29T00:00:00.000Z',
  }))
  await page.route('**/api/user/persona', route => json(route, 200, {
    persona: route.request().postDataJSON().persona,
  }))
  await page.route('**/api/memories**', route => {
    const request = route.request()
    const pathname = new URL(request.url()).pathname
    if (request.method() === 'GET') {
      return json(route, 200, { data: memories, total: memories.length, page: 1, limit: 100 })
    }
    if (request.method() === 'POST') {
      const created = { id: 'memory-e2e', ...request.postDataJSON() }
      memories = [created]
      return json(route, 201, created)
    }
    if (request.method() === 'PUT' && pathname.endsWith('/memory-e2e')) {
      const updated = { id: 'memory-e2e', ...request.postDataJSON() }
      memories = [updated]
      return json(route, 200, updated)
    }
    if (request.method() === 'DELETE' && pathname.endsWith('/memory-e2e')) {
      memories = []
      return json(route, 200, { success: true })
    }
    return json(route, 400, { error: 'unexpected memory request' })
  })

  await page.goto('/profile')
  await page.getByRole('button', { name: /理性军师/ }).click()
  await expect(page.getByText('人格已切换，下一条消息立即生效')).toBeVisible()
  await expect(page.getByRole('button', { name: /理性军师/ })).toHaveAttribute('aria-pressed', 'true')
  await expectNoSeriousAxeFindings(page)

  await page.getByRole('button', { name: /显式记忆管理/ }).click()
  await expect(page.getByText('还没有记忆')).toBeVisible()
  await page.getByLabel('记忆内容').fill('我喜欢低饱和豆沙色')
  await page.getByLabel('标签（逗号分隔）').fill('妆容，豆沙色')
  await page.getByRole('button', { name: '保存' }).click()
  await expect(page.getByText('记忆已创建')).toBeVisible()
  await expect(page.getByText('我喜欢低饱和豆沙色')).toBeVisible()

  await page.getByRole('button', { name: '编辑这条记忆' }).click()
  await page.getByLabel('记忆内容').fill('我偏爱低饱和豆沙色')
  await page.getByRole('button', { name: '保存' }).click()
  await expect(page.getByText('记忆已更新')).toBeVisible()
  await expect(page.getByText('我偏爱低饱和豆沙色')).toBeVisible()
  await expectNoSeriousAxeFindings(page)

  await page.getByRole('button', { name: '删除这条记忆' }).click()
  await expect(page.getByText('记忆已删除')).toBeVisible()
  await expect(page.getByText('还没有记忆')).toBeVisible()
})

test('installation admin can one-click fill a llama.cpp connection', async ({ page }) => {
  await seedAuth(page)
  await page.route('**/api/llm/status', route => json(route, 200, {
    mode: 'local_first',
    local: { configured: false, state: 'not_configured' },
    externalFallback: { configured: false, consent: null, version: 'qwen-fallback-v1' },
  }))
  await page.route('**/api/admin/llm/local/config', route => json(route, 200, {
    enabled: false,
    baseUrl: null,
    model: null,
    revision: 0,
    lastVerifiedAt: null,
    apiKeyConfigured: false,
  }))
  await page.route('**/api/admin/llm/local/detect', route => json(route, 200, {
    preset: route.request().postDataJSON().preset,
    baseUrl: 'http://host.docker.internal:8080/v1',
    models: ['friend-8b'],
    model: 'friend-8b',
    state: 'ready',
    apiKeyConfigured: false,
  }))

  await page.goto('/profile/local-model')
  await page.getByRole('button', { name: '自动发现并填写' }).click()

  await expect(page.getByLabel('llama.cpp 地址')).toHaveValue('http://host.docker.internal:8080/v1')
  await expect(page.getByRole('combobox', { name: '模型' })).toHaveValue('friend-8b')
  await expect(page.getByText(/部署服务器，不是你当前使用的手机/)).toBeVisible()
  await expectNoSeriousAxeFindings(page)
})

test('makeup deep link loads and provides a stable return link', async ({ page }) => {
  await page.goto('http://127.0.0.1:4174/makeup/')
  await expect(page).toHaveURL(/\/makeup\/$/)
  await expect(page.getByRole('link', { name: /返回赛博姐妹/ })).toHaveAttribute('href', '/tools')
})
