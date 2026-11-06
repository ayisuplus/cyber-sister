/* global window, document, indexedDB */
import { test, expect } from '@playwright/test'

// Native bridge simulation exercises the shipped iOS JS bundle, not Swift/WKWebView.
const user = { id: 'ios-test-user', phone: '13800138000', nickname: '内测用户', persona: 'gentle' }
const session = { token: 'test-access', refreshToken: 'test-refresh', user }

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const w = window
    w.__vault = null
    w.__nativeEvents = {}
    w.__sharedFiles = []
    w.CapacitorCustomPlatform = { name: 'ios' }
    const methods = names => names.map(name => ({ name, rtype: 'promise' }))
    w.Capacitor = {
      PluginHeaders: [
        { name: 'SessionVault', methods: methods(['read', 'write', 'clear']) },
        ...['App', 'Keyboard'].map(name => ({ name, methods: [{ name: 'addListener', rtype: 'callback' }, ...methods(['removeListener'])] })),
        { name: 'Filesystem', methods: methods(['writeFile', 'deleteFile']) },
        { name: 'Share', methods: methods(['share']) },
      ],
      nativeCallback: async (plugin, _method, options, callback) => {
        const key = `${plugin}:${options.eventName}`
        w.__nativeEvents[key] = callback
        return key
      },
      nativePromise: async (plugin, method, options) => {
        if (method === 'removeListener') { delete w.__nativeEvents[options.callbackId]; return }
        if (plugin === 'SessionVault') {
          if (method === 'read') return { value: w.__vault }
          if (method === 'write') w.__vault = options.value
          if (method === 'clear') w.__vault = null
          return
        }
        if (plugin === 'Filesystem' && method === 'writeFile') return { uri: `file:///cache/${options.path}` }
        if (plugin === 'Share') w.__sharedFiles.push(...options.files)
      },
    }
    localStorage.setItem('cyber-sister-disclaimer-shown', 'true')
  })
  await page.route('https://api.example.invalid/api/**', async route => {
    const path = new URL(route.request().url()).pathname
    const responses = {
      '/api/auth/mobile/request-code': { accepted: true, retryAfter: 60 },
      '/api/auth/mobile/login': session, '/api/auth/mobile/refresh': session,
      '/api/auth/mobile/logout': { success: true },
      '/api/chat/thread': { id: 'ios-thread', messages: [] },
      '/api/chat/openers': { openers: [] }, '/api/chat/nudges': { nudges: [] },
      '/api/llm/status': { externalFallback: { configured: true, consent: true }, isInstanceAdmin: true },
      '/api/user/external-llm-consent': { accepted: true, version: 'cloud-primary-v4' },
      '/api/user/profile': { careEnabled: false },
      '/api/user/personas': { personas: [{ id: 'gentle', name: '姐妹', active: true, card: { name: '姐妹', speech: '耐心倾听', immersion: 'medium', tone: 'gentle', samples: [] } }] },
      '/api/asr/status': { available: false },
      '/api/reminders/sleep': { bedtime: null, wake: null, due: [] },
      '/api/reminders/scheduled': { reminders: [] },
      '/api/user/export': { version: 1, user: { nickname: '合成测试数据' } },
    }
    const headers = { 'access-control-allow-origin': 'http://127.0.0.1:4173', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'GET, POST, PUT, OPTIONS' }
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
    if (path.startsWith('/api/user/assets/')) return route.fulfill({ status: 404, headers, body: '{}' })
    const data = path.startsWith('/api/compliance/usage/') ? { minutes: 0, shouldRemind: false } : responses[path]
    expect(data, `unmocked API ${path}`).toBeDefined()
    return route.fulfill({ status: 200, contentType: 'application/json', headers, body: JSON.stringify(data) })
  })
})

async function login(page) {
  await page.goto('/login')
  await page.getByLabel('手机号', { exact: true }).fill(user.phone)
  await page.getByRole('button', { name: '获取短信验证码' }).click()
  await expect(page.getByRole('status')).toContainText('短信发送')
  await page.getByLabel('内测验证码', { exact: true }).fill('123456')
  await page.getByRole('button', { name: '开始聊天' }).click()
  await expect(page).toHaveURL(/\/chat$/)
  await expect(page.getByRole('textbox', { name: '聊天消息' })).toBeVisible()
}

test('iOS bundle logs in without persisting access tokens and hides desktop/admin settings', async ({ page }) => {
  await login(page)
  expect(await page.evaluate(() => window.__vault)).toBe('test-refresh')
  expect(await page.evaluate(() => localStorage.getItem('cyber-sister-auth'))).not.toContain('test-access')
  await page.getByRole('link', { name: '打开设置', exact: true }).click()
  await expect(page.getByText('模型供应商', { exact: true })).toHaveCount(0)
  await expect(page.getByText('本机助手', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '导出我的全部数据（JSON）' }).click()
  await expect.poll(() => page.evaluate(() => window.__sharedFiles.length)).toBe(1)
})

test('background abort restores the draft, removes unfinished reply and never automatically resends', async ({ page }) => {
  await login(page)
  let sends = 0
  await page.route('**/api/chat/conversations/ios-thread/messages/stream', async route => {
    sends += 1
    await new Promise(resolve => setTimeout(resolve, 1500))
    await route.abort().catch(() => {})
  })
  const input = page.getByRole('textbox', { name: '聊天消息' })
  await input.fill('切后台后保留这句')
  await page.getByRole('button', { name: '发送消息' }).click()
  await expect.poll(() => sends).toBe(1)
  await page.evaluate(() => window.__nativeEvents['App:appStateChange']({ isActive: false }))
  await expect(input).toHaveValue('切后台后保留这句')
  await page.evaluate(() => window.__nativeEvents['App:appStateChange']({ isActive: true }))
  await expect(page.getByText('回复已中断，输入已保留。请先查看最新记录，再决定是否重发。')).toBeVisible()
  expect(sends).toBe(1)
})

test('native font size changes remeasure the letter grid without horizontal overflow', async ({ page }) => {
  await login(page)
  await page.evaluate(() => {
    document.documentElement.style.setProperty('--native-line', '51px')
    document.documentElement.style.setProperty('--native-hand-size', '25.5px')
    document.documentElement.style.fontSize = '24px'
    window.dispatchEvent(new Event('resize'))
  })
  await expect.poll(() => page.locator('.letter-strip').evaluate(element => element.style.top)).toBe('51px')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('iOS bundle accepts a photo and stores imported book text locally without uploading chapters', async ({ page }) => {
  const books = []
  await page.route('**/api/reading/**', async route => {
    const request = route.request()
    const headers = { 'access-control-allow-origin': 'http://127.0.0.1:4173', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'GET, POST, OPTIONS' }
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
    const path = new URL(request.url()).pathname
    let data
    if (path === '/api/reading/shelf/builtin') data = { books: [] }
    else {
      expect(path).toBe('/api/reading/books')
      if (request.method() === 'POST') {
        const metadata = request.postDataJSON()
        expect(metadata).not.toHaveProperty('chapters')
        data = { id: 'local-book', status: 'want', ...metadata }
        books.push(data)
      } else data = books
    }
    return route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify(data) })
  })
  await login(page)
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEUlEQVR4nGP4z8AAQv//Q0kASMgJ9xYlCaIAAAAASUVORK5CYII=', 'base64')
  await page.getByLabel('选择照片', { exact: true }).setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: png })
  await expect(page.getByAltText('待发送的照片预览')).toBeVisible()
  await page.getByRole('button', { name: '打开导航', exact: true }).click()
  await page.getByRole('navigation', { name: '页面导航' }).last().getByRole('link', { name: '读书', exact: true }).click()
  await page.getByLabel('选一本书', { exact: true }).setInputFiles({ name: '手机导入.txt', mimeType: 'text/plain', buffer: Buffer.from('这是仅保存在本机的合成正文。') })
  await expect(page.getByText('《手机导入》放好了', { exact: true })).toBeVisible()
  await expect(page.getByText('只在你的设备上', { exact: true })).toBeVisible()
  const stored = await page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('amie-books')
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const db = request.result
      const read = db.transaction('books').objectStore('books').get('local-book')
      read.onsuccess = () => { resolve(read.result); db.close() }
      read.onerror = () => { reject(read.error); db.close() }
    }
  }))
  expect(stored.chapters[0].text).toContain('仅保存在本机')
})
