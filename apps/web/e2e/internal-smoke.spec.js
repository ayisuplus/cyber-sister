/* global document, window, MouseEvent, getComputedStyle, DOMMatrix, MutationObserver */
import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

const json = (route, status, body) => route.fulfill({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
})

// 没同意经期：日历仍会读旧记录（撤回后也能看、能删），记录列表是数组，其余经期接口回同意状态
const routePeriodNotConsented = page => page.route('**/api/tools/period**', route => {
  const { pathname } = new URL(route.request().url())
  return json(route, 200, pathname === '/api/tools/period' ? [] : { accepted: false, updatedAt: null })
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
  // 只有一段对话：打开即是这段，没有新建
  await page.route('**/api/chat/thread', route => json(route, 200, { id: 'conversation-e2e', messages: [] }))
  await page.route('**/api/user/external-llm-consent', route => {
    if (route.request().method() === 'GET') {
      return json(route, 200, { accepted, version: 'cloud-primary-v4', updatedAt: null })
    }
    const choice = route.request().postDataJSON().accepted
    return json(route, 200, { accepted: choice, version: 'cloud-primary-v4', updatedAt: '2026-08-29T00:00:00.000Z' })
  })
}

// SSE 帧编码：与服务端契约一致的纯 data 帧（无 event: 行），帧间空行分隔。
const sse = frames => frames.map(frame => `data: ${JSON.stringify(frame)}`).join('\n\n') + '\n\n'

const fulfillStream = (route, frames) => route.fulfill({
  status: 200,
  contentType: 'text/event-stream',
  body: sse(frames),
})

// 信纸的页码「3 / 8」；封面那一页写「封面」
const letterPages = async page => {
  const text = await page.getByRole('navigation', { name: '翻页' }).locator('span[aria-hidden="true"]').innerText()
  if (text === '封面') return { cover: true, last: 0, total: 0 }
  const [shown, total] = text.split(' / ')
  return { cover: false, last: Number(shown), total: Number(total) }
}
// 一直往前翻到第一页（再往前就是封面）
const flipToFirstPage = async page => {
  for (let guard = 0; guard < 40; guard += 1) {
    const text = await page.getByRole('navigation', { name: '翻页' }).locator('span[aria-hidden="true"]').innerText()
    if (text === '封面' || /^1 \//.test(text)) return
    await page.getByRole('button', { name: '上一页' }).click()
  }
  throw new Error('翻不到第一页')
}
// 翻页的拓印只活几百毫秒：在页面里盯住 ghost 插进来的那一刻，把它当时的动效与形变记下来
const recordFlips = page => page.evaluate(() => {
  window.__flipObserver?.disconnect()
  window.__flips = []
  window.__flipObserver = new MutationObserver(records => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node.nodeType !== 1 || !node.classList.contains('letter-ghost')) continue
        const style = getComputedStyle(node)
        window.__flips.push({
          className: node.className,
          animation: style.animationName,
          origin: style.transformOrigin,
          m11: style.transform === 'none' ? 1 : new DOMMatrix(style.transform).m11,
        })
      }
    }
  })
  window.__flipObserver.observe(document.querySelector('.letter-ghost-host'), { childList: true })
})
const flips = page => page.evaluate(() => window.__flips)
// 入场动画还在跑的时候，字是半透明的：等有限时长的动画都落定，再查对比度
const settleAnimations = page => page.waitForFunction(() => document.getAnimations()
  .filter(animation => Number.isFinite(animation.effect?.getComputedTiming?.().iterations))
  .every(animation => animation.playState !== 'running'))

test('login is keyboard-accessible and has no serious axe findings', async ({ page }) => {
  await page.route('**/api/auth/login', route => json(route, 401, { error: 'INVALID_CREDENTIALS' }))
  await page.goto('/login')

  await page.getByRole('textbox', { name: '手机号' }).fill('13900000000')
  await page.getByRole('textbox', { name: '内测验证码' }).fill('000000')
  await page.getByRole('button', { name: '开始聊天' }).press('Enter')
  await expect(page.getByRole('alert')).toHaveText('手机号或验证码错误')

  await expectNoSeriousAxeFindings(page)
})

test('cloud provider failure shows honest unavailability and preserves the original input', async ({ page }) => {
  await seedAuth(page)
  await mockChatBootstrap(page, null)
  await page.route('**/api/chat/conversations/conversation-e2e/messages/stream', route => (
    json(route, 503, { error: '云端模型暂时不可用', code: 'LLM_UNAVAILABLE' })
  ))
  await page.goto('/chat')

  const input = page.getByRole('textbox', { name: '聊天消息' })
  await input.fill('这条消息需要重试')
  await page.getByRole('button', { name: '发送消息' }).click()

  await expect(page.getByText(/云端模型暂时不可用/)).toBeVisible()
  await expect(input).toHaveValue('这条消息需要重试')
  await expectNoSeriousAxeFindings(page)
})

test('a blocked crisis response is rendered without a provider reply', async ({ page }) => {
  await seedAuth(page)
  await mockChatBootstrap(page, true)
  await page.route('**/api/chat/conversations/conversation-e2e/messages/stream', route => fulfillStream(route, [{
    event: 'blocked',
    status: 'blocked',
    userMessage: { id: 'u1', role: 'user', content: '冻结危机输入' },
    intervention: { level: 'high', message: '固定且已批准的干预内容', resources: [] },
  }]))
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

test('her page: speaking style switches immediately and explicit memories support CRUD', async ({ page }) => {
  await seedAuth(page)
  let memories = []
  await page.route('**/api/user/external-llm-consent', route => json(route, 200, {
    accepted: true,
    version: 'cloud-primary-v4',
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

  // 说话方式与记忆同在「她」页面，不再需要跳转
  await page.goto('/her')
  await page.getByRole('button', { name: /安静/ }).click()
  await expect(page.getByText('换好了，下一条消息就用这种方式和你说话')).toBeVisible()
  await expect(page.getByRole('button', { name: /安静/ })).toHaveAttribute('aria-pressed', 'true')
  await expectNoSeriousAxeFindings(page)

  await expect(page.getByText('她还没记住什么')).toBeVisible()
  await page.getByLabel('记忆内容').fill('我喜欢低饱和豆沙色')
  await page.getByRole('button', { name: '记住', exact: true }).click()
  await expect(page.getByText('记住了')).toBeVisible()
  await expect(page.getByText('我喜欢低饱和豆沙色')).toBeVisible()

  await page.getByRole('button', { name: '改一改' }).click()
  await page.getByLabel('记忆内容').fill('我偏爱低饱和豆沙色')
  await page.getByRole('button', { name: '保存' }).click()
  await expect(page.getByText('改好了')).toBeVisible()
  await expect(page.getByText('我偏爱低饱和豆沙色')).toBeVisible()
  await expectNoSeriousAxeFindings(page)

  await page.getByRole('button', { name: /^删除这条记忆/ }).click()
  await page.getByRole('button', { name: '确认删除' }).click()
  await expect(page.getByText('删掉了')).toBeVisible()
  await expect(page.getByText('她还没记住什么')).toBeVisible()
})


test('streaming chat settles deltas into the persisted messages from done', async ({ page }) => {
  await seedAuth(page)
  await mockChatBootstrap(page, true)
  let releaseStream
  const streamGate = new Promise(resolve => { releaseStream = resolve })
  await page.route('**/api/chat/conversations/*/messages/stream', async route => {
    await streamGate
    // 心跳注释帧必须被客户端忽略；done 携带已落库的持久消息
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: ': ping\n\n' + sse([
        { event: 'delta', text: '我在听，' },
        { event: 'delta', text: '慢慢说。' },
        {
          event: 'done',
          status: 'ok',
          userMessage: { id: 'u-stream-1', role: 'user', content: '最近有点累', createdAt: '2026-09-04T00:00:00.000Z' },
          aiMessage: { id: 'a-stream-1', role: 'assistant', content: '我在听，慢慢说。', createdAt: '2026-09-04T00:00:01.000Z' },
          source: 'qwen',
        },
      ]),
    })
  })
  await page.goto('/chat')

  const input = page.getByRole('textbox', { name: '聊天消息' })
  await input.fill('最近有点累')
  await page.getByRole('button', { name: '发送消息' }).click()

  // 流进行中：发送守卫生效，输入与发送键禁用，等待服务端事件
  await expect(page.getByRole('button', { name: '发送消息' })).toBeDisabled()
  await expect(input).toBeDisabled()
  releaseStream()

  // done 后临时气泡被持久消息替换：内容合并完整、只出现一次；普通回复不再每条挂「云端模型」
  await expect(page.getByText('我在听，慢慢说。')).toBeVisible()
  await expect(page.getByText('我在听，慢慢说。')).toHaveCount(1)
  await expect(page.getByText('最近有点累')).toHaveCount(1)
  await expect(page.getByText('云端模型', { exact: true })).toHaveCount(0)
  await expect(input).toHaveValue('')
})

test('a safety replace swaps the streamed draft before the final template message', async ({ page }) => {
  await seedAuth(page)
  await mockChatBootstrap(page, true)
  await page.route('**/api/chat/conversations/*/messages/stream', route => fulfillStream(route, [
    { event: 'delta', text: '原始模型输出片段' },
    { event: 'replace', content: '换成温和的安全回复。' },
    {
      event: 'done',
      status: 'ok',
      userMessage: { id: 'u-stream-2', role: 'user', content: '讲讲那段经历', createdAt: '2026-09-04T00:01:00.000Z' },
      aiMessage: { id: 'a-stream-2', role: 'assistant', content: '换成温和的安全回复。', createdAt: '2026-09-04T00:01:01.000Z' },
      source: 'local_template',
    },
  ]))
  await page.goto('/chat')

  await page.getByRole('textbox', { name: '聊天消息' }).fill('讲讲那段经历')
  await page.getByRole('button', { name: '发送消息' }).click()

  // 终态只保留 replace 后的模板内容，被替换的草稿片段不得残留
  await expect(page.getByText('换成温和的安全回复。')).toBeVisible()
  await expect(page.getByText('换成温和的安全回复。')).toHaveCount(1)
  await expect(page.getByText('原始模型输出片段')).toHaveCount(0)
  await expect(page.getByText('本地安全模板')).toBeVisible()
})

test('a blocked stream response shows the crisis intervention without a provider reply', async ({ page }) => {
  await seedAuth(page)
  await mockChatBootstrap(page, true)
  await page.route('**/api/chat/conversations/*/messages/stream', route => fulfillStream(route, [{
    event: 'blocked',
    status: 'blocked',
    userMessage: { id: 'u-stream-3', role: 'user', content: '流式危机输入', createdAt: '2026-09-04T00:02:00.000Z' },
    intervention: { level: 'high', message: '固定且已批准的干预内容', resources: [] },
  }]))
  await page.goto('/chat')

  await page.getByRole('textbox', { name: '聊天消息' }).fill('流式危机输入')
  await page.getByRole('button', { name: '发送消息' }).click()

  await expect(page.getByRole('alertdialog', { name: '我很担心你' })).toContainText('固定且已批准的干预内容')
  // 危机命中无模型回复：用户消息落库展示一次，无来源标识的 AI 气泡
  await expect(page.getByText('流式危机输入')).toHaveCount(1)
  await expect(page.getByText('云端模型', { exact: true })).toHaveCount(0)
})

test('a mid-stream error drops the draft reply and keeps the input for retry', async ({ page }) => {
  await seedAuth(page)
  await mockChatBootstrap(page, true)
  await page.route('**/api/chat/conversations/*/messages/stream', route => fulfillStream(route, [
    { event: 'delta', text: '半截回复' },
    { event: 'error', code: 'LLM_UNAVAILABLE' },
  ]))
  await page.goto('/chat')

  const input = page.getByRole('textbox', { name: '聊天消息' })
  await input.fill('这条流会失败')
  await page.getByRole('button', { name: '发送消息' }).click()

  // 中途失败不落库：临时气泡移除，页面给出失败提示，原输入保留供重试
  await expect(page.getByText('云端模型暂时不可用。原输入已保留，请稍后重试。')).toBeVisible()
  await expect(page.getByText('半截回复')).toHaveCount(0)
  await expect(page.locator('p.whitespace-pre-wrap', { hasText: '这条流会失败' })).toHaveCount(0)
  await expect(input).toHaveValue('这条流会失败')
})

test('tool run chips land with the done message and survive a history reload', async ({ page }) => {
  await seedAuth(page)
  await mockChatBootstrap(page, true)
  const toolRuns = [{ tool: 'add_todo', ok: true, summary: '已添加待办「周六复诊」' }]
  await page.route('**/api/chat/conversations/*/messages/stream', route => fulfillStream(route, [
    { event: 'delta', text: '好的，' },
    { event: 'delta', text: '已帮你记下。' },
    {
      event: 'done',
      status: 'ok',
      userMessage: { id: 'u-tool-1', role: 'user', content: '提醒我周六复诊', createdAt: '2026-09-04T00:03:00.000Z' },
      aiMessage: { id: 'a-tool-1', role: 'assistant', content: '好的，已帮你记下。', createdAt: '2026-09-04T00:03:01.000Z', toolRuns },
      source: 'local_model',
    },
  ]))
  await page.goto('/chat')

  await page.getByRole('textbox', { name: '聊天消息' }).fill('提醒我周六复诊')
  await page.getByRole('button', { name: '发送消息' }).click()

  // 翻页的拓印里也有这段字的副本，只在眼前这张信纸上算数
  const letter = page.getByRole('region', { name: '信纸' })
  // 流式 done 落地：chip 随 aiMessage 替换临时气泡而出现，只出现一次
  await expect(letter.getByLabel('已执行：已添加待办「周六复诊」')).toBeVisible()
  await expect(letter.getByLabel('已执行：已添加待办「周六复诊」')).toHaveCount(1)

  // 历史加载路径：刷新后打开这段对话，消息同样带 toolRuns
  await page.unroute('**/api/chat/thread')
  await page.route('**/api/chat/thread', route => json(route, 200, {
    id: 'conversation-e2e',
    messages: [
      { id: 'u-tool-1', role: 'user', content: '提醒我周六复诊', createdAt: '2026-09-04T00:03:00.000Z' },
      { id: 'a-tool-1', role: 'assistant', content: '好的，已帮你记下。', createdAt: '2026-09-04T00:03:01.000Z', toolRuns },
    ],
  }))
  await page.reload()

  await expect(letter.getByText('好的，已帮你记下。')).toBeVisible()
  await expect(letter.getByLabel('已执行：已添加待办「周六复诊」')).toBeVisible()
  await expect(letter.getByLabel('已执行：已添加待办「周六复诊」')).toHaveCount(1)
})

test('notes: one timeline holds the diary and what she read, written from one composer', async ({ page }) => {
  await seedAuth(page)
  const today = new Date().toISOString().slice(0, 10)
  let entries = []
  let notes = []
  await page.route('**/api/diary**', route => {
    const request = route.request()
    if (request.method() === 'GET') return json(route, 200, entries)
    if (request.method() === 'PUT') {
      const day = new URL(request.url()).pathname.split('/').at(-1)
      const entry = { id: 'd-e2e', day, aiComment: null, aiCommentSource: null, ...request.postDataJSON() }
      entries = [entry]
      return json(route, 200, entry)
    }
    return json(route, 200, { success: true })
  })
  await page.route('**/api/reading/notes**', route => {
    const request = route.request()
    if (request.method() === 'GET') return json(route, 200, { notes })
    const body = request.postDataJSON()
    notes = [{ id: 'n-e2e', book: body.book, page: null, content: body.note, createdAt: `${today}T10:00:00.000Z`, aiComment: null }]
    return json(route, 200, { bookId: 'b-e2e', title: body.book })
  })

  await page.goto('/tools/notes')
  await expect(page.getByText('还没有手记')).toBeVisible()

  // 一段话就是今天的日记
  await page.getByRole('button', { name: '开心' }).click()
  await page.getByLabel('手记内容').fill('今天去了新开的桂花展')
  await page.getByRole('button', { name: '记下来' }).click()
  await expect(page.getByText('写好了')).toBeVisible()
  await expect(page.getByText('今天去了新开的桂花展')).toBeVisible()

  // 标成一本书，就记到那本书下，仍在同一条时间线里
  await page.getByRole('button', { name: /记的是一本书/ }).click()
  await page.getByLabel('手记内容').fill('有庆那段看得心里发紧')
  await page.getByLabel('书名').fill('活着')
  await page.getByRole('button', { name: '记下来' }).click()
  await expect(page.getByText('有庆那段看得心里发紧')).toBeVisible()
  await expect(page.getByText(/《活着》/)).toBeVisible()
  await expect(page.getByRole('navigation', { name: '手记分类' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '让姐妹看看' })).toHaveCount(0)

  await page.reload()
  await expect(page.getByText('今天去了新开的桂花展')).toBeVisible()
  await expect(page.getByText('有庆那段看得心里发紧')).toBeVisible()
  await expectNoSeriousAxeFindings(page)
})

test('schedule: a one-off for tomorrow lands under upcoming, and handing it to her stays honest', async ({ page }) => {
  await seedAuth(page)
  const tasks = []
  await page.route('**/api/reminders/scheduled', route => {
    const request = route.request()
    if (request.method() === 'GET') return json(route, 200, { reminders: tasks })
    const body = request.postDataJSON()
    const next = body.date ? new Date(`${body.date}T${body.time}`) : new Date(Date.now() + 60 * 60 * 1000)
    const created = { id: `task-${tasks.length + 1}`, weekdays: [], monthDay: null, instruction: null, status: 'active', ...body, nextFireAt: next.toISOString() }
    tasks.push(created)
    return json(route, 201, { reminder: created })
  })
  await routePeriodNotConsented(page)
  await page.goto('/tools/calendar')

  await expect(page.getByText('日历还是空的')).toBeVisible()
  await page.getByRole('button', { name: /记一件事/ }).first().click()
  await page.getByLabel('要记的事').fill('给妈妈打电话')
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000)
  const day = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`
  await page.getByLabel('日期').fill(day)
  await page.getByLabel('时间').fill('18:30')
  await page.getByRole('button', { name: '保存' }).click()

  const upcoming = page.getByRole('region', { name: '接下来' })
  await expect(upcoming.getByText('给妈妈打电话')).toBeVisible()
  await expect(upcoming.getByText('明天')).toBeVisible()

  await page.getByRole('button', { name: /记一件事/ }).first().click()
  await page.getByRole('button', { name: '交给她去做' }).click()
  await page.getByRole('button', { name: '每天' }).click()
  await page.getByLabel('这件事叫什么').fill('晨间简报')
  await page.getByLabel('时间').fill('08:00')
  await page.getByLabel('要她做什么').fill('看看今天的安排，提醒我最要紧的一件')
  await page.getByRole('button', { name: '保存' }).click()
  await expect(page.getByRole('region', { name: '重复' }).getByText('云端执行未接通 · 到点暂不执行')).toBeVisible()
  await expectNoSeriousAxeFindings(page)
})

test('one conversation: no list and no new conversation, older messages load above, and the drawer only navigates', async ({ page, isMobile }) => {
  await seedAuth(page)
  await mockChatBootstrap(page, true)
  const at = (minute) => new Date(Date.UTC(2026, 8, 5, 8, minute)).toISOString()
  const latest = Array.from({ length: 50 }, (_, index) => ({ id: `m${index + 10}`, role: index % 2 ? 'assistant' : 'user', content: `较新的第${index + 10}条`, createdAt: at(index + 10) }))
  const older = Array.from({ length: 10 }, (_, index) => ({ id: `m${index}`, role: 'user', content: `更早的第${index}条`, createdAt: at(index) }))
  const pages = []
  await page.unroute('**/api/chat/thread')
  await page.route('**/api/chat/thread**', route => {
    const pageNumber = new URL(route.request().url()).searchParams.get('page')
    pages.push(pageNumber)
    return json(route, 200, { id: 'conversation-e2e', messages: pageNumber === '2' ? older : latest })
  })
  await page.route('**/api/work/status', route => json(route, 200, { capabilities: { backgroundTasks: false } }))
  await page.route('**/api/work/tasks', route => json(route, 200, { tasks: [] }))
  await page.goto('/chat')

  await expect(page.getByRole('heading', { name: 'Amie', exact: true })).toBeVisible()
  const letter = page.getByRole('region', { name: '信纸' })
  await expect(letter.getByText('较新的第59条')).toBeVisible()
  await expect(page.getByRole('group', { name: '会话模式' })).toHaveCount(0)
  const input = page.getByRole('textbox', { name: '聊天消息' })
  await expect(input).toHaveAttribute('placeholder', '写下想说的…')
  await expect(page.getByRole('button', { name: '语音输入', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '添加照片', exact: true })).toBeVisible()

  // 不再有「加载更早的消息」：翻到第一页再往前翻，就取更早的信
  await expect(page.getByRole('button', { name: '加载更早的消息' })).toHaveCount(0)
  await flipToFirstPage(page)
  const beforeOlder = await letterPages(page)
  await page.getByRole('button', { name: '上一页' }).click()
  await expect(letter.getByText('更早的第0条')).toBeAttached()
  // 更早的信插进来后要等重新分页（下一帧才量）、页码往后挪了再接着翻：
  // 赶在重排之前翻到封面，会被重排按新增的页数挪回信纸上
  await expect.poll(async () => (await letterPages(page)).total).toBeGreaterThan(beforeOlder.total)
  await expect(letter.getByText('较新的第59条')).toHaveCount(1)
  expect(pages).toContain('2')
  // 更早的已经取完：再往前就是封面，这本子是从封面开始的
  await flipToFirstPage(page)
  await page.getByRole('button', { name: '上一页' }).click()
  // 翻页要等这一页落定：页码读一次就下结论，在并行跑满时会读到翻之前那一页
  await expect.poll(async () => (await letterPages(page)).cover).toBe(true)
  await expect(page.getByRole('button', { name: '上一页' })).toBeDisabled()

  if (isMobile) await page.getByRole('button', { name: '打开导航', exact: true }).click()
  await expect(page.getByRole('navigation', { name: '会话列表' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /新建会话|新会话/ })).toHaveCount(0)
  await expect(page.getByRole('navigation', { name: '页面导航' }).last().getByRole('link', { name: '对话', exact: true })).toBeVisible()
  await expectNoSeriousAxeFindings(page)
})
test('the letter: handwriting on ruled paper, a full page turns over, and writing a line takes you back to the newest page', async ({ page }) => {
  await seedAuth(page)
  await mockChatBootstrap(page, true)
  // 手写字按字切块：只下载用到的那几块，不整包下载
  const fontSlices = new Set()
  page.on('request', request => { if (request.url().endsWith('.woff2')) fontSlices.add(request.url()) })
  const at = (minute) => new Date(Date.UTC(2026, 8, 21, 12, minute)).toISOString()
  const long = '今天下午在图书馆坐了很久，窗外一直下雨，我把那本书又读了一遍，读到最后一章的时候突然很想哭。'
  const history = Array.from({ length: 30 }, (_, index) => ({
    id: `h${index}`, role: index % 2 ? 'assistant' : 'user', createdAt: at(index),
    content: index % 3 ? `第${index}段：${long}` : `第${index}段：嗯`,
  }))
  await page.unroute('**/api/chat/thread')
  await page.route('**/api/chat/thread**', route => json(route, 200, { id: 'conversation-e2e', messages: history }))
  await page.route('**/api/chat/nudges**', route => json(route, 200, { nudges: [] }))
  await page.goto('/chat')

  const paper = page.getByRole('region', { name: '信纸' })
  await expect(paper).toBeVisible()
  await expect(paper.getByText('第29段', { exact: false })).toBeAttached()
  // 打开就在最新一页；宽屏也只摊开一页：本子居中，不再左右两页
  await expect.poll(async () => (await letterPages(page)).total).toBeGreaterThan(1)
  let pages = await letterPages(page)
  expect(pages.last).toBe(pages.total)
  const book = await page.locator('.letter-book').evaluate(element => {
    const box = element.getBoundingClientRect()
    const column = element.parentElement.getBoundingClientRect()
    return { width: box.width, left: box.left - column.left, right: column.right - box.right }
  })
  expect(book.width).toBeLessThanOrEqual(600)
  expect(Math.abs(book.left - book.right)).toBeLessThan(2)
  // 手写字；横格与页边线画在整张纸上，从纸顶一直贯穿到书写行
  const entry = page.locator('.letter-entry').last()
  expect(await entry.evaluate(element => getComputedStyle(element).fontFamily)).toContain('LXGW WenKai Screen')
  const sheetBackground = await page.locator('.letter-sheet').evaluate(element => getComputedStyle(element).backgroundImage)
  // 一整张纸上两层：横向位置的那条页边线 + 一叠横格；页码行与书写行都在同一张纸上
  expect(sheetBackground.match(/repeating-linear-gradient/g)).toHaveLength(2)
  expect(sheetBackground).toContain('to right')
  // 正文列与最底下的书写行共用同一条页边线（纸带里正文列离纸的左边 = 书写行文字离纸的左边）
  const aligned = await page.evaluate(() => {
    const viewport = document.querySelector('.letter-viewport').getBoundingClientRect()
    const stripLeft = parseFloat(getComputedStyle(document.querySelector('.letter-strip')).left)
    const writing = document.querySelector('.letter-writing textarea').getBoundingClientRect()
    return { column: viewport.left + stripLeft, writing: writing.left }
  })
  expect(Math.abs(aligned.writing - aligned.column)).toBeLessThan(1.5)
  await expectNoSeriousAxeFindings(page)

  expect(fontSlices.size).toBeGreaterThan(0)
  expect(fontSlices.size).toBeLessThan(40)

  // 往回翻一页（系统要求减少动态效果时，翻页是旧页淡出、新页淡入，不转）；键盘 → 翻回来
  await recordFlips(page)
  await page.getByRole('button', { name: '上一页' }).click()
  await expect.poll(async () => (await flips(page)).length).toBe(2)
  const faded = await flips(page)
  expect(faded.map(entry => entry.animation)).toEqual(['letterFade', 'letterFadeIn'])
  expect(faded[0].className).not.toContain('letter-ghost--')
  expect(faded[1].className).toContain('letter-ghost--back')
  expect(faded.map(entry => entry.m11)).toEqual([1, 1])
  expect((await letterPages(page)).last).toBeLessThan(pages.total)
  await page.keyboard.press('ArrowRight')
  await expect.poll(async () => (await letterPages(page)).last).toBe(pages.total)

  // 她写满这一页：自动翻到新的一页
  const reply = Array.from({ length: 12 }, (_, index) => `第${index + 1}句：${long}`).join('\n\n')
  await page.route('**/api/chat/conversations/*/messages/stream', route => fulfillStream(route, [
    { event: 'delta', text: reply },
    {
      event: 'done', status: 'ok', source: 'qwen',
      userMessage: { id: 'u-new', role: 'user', content: '晚安前想和你说说话', createdAt: at(40) },
      aiMessage: { id: 'a-new', role: 'assistant', content: reply, createdAt: at(41) },
    },
  ]))
  await page.getByRole('textbox', { name: '聊天消息' }).fill('晚安前想和你说说话')
  await page.getByRole('button', { name: '发送消息' }).click()
  await expect(paper.getByText('第12句', { exact: false }).first()).toBeAttached()
  await expect.poll(async () => (await letterPages(page)).total).toBeGreaterThan(pages.total)
  pages = await letterPages(page)
  expect(pages.last).toBe(pages.total)

  // 往回翻看时你又写了一句：翻回最新一页接着写（她回信时不拽走你的那一面在单测里）
  await page.getByRole('button', { name: '上一页' }).click()
  await page.route('**/api/chat/conversations/*/messages/stream', route => fulfillStream(route, [
    { event: 'delta', text: reply },
    {
      event: 'done', status: 'ok', source: 'qwen',
      userMessage: { id: 'u-2', role: 'user', content: '还有一件事', createdAt: at(50) },
      aiMessage: { id: 'a-2', role: 'assistant', content: reply, createdAt: at(51) },
    },
  ]))
  await page.getByRole('textbox', { name: '聊天消息' }).fill('还有一件事')
  await page.getByRole('button', { name: '发送消息' }).click()
  await expect.poll(async () => { const now = await letterPages(page); return now.last === now.total && now.total > pages.total }).toBe(true)

  // 换成印刷体：信纸和翻页都不变，只换字
  await page.goto('/settings')
  await page.getByRole('radio', { name: '信纸上的字：印刷' }).check()
  await page.goto('/chat')
  await expect(page.locator('.letter-entry').last()).toBeAttached()
  expect(await page.locator('.letter-entry').last().evaluate(element => getComputedStyle(element).fontFamily)).not.toContain('LXGW')

  // 夜里：暗色的纸也读得清
  await page.evaluate(() => localStorage.setItem('amie-theme', 'dark'))
  await page.reload()
  await expect(page.getByRole('region', { name: '信纸' })).toBeVisible()
  await expectNoSeriousAxeFindings(page)

  // 最窄的手机上不横向滚
  await page.setViewportSize({ width: 320, height: 640 })
  await page.reload()
  await expect(page.getByRole('region', { name: '信纸' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

// 空对话打开就是合上的本子：只看得到封面。写下一句就翻开，翻页绕左边封线转过去
test.describe('本子：封面与翻页', () => {
  // 上面那条看的是系统要求「减少动态效果」时的淡出；这里要真的看它转过去
  test.use({ contextOptions: { reducedMotion: 'no-preference' } })

  test('the notebook opens on its cover, and pages turn around the left binding', async ({ page }) => {
    await seedAuth(page)
    await mockChatBootstrap(page, true)
    await page.route('**/api/chat/nudges**', route => json(route, 200, { nudges: [] }))
    await page.goto('/chat')

    const paper = page.getByRole('region', { name: '信纸' })
    const cover = page.locator('.letter-cover-page')
    expect((await letterPages(page)).cover).toBe(true)
    await expect(page.getByRole('button', { name: '上一页' })).toBeDisabled()
    await expect(paper.getByText('嗨，我是你的Amie')).toBeVisible()
    // 封面是封皮色、不画横格；左边一条封皮
    expect(await cover.evaluate(element => getComputedStyle(element).backgroundImage)).not.toContain('to right')
    await expect(page.locator('.letter-spine')).toBeVisible()
    await settleAnimations(page)
    await expectNoSeriousAxeFindings(page)

    // 写下一句：封面翻过去，落在第一页
    await page.route('**/api/chat/conversations/*/messages/stream', route => fulfillStream(route, [
      { event: 'delta', text: '我在呢' },
      {
        event: 'done', status: 'ok', source: 'qwen',
        userMessage: { id: 'u-1', role: 'user', content: '在吗', createdAt: '2026-09-22T13:00:00.000Z' },
        aiMessage: { id: 'a-1', role: 'assistant', content: '我在呢', createdAt: '2026-09-22T13:00:01.000Z' },
      },
    ]))
    await page.getByRole('textbox', { name: '聊天消息' }).fill('在吗')
    await recordFlips(page)
    await page.getByRole('button', { name: '发送消息' }).click()
    // 你写下的这一句把封面翻过去：翻的是眼前这一页，绕左边封线转（transform-origin 在左边缘），父层给景深
    await expect.poll(async () => (await flips(page)).length).toBeGreaterThan(0)
    const [turned] = await flips(page)
    expect(turned.className).toContain('letter-ghost--forward')
    expect(turned.animation).toBe('letterFlipForward')
    expect(turned.origin).toMatch(/^0px/)
    expect(await page.locator('.letter-ghost-host').evaluate(element => getComputedStyle(element).perspective)).toBe('1600px')
    await expect(paper.getByText('我在呢')).toBeVisible()
    expect((await letterPages(page)).total).toBe(1)
    await expect(cover).toHaveCount(0)
    await settleAnimations(page)
    await expectNoSeriousAxeFindings(page)

    // 再往前翻：封面从左边翻回来盖在旧页的静影上（两层），这一刻它是背面朝前（m11 = cos 180° = -1）
    await recordFlips(page)
    await page.getByRole('button', { name: '上一页' }).click()
    await expect.poll(async () => (await flips(page)).length).toBe(2)
    const [still, back] = await flips(page)
    expect(still.className).not.toContain('letter-ghost--')
    expect(back.className).toContain('letter-ghost--back')
    expect(back.animation).toBe('letterFlipBack')
    expect(back.origin).toMatch(/^0px/)
    expect(back.m11).toBeLessThan(0)
    expect((await letterPages(page)).cover).toBe(true)
    await expect(page.getByRole('button', { name: '上一页' })).toBeDisabled()
  })
})

test('appearance: upload avatar and chat background, both render in settings and chat', async ({ page }) => {
  await seedAuth(page)
  const tinyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
  await page.route('**/api/user/assets/*', route => {
    const method = route.request().method()
    if (method === 'PUT') return json(route, 200, { url: '/api/user/assets/avatar?v=1' })
    if (method === 'DELETE') return json(route, 200, { ok: true })
    return route.fulfill({ status: 200, contentType: 'image/png', body: tinyPng })
  })
  await mockChatBootstrap(page, true)
  await page.unroute('**/api/chat/thread')
  await page.route('**/api/chat/thread', route => json(route, 200, {
    id: 'c-1',
    mode: 'chat',
    title: 'Amie',
    messages: [{ id: 'u-1', role: 'user', content: '今天心情不错', createdAt: '2026-09-06T08:00:00.000Z' }],
  }))
  await page.goto('/settings')

  // 装扮区：上传头像 → 预览出现并写回用户资料
  await page.getByLabel('更换头像').setInputFiles({ name: 'a.png', mimeType: 'image/png', buffer: tinyPng })
  await expect(page.getByRole('img', { name: '头像预览' })).toBeVisible()

  // 设聊天背景 → 缩略图出现
  await page.getByLabel('选择聊天背景图片').setInputFiles({ name: 'bg.png', mimeType: 'image/png', buffer: tinyPng })
  await expect(page.getByRole('img', { name: '聊天背景预览' })).toBeVisible()

  // seedAuth 的 init 脚本每次导航都会重写 localStorage；补一笔已上传的头像，模拟资料已持久化
  await page.addInitScript(() => {
    const raw = localStorage.getItem('cyber-sister-auth')
    if (!raw) return
    const data = JSON.parse(raw)
    data.state.user = { ...data.state.user, avatarUrl: '/api/user/assets/avatar?v=1' }
    localStorage.setItem('cyber-sister-auth', JSON.stringify(data))
  })
  await page.goto('/chat')
  await expect(page.getByRole('region', { name: '信纸' }).getByText('今天心情不错')).toBeVisible()
  await expect(page.getByRole('img', { name: '我的头像' })).toBeVisible()
  await expect(page.locator('.chat-full')).toHaveCSS('background-image', /blob:/)
  await expectNoSeriousAxeFindings(page)
})

// 2x2 有效 PNG：选照片/单品上传用（<img> 能触发 onLoad）
const TINY_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEUlEQVR4nGP4z8AAQv//Q0kASMgJ9xYlCaIAAAAASUVORK5CYII=', 'base64')

test('navigation: every entry lives in one list under the conversations, and old links land on the new entries', async ({ page, isMobile }) => {
  await seedAuth(page)
  await mockChatBootstrap(page, true)
  await page.route('**/api/reminders/scheduled', route => json(route, 200, { reminders: [] }))
  await routePeriodNotConsented(page)
  await page.goto('/chat')

  if (isMobile) await page.getByRole('button', { name: '打开导航', exact: true }).click()
  const nav = page.getByRole('navigation', { name: '页面导航' }).last()
  const expected = [['对话', '/chat'], ['她', '/her'], ['日历', '/tools/calendar'], ['手记', '/tools/notes'], ['读书', '/tools/reading'], ['装扮', '/tools/style'], ['设置', '/settings']]
  await expect(nav.getByRole('link')).toHaveCount(expected.length)
  for (const [name, href] of expected) {
    await expect(nav.getByRole('link', { name, exact: true })).toHaveAttribute('href', href)
  }
  await nav.getByRole('link', { name: '日历', exact: true }).click()
  await expect(page).toHaveURL(/\/tools\/calendar$/)
  await expect(page.getByRole('heading', { name: '日历', exact: true })).toBeVisible()

  for (const [legacy, target] of [
    ['/tools/handbook', /\/tools\/calendar$/],
    ['/tools/study', /\/tools\/calendar$/],
    ['/tools/planner?tab=reminders', /\/tools\/calendar$/],
    ['/tools/schedule', /\/tools\/calendar$/],
    ['/tools/period', /\/tools\/calendar$/],
    ['/tools/diary', /\/tools\/notes$/],
    ['/tools/wardrobe', /\/tools\/style\?tab=wardrobe$/],
    ['/tools/workspace', /\/her$/],
    ['/profile', /\/settings$/],
  ]) {
    await page.goto(legacy)
    await expect(page).toHaveURL(target)
  }
})
test('dress-up is a collection: save a photo or a pasted link, filter what you want, and take one out', async ({ page }) => {
  await seedAuth(page)
  await mockChatBootstrap(page, true)
  let items = []
  const posts = []
  await page.route(/\/api\/collection(?:\/[^?]*)?(?:\?.*)?$/, route => {
    const request = route.request()
    const url = new URL(request.url())
    const { pathname } = url
    const id = pathname.split('/')[3]
    if (/\/(photo|thumb)$/.test(pathname)) return route.fulfill({ status: 200, contentType: 'image/png', body: TINY_PNG })
    if (request.method() === 'GET') return json(route, 200, { items: items.filter(item => item.shelf === url.searchParams.get('shelf')) })
    if (request.method() === 'DELETE') {
      items = items.filter(item => item.id !== id)
      return json(route, 200, { success: true })
    }
    const body = request.postDataBuffer().toString('latin1')
    const field = name => body.match(new RegExp(`name="${name}"\\r\\n\\r\\n([^\\r]*)`))?.[1]
    const text = name => (field(name) === undefined ? undefined : Buffer.from(field(name), 'latin1').toString('utf8'))
    if (request.method() === 'PUT') {
      items = items.map(item => (item.id === id ? { ...item, status: text('status') ?? item.status } : item))
      return json(route, 200, items.find(item => item.id === id))
    }
    posts.push(body)
    const withPhoto = body.includes('name="photo"')
    const created = {
      id: `c${posts.length}`, shelf: text('shelf'), name: text('name'), category: text('category') || null, status: text('status'),
      note: null, link: text('link') ?? null,
      photoUrl: withPhoto ? `/api/collection/c${posts.length}/photo?v=1` : null, thumbUrl: withPhoto ? `/api/collection/c${posts.length}/thumb?v=1` : null,
    }
    items = [created, ...items]
    return json(route, 200, created)
  })

  await page.goto('/tools/style?tab=wardrobe')
  await expect(page.getByText(/衣柜还空着/)).toBeVisible()
  // 手机上「拍一张」直接打开系统相机
  await expect(page.getByLabel('拍一张（打开相机）')).toHaveAttribute('capture', 'environment')

  // 从相册选一张：在这台设备上压缩成两张 JPEG 再传
  await page.getByRole('button', { name: '放进来' }).click()
  await page.getByLabel('从相册选一张').setInputFiles({ name: 'shirt.png', mimeType: 'image/png', buffer: TINY_PNG })
  const form = page.getByRole('form', { name: '放进衣柜' })
  await form.getByLabel('名字').fill('白衬衫')
  await form.getByRole('button', { name: '上衣' }).click()
  await form.getByRole('button', { name: '存下来' }).click()
  const shelf = page.getByRole('list', { name: '衣柜' })
  await expect(shelf.getByRole('button', { name: '白衬衫' })).toBeVisible()
  expect(posts[0].match(/Content-Type: image\/jpeg/g)).toHaveLength(2)

  // 粘贴一段淘宝分享：名字自动填好、标成「想要」，卡片写着「淘宝」
  await page.getByRole('button', { name: '放进来' }).click()
  await page.getByRole('button', { name: '粘贴链接' }).click()
  await page.getByLabel('把分享的文字或链接粘贴到这里').fill('【淘宝】https://m.tb.cn/h.Abc123?tk=XyZ9 CZ0001 「法式复古碎花连衣裙女夏」点击链接直接打开')
  await page.getByRole('button', { name: '下一步' }).click()
  await expect(page.getByLabel('名字')).toHaveValue('法式复古碎花连衣裙女夏')
  await expect(page.getByRole('button', { name: '想要' })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: '存下来' }).click()
  const wanted = shelf.getByRole('button', { name: '法式复古碎花连衣裙女夏，想要' })
  await expect(wanted).toContainText('淘宝')
  expect(posts[1]).not.toContain('name="photo"')
  await expectNoSeriousAxeFindings(page)

  // 只看「想要」的
  await page.getByRole('group', { name: '想要还是已有' }).getByRole('button', { name: '想要' }).click()
  await expect(shelf.getByRole('button')).toHaveCount(1)
  await page.getByRole('group', { name: '想要还是已有' }).getByRole('button', { name: '全部' }).click()

  // 打开一件：改成「已有」，再删掉
  await wanted.click()
  const detail = page.getByRole('article', { name: '法式复古碎花连衣裙女夏' })
  await expect(detail.getByRole('link', { name: /打开淘宝链接/ })).toHaveAttribute('href', 'https://m.tb.cn/h.Abc123?tk=XyZ9')
  await detail.getByRole('button', { name: '已有' }).click()
  await expect(detail.getByRole('button', { name: '已有' })).toHaveAttribute('aria-pressed', 'true')
  await expectNoSeriousAxeFindings(page)
  await detail.getByRole('button', { name: '删除' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: '删掉' }).click()
  await expect(shelf.getByRole('button')).toHaveCount(1)

  // 化妆间是另一个柜子；最窄的手机上不横向滚
  await page.getByRole('button', { name: '化妆间', exact: true }).click()
  await expect(page.getByText(/化妆间还空着/)).toBeVisible()
  await page.setViewportSize({ width: 320, height: 740 })
  await page.goto('/tools/style?tab=wardrobe')
  await expect(page.getByRole('list', { name: '衣柜' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('chat photo: pick a photo, send it, and the persona review lands next to the image bubble', async ({ page }) => {
  await seedAuth(page)
  await mockChatBootstrap(page, true)
  await page.route('**/api/chat/conversations/*/messages/stream', route => {
    // 照片消息走 multipart：content 可为空，image 为文件字段
    expect(route.request().headers()['content-type'] || '').toContain('multipart/form-data')
    return fulfillStream(route, [
      { event: 'delta', text: '这个配色很衬你。' },
      {
        event: 'done',
        status: 'ok',
        userMessage: { id: 'u-img-1', role: 'user', content: '', imageExt: '.jpg', createdAt: '2026-09-08T10:00:00.000Z' },
        aiMessage: { id: 'a-img-1', role: 'assistant', content: '这个配色很衬你。', source: 'qwen', createdAt: '2026-09-08T10:00:01.000Z' },
        source: 'qwen',
      },
    ])
  })
  await page.route('**/api/chat/images/u-img-1', route => route.fulfill({
    status: 200,
    contentType: 'image/png',
    body: TINY_PNG,
  }))
  await page.goto('/chat')

  await page.locator('input[aria-label="选择照片"]').setInputFiles({ name: 'outfit.png', mimeType: 'image/png', buffer: TINY_PNG })
  await expect(page.getByAltText('待发送的照片预览')).toBeVisible()
  await page.getByRole('button', { name: '发送消息' }).click()

  // AI 点评落气泡；用户气泡内出现照片（done 后由服务端取图渲染）。翻页的拓印里也有副本，只看信纸这一层
  const letter = page.getByRole('region', { name: '信纸' })
  await expect(letter.getByText('这个配色很衬你。')).toBeVisible()
  await expect(letter.getByAltText('发出的照片')).toBeVisible()
})

test('her · letters: one letter with her suggestions — take it to chat or accept it in one tap', async ({ page }) => {
  await seedAuth(page)
  await page.route('**/api/user/companion', route => json(route, 200, { revision: 1, state: { protection: { mode: 'open' }, experienceCount: 1, learning: { brevity: 0.5, samples: 1 } } }))
  await page.route('**/api/user/profile', route => {
    const request = route.request()
    if (request.method() === 'PUT') return json(route, 200, { ...request.postDataJSON() })
    return json(route, 200, { careEnabled: true, letterFreqDays: 3 })
  })
  const suggestion = {
    kind: 'edit_memory', title: '把这条改准确', memoryId: 'm1', memoryRevision: 1,
    quote: '喜欢桂花味', suggestText: '喜欢桂花味的拿铁', chatText: '就按你信里说的改吧', decided: null,
  }
  const letter = {
    id: 'l1', periodStart: '2026-09-09T00:00:00.000Z', freqDays: 3,
    content: '见信好。\n\n你把那条记忆说得更准了。', suggestions: [suggestion], readAt: null,
  }
  const decidedWith = []
  await page.route('**/api/letters**', route => {
    const request = route.request()
    const pathname = new URL(request.url()).pathname
    if (request.method() === 'POST' && pathname === '/api/letters/generate') return json(route, 200, { letter, created: false, reason: 'not_due' })
    if (request.method() === 'GET' && pathname === '/api/letters') return json(route, 200, { letters: [letter] })
    if (request.method() === 'POST' && pathname.endsWith('/read')) return json(route, 200, { success: true })
    if (request.method() === 'POST' && pathname.endsWith('/decide')) {
      const { decision } = request.postDataJSON()
      decidedWith.push(decision)
      return json(route, 200, { letter: { ...letter, suggestions: [{ ...suggestion, decided: decision === 'accept' ? 'accepted' : 'dismissed' }] } })
    }
    return json(route, 404, { error: 'unexpected letters request' })
  })
  await page.route('**/api/memories**', route => json(route, 200, { data: [], total: 0, page: 1, limit: 20 }))

  await page.goto('/her')
  // 最新一封、建议的三个动作、频率三档
  await expect(page.getByRole('region', { name: '她的来信' }).getByText('见信好。')).toBeVisible()
  const suggestionRegion = page.getByRole('region', { name: '把这条改准确' })
  for (const action of ['同意采纳', '带去对话', '不用']) {
    await expect(suggestionRegion.getByRole('button', { name: action })).toBeVisible()
  }
  await expect(page.getByRole('radio', { name: '三天一封' })).toBeChecked()

  // 「带去对话」把引导句填进输入框（一次性交接，不自动发送）
  await suggestionRegion.getByRole('button', { name: '带去对话' }).click()
  await expect(page).toHaveURL(/\/chat$/)
  await expect(page.getByRole('textbox', { name: '聊天消息' })).toHaveValue('就按你信里说的改吧')

  // 「同意采纳」→ 服务端处置，条目变「已采纳」
  await page.goto('/her')
  await page.getByRole('region', { name: '把这条改准确' }).getByRole('button', { name: '同意采纳' }).click()
  await expect(page.getByRole('region', { name: '把这条改准确' }).getByText('已采纳')).toBeVisible()
  expect(decidedWith).toEqual(['accept'])

  // 「不用」→ 只标「没采纳」
  await page.goto('/her')
  await page.getByRole('region', { name: '把这条改准确' }).getByRole('button', { name: '不用' }).click()
  await expect(page.getByRole('region', { name: '把这条改准确' }).getByText('没采纳')).toBeVisible()
  expect(decidedWith).toEqual(['accept', 'dismiss'])
  await expectNoSeriousAxeFindings(page)
})
test('she speaks in the conversation: reminder, care and the weekly letter in one place', async ({ page }) => {
  await seedAuth(page)
  await mockChatBootstrap(page, true)
  const nudges = [
    { id: 'reminder:d1', kind: 'reminder', content: '该喝水啦', reason: '你在日历上定的（每天 10:00）' },
    { id: 'care:task-soon:t1:2026-09-20', kind: 'care', content: '「面试」还有 1 天\n还有几天呢，不用惦记，到点我提醒你。', reason: '你在日历上记的日子', action: { to: '/tools/calendar', label: '看看日历' } },
    { id: 'letter:l1', kind: 'letter', content: '内测用户，见信好。\n\n你们聊了 23 轮；新记下了 1 件事：「喜欢火锅」。\n\n—— 你的姐妹', reason: '她写给你的信' },
  ]
  const acked = []
  await page.route('**/api/chat/nudges**', route => {
    const request = route.request()
    if (request.method() === 'GET') return json(route, 200, { nudges: nudges.filter(nudge => !acked.includes(nudge.id)) })
    acked.push(decodeURIComponent(new URL(request.url()).pathname.split('/').at(-2)))
    return json(route, 200, { success: true })
  })

  await page.goto('/chat')

  const said = page.getByRole('region', { name: '她想对你说' })
  // 她主动说的话也写在本子上（先等它们到，再翻页）
  await expect(said.getByText('该喝水啦')).toBeAttached()
  await expect(said.getByText(/你们聊了 23 轮/)).toBeAttached()
  // 三条加起来不止一页，而本子一次只有一页：翻到最早那一页再点
  await flipToFirstPage(page)
  await expect(said.getByText('该喝水啦')).toBeVisible()
  await expect(said.getByText('为什么看到这条：你在日历上定的（每天 10:00）')).toBeVisible()
  await expect(said.getByText(/「面试」还有 1 天/)).toBeAttached()
  await expect(said.getByText(/你们聊了 23 轮/)).toBeAttached()
  await expect(said.getByText('—— 你的姐妹', { exact: false })).toBeAttached()
  await expect(said.getByRole('link', { name: '看看日历 →' })).toHaveAttribute('href', '/tools/calendar')

  await said.getByRole('button', { name: '知道了' }).first().click()
  await expect(said.getByText('该喝水啦')).toHaveCount(0)
  await expect.poll(() => acked).toEqual(['reminder:d1'])
  await expect(said.getByText(/你们聊了 23 轮/)).toBeAttached()
  await expectNoSeriousAxeFindings(page)
})

// 造一本最小的 EPUB：全部 stored 条目，不压缩也是合法 zip，读的那条路一样走通。
const zipOf = files => {
  const encoder = new TextEncoder()
  const locals = []
  const centrals = []
  let offset = 0
  for (const [name, text] of files) {
    const nameBytes = Buffer.from(name, 'utf8')
    const body = Buffer.from(encoder.encode(text))
    const local = Buffer.alloc(30 + nameBytes.length + body.length)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x800, 6)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(body.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    nameBytes.copy(local, 30)
    body.copy(local, 30 + nameBytes.length)
    locals.push(local)

    const central = Buffer.alloc(46 + nameBytes.length)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x800, 8)
    central.writeUInt32LE(body.length, 20)
    central.writeUInt32LE(body.length, 24)
    central.writeUInt16LE(nameBytes.length, 28)
    central.writeUInt32LE(offset, 42)
    nameBytes.copy(central, 46)
    centrals.push(central)
    offset += local.length
  }
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(files.length, 8)
  eocd.writeUInt16LE(files.length, 10)
  eocd.writeUInt32LE(centralSize, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, ...centrals, eocd])
}

const chapter = (title, body) => `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title></head>
<body><h1>${title}</h1><p>${body}</p></body></html>`

const TINY_EPUB = zipOf([
  ['META-INF/container.xml', `<?xml version="1.0"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`],
  ['OEBPS/content.opf', `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>活着</dc:title><dc:creator>余华</dc:creator></metadata>
  <manifest>
    <item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="ch2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="c1"/><itemref idref="c2"/></spine>
</package>`],
  ['OEBPS/ch1.xhtml', chapter('第一章 出门', '我比现在年轻十岁的时候，获得了一个游手好闲的职业。')],
  ['OEBPS/ch2.xhtml', chapter('第二章 回家', '那天傍晚下起了雨，他站在门口没有进来。')],
])

test('reading: a book stays on this device, and asking her about a passage also lands in the conversation', async ({ page }) => {
  await seedAuth(page)
  await mockChatBootstrap(page, true)

  let shelf = []
  let progress = null
  await page.route('**/api/reading/books**', route => {
    const request = route.request()
    const method = request.method()
    if (method === 'GET') return json(route, 200, shelf)
    if (method === 'POST') {
      const body = request.postDataJSON()
      shelf = [{
        id: 'book-e2e', title: body.title, author: body.author ?? null, status: 'reading',
        format: body.format, fileName: body.fileName, locator: null, percent: null,
        totalPages: null, currentPage: 0, noteCount: 0,
      }]
      return json(route, 200, shelf[0])
    }
    if (method === 'PUT') {
      progress = request.postDataJSON()
      shelf = [{ ...shelf[0], ...progress }]
      return json(route, 200, shelf[0])
    }
    return json(route, 200, { success: true })
  })
  // 这一轮真的会落库，所以对话也要留下来：后注册的路由优先，覆盖 mockChatBootstrap 的空对话
  const thread = { id: 'conversation-e2e', messages: [] }
  await page.route('**/api/chat/thread', route => json(route, 200, thread))
  // 这本书的笔记；注册在书架路由之后，后注册的优先匹配
  const notes = []
  let written = null
  await page.route('**/api/reading/books/*/notes', route => {
    const request = route.request()
    if (request.method() === 'GET') return json(route, 200, notes)
    written = request.postDataJSON()
    const note = { id: `note-${notes.length + 1}`, bookId: 'book-e2e', ...written, aiCommentSource: written.aiComment ? 'chat' : null, createdAt: new Date().toISOString() }
    notes.unshift(note)
    return json(route, 200, { note, book: shelf[0] })
  })

  await page.route('**/api/chat/conversations/conversation-e2e/messages/stream', route => {
    const asked = route.request().postDataJSON()
    const userMessage = { id: 'u1', role: 'user', content: asked.content, createdAt: new Date().toISOString() }
    const aiMessage = { id: 'a1', role: 'assistant', content: '他那时候还不懂。', createdAt: new Date().toISOString() }
    thread.messages = [...thread.messages, userMessage, aiMessage]
    // 书里的那一段作为资料随这一轮发过去，但不进消息正文
    expect(asked.reading).toMatchObject({ bookId: 'book-e2e' })
    expect(asked.reading.passage).toContain('我比现在年轻十岁的时候')
    return fulfillStream(route, [
      { event: 'delta', text: '他那时候还不懂。' },
      { event: 'done', status: 'ok', userMessage, aiMessage, source: 'cloud_model' },
    ])
  })

  await page.goto('/tools/reading')
  await expect(page.getByText('书架还空着')).toBeVisible()

  // 放一本书进来：解析在浏览器里做，文件不上传
  await page.getByLabel('选一本书').setInputFiles({ name: '活着.epub', mimeType: 'application/epub+zip', buffer: TINY_EPUB })
  await expect(page.getByText('《活着》放好了')).toBeVisible()
  const onShelf = page.getByRole('button', { name: /^活着/ })
  await expect(onShelf).toBeVisible()
  await expectNoSeriousAxeFindings(page)

  // 打开来读
  await onShelf.click()
  await expect(page).toHaveURL(/\/tools\/reading\/book-e2e$/)
  await expect(page.getByText(/我比现在年轻十岁的时候/)).toBeVisible()

  // 选中一段问她：回答显示在书旁边
  await page.evaluate(() => {
    const paragraph = document.querySelector('article p')
    const range = document.createRange()
    range.selectNodeContents(paragraph)
    const selection = window.getSelection()
    selection.removeAllRanges()
    selection.addRange(range)
    paragraph.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
  })
  await page.getByRole('button', { name: '问问她', exact: true }).click()
  await expect(page.getByText(/选中的这一段会一起发给云端的模型/)).toBeVisible()
  await page.getByLabel('想问她什么').fill('他为什么这么说？')
  await page.getByRole('button', { name: '问她', exact: true }).click()
  await expect(page.getByText('他那时候还不懂。')).toBeVisible()
  await expectNoSeriousAxeFindings(page)

  // 同一轮也留在那段唯一的对话里
  await page.goto('/chat')
  await expect(page.getByRole('region', { name: '信纸' }).getByText(/读《活着》时问：他为什么这么说？/)).toBeVisible()

  // 目录翻章，进度回存
  await page.goto('/tools/reading/book-e2e')
  await page.getByRole('button', { name: '目录与字号' }).click()
  await page.getByRole('button', { name: '第二章 回家' }).click()
  await expect(page.getByText(/那天傍晚下起了雨/)).toBeVisible()

  // 刷新后书还在这台设备上，不用重新放
  await page.reload()
  await expect(page.getByText(/我比现在年轻十岁的时候|那天傍晚下起了雨/)).toBeVisible()
  await expect(page.getByText('文件不在这台设备上')).toHaveCount(0)
  await expectNoSeriousAxeFindings(page)

  // 记一笔：原文和位置一起记下，回头在正文里认得出来
  const selectFirstParagraph = () => page.evaluate(() => {
    const paragraph = document.querySelector('article p')
    const range = document.createRange()
    range.selectNodeContents(paragraph)
    window.getSelection().removeAllRanges()
    window.getSelection().addRange(range)
    paragraph.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
  })

  await selectFirstParagraph()
  await page.getByRole('button', { name: '记一笔', exact: true }).click()
  await page.getByLabel('写下你的感想').fill('这句写得真好')
  await page.getByRole('button', { name: '记下来', exact: true }).click()
  await expect(page.getByText('记下了')).toBeVisible()
  expect(written).toMatchObject({ content: '这句写得真好', locator: '0:0' })
  expect(written.quote).toContain('我比现在年轻十岁的时候')

  // 关掉重开，划过的那句话还标在正文里，点一下看得到当时写的
  await page.reload()
  const marked = page.getByRole('button', { name: /你在这里记过/ })
  await expect(marked).toBeVisible()
  await marked.click()
  const said = page.getByRole('complementary', { name: '你在这里记过' })
  await expect(said.getByText('这句写得真好')).toBeVisible()
  await expectNoSeriousAxeFindings(page)

  // 同一条笔记在手记里带着原文，点一下回到书里那一处，而且不改掉你读到哪儿
  await page.route('**/api/diary**', route => json(route, 200, []))
  await page.route('**/api/reading/notes**', route => json(route, 200, {
    notes: notes.map(note => ({ ...note, book: '活着' })),
  }))
  await page.goto('/tools/notes')
  await expect(page.getByText('这句写得真好')).toBeVisible()
  await expect(page.getByText(/我比现在年轻十岁的时候/)).toBeVisible()

  await page.getByRole('link', { name: '回到书里这一处' }).click()
  await expect(page).toHaveURL(/\/tools\/reading\/book-e2e\?at=/)
  await expect(page.getByText(/正在回看你记过的地方/)).toBeVisible()
  await expectNoSeriousAxeFindings(page)

  // 最窄的手机上，选中后的两个动作也得放得下，页面不横向滚
  await page.setViewportSize({ width: 320, height: 740 })
  await page.evaluate(() => {
    const paragraph = document.querySelector('article p')
    const range = document.createRange()
    range.selectNodeContents(paragraph)
    window.getSelection().removeAllRanges()
    window.getSelection().addRange(range)
    paragraph.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
  })
  await expect(page.getByRole('button', { name: '问问她', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '记一笔', exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await expectNoSeriousAxeFindings(page)
})

test('landing: only promises what she can do today', async ({ page }) => {
  await page.goto('/landing/index.html')
  const body = page.locator('body')

  // 「过几天问你答辩」是她写信时想到的、而且是你来的时候才问——写清楚这两个前提
  await expect(body).toContainText('周三晚上打开对话，她问我答辩怎么样了')
  await expect(body).toContainText('她写信时想到')
  await expect(body).not.toContainText('她主动问我')
  // 收拢之后是 3 种说话方式，不是 6 个人格
  await expect(body).not.toContainText('可切换人格')
  await expect(body).toContainText('种说话方式')
  // 前情摘要和写信前的回想都是模型推断，不能再说「不由模型推断」
  await expect(body).not.toContainText('不由模型推断')
  await expect(body).toContainText('条推送，她只在你来时说话')
})

test('a sense of measure: her state says only what changed, tool work is one quiet line, and the period page is honest about being late', async ({ page }) => {
  await seedAuth(page)
  await mockChatBootstrap(page, true)

  // 「她」页：平常只有一句话，没有按钮，也没有计数
  let companion = { revision: 3, state: { protection: { mode: 'open' }, experienceCount: 42, trust: 0.9, learning: { brevity: 0.5, samples: 0 } } }
  await page.route('**/api/user/companion', route => json(route, 200, companion))
  await page.route('**/api/memories**', route => json(route, 200, { data: [], total: 0, page: 1, limit: 20 }))
  await page.route('**/api/letters**', route => {
    const request = route.request()
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/letters/generate') {
      return json(route, 200, { letter: null, created: false, reason: 'off' })
    }
    return json(route, 200, { letters: [] })
  })
  await page.route('**/api/user/profile', route => json(route, 200, { careEnabled: true, letterFreqDays: null }))
  await page.goto('/her')
  const state = page.getByRole('region', { name: '她的状态' })
  await expect(state.getByText('她现在是平常的节奏。')).toBeVisible()
  await expect(state.getByRole('button')).toHaveCount(0)
  await expect(state.getByText(/42|已纳入的经历/)).toHaveCount(0)

  // 放慢了节奏、学到了偏好：才说出来，才给「恢复」
  companion = { revision: 4, state: { protection: { mode: 'guarded' }, experienceCount: 43, learning: { brevity: 0.8, samples: 5 } } }
  await page.reload()
  await expect(state.getByText('这会儿她放慢了节奏。')).toBeVisible()
  await expect(state.getByText('你说过喜欢简短一些，她记着。')).toBeVisible()
  await expect(state.getByRole('button', { name: '恢复平稳节奏' })).toBeVisible()
  await expectNoSeriousAxeFindings(page)

  // 对话：她替你办了几件事，收成一行摘要；没办成的写在摘要里
  const toolRuns = [
    { tool: 'add_task', ok: true, summary: '已安排「周六复诊」' },
    { tool: 'add_task', ok: false, summary: '时间格式无法识别' },
  ]
  await page.route('**/api/chat/conversations/*/messages/stream', route => fulfillStream(route, [
    { event: 'delta', text: '周六那条记好了，另一条时间没看懂。' },
    {
      event: 'done',
      status: 'ok',
      userMessage: { id: 'u-trail', role: 'user', content: '周六复诊，还有下周找个时间体检', createdAt: '2026-09-21T02:00:00.000Z' },
      aiMessage: { id: 'a-trail', role: 'assistant', content: '周六那条记好了，另一条时间没看懂。', createdAt: '2026-09-21T02:00:01.000Z', toolRuns },
      source: 'qwen',
    },
  ]))
  await page.goto('/chat')
  await page.getByRole('textbox', { name: '聊天消息' }).fill('周六复诊，还有下周找个时间体检')
  await page.getByRole('button', { name: '发送消息' }).click()
  const trail = page.locator('summary', { hasText: '办了 2 件事，1 件没办成' })
  await expect(trail).toBeVisible()
  await expect(page.getByText('云端模型', { exact: true })).toHaveCount(0)
  await trail.click()
  await expect(page.getByLabel('执行失败：时间格式无法识别')).toBeVisible()
  await expectNoSeriousAxeFindings(page)

  // 经期：推迟了写「比预计晚了」；「顾及周期」单独打开，刷新还在，撤回记录同意后开关跟着消失
  let consent = true
  let tone = false
  await page.route('**/api/reminders/scheduled', route => json(route, 200, { reminders: [] }))
  await page.route('**/api/tools/period**', route => {
    const request = route.request()
    const pathname = new URL(request.url()).pathname
    if (pathname === '/api/tools/period/summary') return json(route, 200, { nextDate: '2026-09-17', daysUntil: 0, overdueDays: 4 })
    if (pathname === '/api/tools/period/consent') {
      if (request.method() === 'PUT') {
        consent = request.postDataJSON().accepted
        if (!consent) tone = false
      }
      return json(route, 200, { accepted: consent, updatedAt: consent ? '2026-09-01T00:00:00.000Z' : null })
    }
    if (pathname === '/api/tools/period/tone') {
      if (request.method() === 'PUT') tone = request.postDataJSON().enabled
      return json(route, 200, { enabled: tone, updatedAt: tone ? '2026-09-21T00:00:00.000Z' : null })
    }
    return json(route, 200, [{ id: 'p1', startDate: '2026-08-20T00:00:00.000Z', endDate: '2026-08-24T00:00:00.000Z', cycleDays: 28 }])
  })
  await page.goto('/tools/calendar')
  await expect(page.getByText('比预计晚了')).toBeVisible()
  const toneSwitch = page.getByRole('switch', { name: '聊天时让她顾及你的周期' })
  await expect(toneSwitch).toHaveAttribute('aria-checked', 'false')
  await toneSwitch.click()
  await expect(toneSwitch).toHaveAttribute('aria-checked', 'true')
  expect(tone).toBe(true)
  await page.reload()
  await expect(toneSwitch).toHaveAttribute('aria-checked', 'true')
  await expectNoSeriousAxeFindings(page)
  await page.getByRole('button', { name: '撤回同意' }).click()
  await expect(page.getByText('记录经期之前')).toBeVisible()
  await expect(toneSwitch).toHaveCount(0)

  // 最窄的手机上，「她」页和日历都不横向滚
  await page.setViewportSize({ width: 320, height: 740 })
  for (const path of ['/her', '/tools/calendar']) {
    await page.goto(path)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  }
})

test('knows you: her name for you, what she keeps in mind, and what she means to ask', async ({ page }) => {
  await seedAuth(page)
  await mockChatBootstrap(page, true)

  // 资料：称呼与生日存下来，刷新还在
  let profile = { nickname: '', birthDate: null, careEnabled: true, letterFreqDays: 3 }
  await page.route('**/api/user/profile', route => {
    const request = route.request()
    if (request.method() === 'PUT') profile = { ...profile, ...request.postDataJSON() }
    return json(route, 200, profile)
  })

  await page.goto('/settings')
  const about = page.getByRole('form', { name: '关于你' })
  await about.getByLabel('她怎么叫你').fill('小鱼')
  await about.getByLabel('生日').fill('2000-05-03')
  await about.getByRole('button', { name: '保存' }).click()
  await expect(about.getByText('记下了')).toBeVisible()
  expect(profile).toMatchObject({ nickname: '小鱼', birthDate: '2000-05-03' })
  await page.reload()
  await expect(page.getByLabel('她怎么叫你')).toHaveValue('小鱼')
  await expectNoSeriousAxeFindings(page)

  // 「她」页：放在心上的排到最前；来信与记忆各占一处
  let memories = [
    { id: 'm-rain', type: 'semantic', content: '喜欢下雨天', revision: 1, pinned: false },
    { id: 'm-mango', type: 'semantic', content: '我对芒果过敏', revision: 1, pinned: false },
  ]
  await page.route('**/api/user/companion', route => json(route, 200, { revision: 1, state: { protection: { mode: 'open' }, experienceCount: 1, learning: { brevity: 0.5, samples: 1 } } }))
  await page.route('**/api/memories**', route => {
    const request = route.request()
    const pathname = new URL(request.url()).pathname
    if (request.method() === 'PUT' && pathname.endsWith('/pin')) {
      const id = pathname.split('/').at(-2)
      memories = memories.map(memory => memory.id === id ? { ...memory, pinned: request.postDataJSON().pinned } : memory)
      return json(route, 200, memories.find(memory => memory.id === id))
    }
    if (request.method() === 'POST' && pathname.endsWith('/suggestions')) {
      return json(route, 200, { candidates: [{ type: 'semantic', content: '对芒果过敏', importance: 8, tags: [] }] })
    }
    const ordered = [...memories].sort((a, b) => Number(b.pinned) - Number(a.pinned))
    return json(route, 200, { data: ordered, total: ordered.length, page: 1, limit: 20 })
  })
  await page.route('**/api/letters**', route => {
    const request = route.request()
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/letters/generate') {
      return json(route, 200, { letter: null, created: false, reason: 'off' })
    }
    return json(route, 200, { letters: [] })
  })

  await page.goto('/her')
  const mango = page.getByRole('article').filter({ hasText: '我对芒果过敏' })
  await mango.getByRole('button', { name: '放在心上' }).click()
  await expect(page.getByRole('article').first()).toContainText('我对芒果过敏')
  await expect(page.getByRole('article').first().getByRole('button', { name: '放在心上' })).toHaveAttribute('aria-pressed', 'true')
  await expectNoSeriousAxeFindings(page)

  // 到了日子，对话末尾她问一句，并说清为什么
  await page.route('**/api/chat/nudges**', route => json(route, 200, {
    nudges: [{ id: 'followup:f2', kind: 'followup', content: '面试顺利吗？', reason: '你之前说过：周五面试' }],
  }))
  // 说「帮我记住…」的那一轮，确认卡不等点就摆出来
  await page.route('**/api/chat/conversations/conversation-e2e/messages/stream', route => fulfillStream(route, [
    { event: 'delta', text: '好，在下面确认一下就行。' },
    {
      event: 'done',
      status: 'ok',
      offerMemory: true,
      userMessage: { id: 'u-remember', role: 'user', content: '帮我记住我对芒果过敏', createdAt: new Date().toISOString() },
      aiMessage: { id: 'a-remember', role: 'assistant', content: '好，在下面确认一下就行。', createdAt: new Date().toISOString() },
      source: 'qwen',
    },
  ]))

  await page.goto('/chat')
  const said = page.getByRole('region', { name: '她想对你说' })
  await expect(said.getByText('面试顺利吗？')).toBeVisible()
  await expect(said.getByText('为什么看到这条：你之前说过：周五面试')).toBeVisible()

  await page.getByRole('textbox', { name: '聊天消息' }).fill('帮我记住我对芒果过敏')
  await page.getByRole('button', { name: '发送消息' }).click()
  const suggestion = page.getByRole('region', { name: '记忆建议' })
  await expect(suggestion.getByLabel('记忆内容')).toHaveValue('对芒果过敏')
  await expectNoSeriousAxeFindings(page)

  // 最窄的手机上，设置里的「关于你」与「她」页都不横向滚
  await page.setViewportSize({ width: 320, height: 740 })
  for (const path of ['/settings', '/her']) {
    await page.goto(path)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  }
})
