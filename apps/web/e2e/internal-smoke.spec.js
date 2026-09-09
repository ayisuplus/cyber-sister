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
      return json(route, 200, { accepted, version: 'cloud-primary-v3', updatedAt: null })
    }
    const choice = route.request().postDataJSON().accepted
    return json(route, 200, { accepted: choice, version: 'cloud-primary-v3', updatedAt: '2026-08-29T00:00:00.000Z' })
  })
}

// SSE 帧编码：与服务端契约一致的纯 data 帧（无 event: 行），帧间空行分隔。
const sse = frames => frames.map(frame => `data: ${JSON.stringify(frame)}`).join('\n\n') + '\n\n'

const fulfillStream = (route, frames) => route.fulfill({
  status: 200,
  contentType: 'text/event-stream',
  body: sse(frames),
})

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

test('persona switches immediately and explicit memories support CRUD', async ({ page }) => {
  await seedAuth(page)
  let memories = []
  await page.route('**/api/user/external-llm-consent', route => json(route, 200, {
    accepted: true,
    version: 'cloud-primary-v3',
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

  // done 后临时气泡被持久消息替换：内容合并完整、只出现一次，带来源标识
  await expect(page.getByText('我在听，慢慢说。')).toBeVisible()
  await expect(page.getByText('我在听，慢慢说。')).toHaveCount(1)
  await expect(page.getByText('最近有点累')).toHaveCount(1)
  await expect(page.getByText('云端模型', { exact: true })).toBeVisible()
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

  // 流式 done 落地：chip 随 aiMessage 替换临时气泡而出现，只出现一次
  await expect(page.getByLabel('已执行：已添加待办「周六复诊」')).toBeVisible()
  await expect(page.getByLabel('已执行：已添加待办「周六复诊」')).toHaveCount(1)

  // 历史加载路径：刷新后会话列表返回该会话，getConversation 的消息同样带 toolRuns
  await page.unroute('**/api/chat/conversations')
  await page.route('**/api/chat/conversations', route => {
    if (route.request().method() === 'GET') return json(route, 200, [{ id: 'conversation-e2e' }])
    return json(route, 201, { id: 'conversation-e2e', messages: [] })
  })
  await page.route('**/api/chat/conversations/conversation-e2e', route => json(route, 200, {
    id: 'conversation-e2e',
    messages: [
      { id: 'u-tool-1', role: 'user', content: '提醒我周六复诊', createdAt: '2026-09-04T00:03:00.000Z' },
      { id: 'a-tool-1', role: 'assistant', content: '好的，已帮你记下。', createdAt: '2026-09-04T00:03:01.000Z', toolRuns },
    ],
  }))
  await page.reload()

  await expect(page.getByText('好的，已帮你记下。')).toBeVisible()
  await expect(page.getByLabel('已执行：已添加待办「周六复诊」')).toBeVisible()
  await expect(page.getByLabel('已执行：已添加待办「周六复诊」')).toHaveCount(1)
})

test('diary: save an entry and get an AI comment', async ({ page }) => {
  await seedAuth(page)
  const entry = { id: 'd-e2e', day: '2026-09-04', mood: 'happy', content: '今天去了新开的桂花展', aiComment: null, aiCommentSource: null, updatedAt: '2026-09-04T10:00:00.000Z' }
  await page.route('**/api/diary**', route => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.pathname.endsWith('/comment')) {
      return json(route, 200, { aiComment: '桂花展也太会挑日子了，隔着屏幕都替你开心。', source: 'qwen', reused: false })
    }
    if (request.method() === 'GET' && /\/api\/diary\/\d{4}-\d{2}-\d{2}$/.test(url.pathname)) {
      return json(route, 404, { error: '这一天还没有日记' })
    }
    if (request.method() === 'GET') return json(route, 200, [entry])
    if (request.method() === 'PUT') return json(route, 200, { ...entry, ...request.postDataJSON(), aiComment: null })
    return json(route, 200, { success: true })
  })
  await page.goto('/tools/diary')

  await page.getByRole('radio', { name: /开心/ }).click()
  await page.getByRole('textbox').fill('今天去了新开的桂花展')
  await page.getByRole('button', { name: '保存' }).click()
  await expect(page.getByText('已保存')).toBeVisible()

  await page.getByRole('button', { name: '让姐妹看看' }).click()
  await expect(page.getByText('桂花展也太会挑日子了，隔着屏幕都替你开心。')).toBeVisible()
  await expect(page.getByText('云端模型', { exact: true })).toBeVisible()
  await expectNoSeriousAxeFindings(page)
})

test('handbook: create a habit, check in and ask for a cheer', async ({ page }) => {
  await seedAuth(page)
  let habits = []
  await page.route('**/api/habits**', route => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.pathname.endsWith('/cheer')) {
      return json(route, 200, { cheer: '第一天就打上卡了，好的开始。', source: 'qwen' })
    }
    if (url.pathname.endsWith('/checkin')) {
      habits = [{ ...habits[0], checkedToday: true, streak: 1, recentDays: ['2026-09-04'] }]
      return json(route, 200, { checked: true, day: '2026-09-04' })
    }
    if (request.method() === 'GET') return json(route, 200, habits)
    if (request.method() === 'POST') {
      habits = [{ id: 'h-e2e', ...request.postDataJSON(), checkedToday: false, streak: 0, recentDays: [] }]
      return json(route, 200, habits[0])
    }
    return json(route, 200, { success: true })
  })
  await page.goto('/tools/handbook')

  await expect(page.getByText('还没有习惯，先加一个吧')).toBeVisible()
  await page.getByLabel('习惯名称').fill('喝水')
  await page.getByRole('radio', { name: '喝水' }).check()
  await page.getByRole('button', { name: '添加' }).click()
  await expect(page.getByText('喝水')).toBeVisible()

  await page.getByRole('button', { name: '打卡 喝水' }).click()
  await expect(page.getByText(/连续 1 天/)).toBeVisible()

  await page.getByRole('button', { name: '姐妹说两句' }).click()
  await expect(page.getByText('第一天就打上卡了，好的开始。')).toBeVisible()
  await expectNoSeriousAxeFindings(page)
})

test('schedule: adding an item with today’s date lands in the today group', async ({ page }) => {
  await seedAuth(page)
  const todos = []
  await page.route('**/api/tools/todos', route => {
    const request = route.request()
    if (request.method() === 'GET') return json(route, 200, todos)
    if (request.method() === 'POST') {
      const body = request.postDataJSON()
      const created = {
        id: 'todo-e2e',
        ...body,
        dueDate: body.dueDate ? `${body.dueDate}T00:00:00.000Z` : null,
        dueTime: body.dueTime || null,
        isDone: false,
        createdAt: new Date().toISOString(),
      }
      todos.push(created)
      return json(route, 200, created)
    }
    return json(route, 200, { success: true })
  })
  await page.goto('/tools/todo')

  await expect(page.getByText('暂无日程')).toBeVisible()
  await page.getByRole('button', { name: /添加日程/ }).click()
  await page.getByLabel('日程内容').fill('给妈妈打电话')
  const now = new Date()
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  await page.getByLabel('日期（可选）').fill(today)
  await page.getByLabel('时间（可选）').fill('18:30')
  await page.getByRole('button', { name: '添加' }).click()

  await expect(page.getByRole('heading', { name: /今天 ·/ })).toBeVisible()
  await expect(page.getByText('给妈妈打电话')).toBeVisible()
  await expect(page.getByText('18:30')).toBeVisible()
  await expectNoSeriousAxeFindings(page)
})


test('work mode: segmented switch creates a work conversation, shows work badge and filters the list', async ({ page, isMobile }) => {
  await seedAuth(page)
  await page.route('**/api/user/external-llm-consent', route => {
    if (route.request().method() === 'GET') {
      return json(route, 200, { accepted: true, version: 'cloud-primary-v3', updatedAt: null })
    }
    return json(route, 200, { accepted: true, version: 'cloud-primary-v3', updatedAt: '2026-09-05T00:00:00.000Z' })
  })
  const conversations = [{
    id: 'c-chat',
    mode: 'chat',
    title: '聊天会话',
    updatedAt: '2026-09-05T08:00:00.000Z',
    messages: [],
  }]
  await page.route('**/api/chat/conversations/c-chat', route => json(route, 200, {
    id: 'c-chat', mode: 'chat', title: '聊天会话', messages: [],
  }))
  await page.route('**/api/chat/conversations', route => {
    if (route.request().method() === 'GET') return json(route, 200, conversations)
    const mode = route.request().postDataJSON()?.mode === 'work' ? 'work' : 'chat'
    const created = {
      id: mode === 'work' ? 'c-work' : 'c-new',
      mode,
      title: 'Amie',
      updatedAt: '2026-09-05T09:00:00.000Z',
      messages: [],
    }
    conversations.unshift(created)
    return json(route, 201, created)
  })
  await page.route('**/api/chat/conversations/*/messages/stream', route => fulfillStream(route, [
    {
      event: 'done',
      status: 'ok',
      userMessage: { id: 'u-work-1', role: 'user', content: '帮我整理今天的日程', createdAt: '2026-09-05T09:00:00.000Z' },
      aiMessage: {
        id: 'a-work-1',
        role: 'assistant',
        content: '已按时间顺序整理好。',
        createdAt: '2026-09-05T09:00:01.000Z',
        toolRuns: [{ tool: 'add_todo', ok: true, summary: '已添加日程「整理日程」' }],
      },
      source: 'qwen',
    },
  ]))
  await page.goto('/chat')

  // 聊天模式：人格徽章在、列表只有聊天会话（桌面端）
  const modeSwitch = page.getByLabel('会话模式')
  await expect(page.getByText('包容·耐心·讲道理')).toBeVisible()
  if (!isMobile) {
    await expect(page.getByRole('button', { name: /^聊天会话/ })).toBeVisible()
  }

  // 切到工作模式：徽章替换、占位符与空态切换（云端切割后不再有浏览器状态 chip）
  await modeSwitch.getByRole('button', { name: '工作' }).click()
  await expect(page.getByText('工作模式', { exact: true })).toBeVisible()
  await expect(page.getByText('包容·耐心·讲道理')).toHaveCount(0)
  await expect(page.getByText('浏览器已就绪')).toHaveCount(0)
  await expect(page.getByRole('textbox', { name: '聊天消息' })).toHaveAttribute('placeholder', '把工作交给她…')
  if (!isMobile) {
    await expect(page.getByRole('button', { name: /^聊天会话/ })).toHaveCount(0)
    await expect(page.getByText('还没有工作会话，发一条就开始')).toBeVisible()
  }

  // 发消息自动创建 work 会话并拿到回复
  await page.getByRole('textbox', { name: '聊天消息' }).fill('帮我整理今天的日程')
  await page.getByRole('button', { name: '发送消息' }).click()
  await expect(page.getByText('已按时间顺序整理好。')).toBeVisible()
  // 工具动作 chip 可见（生图 chip 已随切割删除）
  await expect(page.getByLabel(/已执行：已添加日程/)).toBeVisible()
  // 切回聊天：工作会话从列表消失，聊天会话仍在
  await modeSwitch.getByRole('button', { name: '聊天' }).click()
  await expect(page.getByText('包容·耐心·讲道理')).toBeVisible()
  if (!isMobile) {
    await expect(page.getByRole('button', { name: /^聊天会话/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /^Amie/ })).toHaveCount(0)
  }
})

test('appearance: upload avatar and chat background, both render on profile and chat', async ({ page }) => {
  await seedAuth(page)
  const tinyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
  await page.route('**/api/user/assets/*', route => {
    const method = route.request().method()
    if (method === 'PUT') return json(route, 200, { url: '/api/user/assets/avatar?v=1' })
    if (method === 'DELETE') return json(route, 200, { ok: true })
    return route.fulfill({ status: 200, contentType: 'image/png', body: tinyPng })
  })
  await mockChatBootstrap(page, true)
  await page.route('**/api/chat/conversations', route => json(route, 200, [{
    id: 'c-1', mode: 'chat', title: 'Amie', updatedAt: '2026-09-06T08:00:00.000Z', messages: [],
  }]))
  await page.route('**/api/chat/conversations/c-1', route => json(route, 200, {
    id: 'c-1',
    mode: 'chat',
    title: 'Amie',
    messages: [{ id: 'u-1', role: 'user', content: '今天心情不错', createdAt: '2026-09-06T08:00:00.000Z' }],
  }))
  await page.goto('/profile')

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
  await expect(page.getByText('今天心情不错')).toBeVisible()
  await expect(page.getByRole('img', { name: '我的头像' })).toBeVisible()
  await expect(page.locator('.chat-full')).toHaveCSS('background-image', /blob:/)
  await expectNoSeriousAxeFindings(page)
})

test('reading: shelve a book, jot a note and get an AI comment', async ({ page }) => {
  await seedAuth(page)
  let books = []
  let notes = []
  await page.route('**/api/reading/**', route => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.pathname.endsWith('/comment')) {
      return json(route, 200, { aiComment: '这段写得真好，我也被戳了一下。', source: 'local_model', reused: false })
    }
    if (url.pathname.endsWith('/notes')) {
      if (request.method() === 'GET') return json(route, 200, notes)
      const body = request.postDataJSON()
      const note = { id: 'n-e2e', bookId: 'b-e2e', page: body.page ?? null, content: body.content, aiComment: null, aiCommentSource: null, createdAt: '2026-09-06T10:00:00.000Z' }
      notes = [note]
      books = [{ ...books[0], currentPage: body.page ?? 0, noteCount: 1 }]
      return json(route, 200, { note, book: books[0] })
    }
    if (request.method() === 'GET') return json(route, 200, books)
    if (request.method() === 'POST') {
      const body = request.postDataJSON()
      books = [{ id: 'b-e2e', title: body.title, author: body.author ?? null, status: 'reading', totalPages: body.totalPages ?? null, currentPage: 0, noteCount: 0, createdAt: '2026-09-06T09:00:00.000Z' }]
      return json(route, 200, books[0])
    }
    return json(route, 200, { success: true })
  })
  await page.goto('/tools/reading')

  await expect(page.getByText('书架还空着，先加一本想读的书吧')).toBeVisible()
  await page.getByLabel('书名').fill('活着')
  await page.getByRole('button', { name: '放上书架' }).click()
  await expect(page.getByText('《活着》')).toBeVisible()

  await page.getByRole('button', { name: '记一笔' }).click()
  await page.getByLabel('页码').fill('30')
  await page.getByLabel('感想').fill('有庆那段看得心里发紧')
  await page.getByRole('button', { name: '记下来' }).click()
  await expect(page.getByText('有庆那段看得心里发紧')).toBeVisible()
  await expect(page.getByText('已读 30 页')).toBeVisible()

  await page.getByRole('button', { name: '让姐妹看看' }).click()
  await expect(page.getByText('这段写得真好，我也被戳了一下。')).toBeVisible()
  await expectNoSeriousAxeFindings(page)
})

test('study: run a pomodoro, finish early and record it', async ({ page }) => {
  await seedAuth(page)
  let sessions = []
  let sessionsPost = null
  await page.route('**/api/study/**', route => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.pathname.endsWith('/summary')) {
      const todayMinutes = sessions.reduce((sum, s) => sum + s.actualMinutes, 0)
      return json(route, 200, { todayMinutes, weekMinutes: todayMinutes, streak: todayMinutes > 0 ? 1 : 0, totalSessions: sessions.length })
    }
    if (url.pathname.endsWith('/sessions')) {
      if (request.method() === 'GET') return json(route, 200, sessions)
      sessionsPost = request.postDataJSON()
      sessions = [{ id: 'se-e2e', ...sessionsPost, aiComment: null, aiCommentSource: null, createdAt: '2026-09-06T10:00:00.000Z' }]
      return json(route, 200, sessions[0])
    }
    return json(route, 200, { success: true })
  })
  await page.goto('/tools/study')

  await expect(page.getByText(/今天 0 分钟 · 本周 0 分钟 · 连续 0 天/)).toBeVisible()
  await page.getByRole('button', { name: '25 分钟' }).click()
  await page.getByRole('button', { name: '开始自习' }).click()
  await expect(page.getByText('25:00')).toBeVisible()
  await expect(page.getByText('我在旁边安静看书呢，你专心学')).toBeVisible()

  await page.getByRole('button', { name: '提前完成' }).click()
  await page.getByLabel('一句话收获').fill('背完一章')
  await page.getByRole('button', { name: '记下这次' }).click()

  await expect.poll(() => sessionsPost?.actualMinutes).toBe(1)
  await expect(page.getByText(/今天 1 分钟/)).toBeVisible()
  await expect(page.getByRole('button', { name: '让姐妹看看' })).toBeVisible()
  await expectNoSeriousAxeFindings(page)
})

test('roleplay: set and clear a custom role on profile', async ({ page }) => {
  await seedAuth(page)
  await page.route('**/api/user/external-llm-consent', route => json(route, 200, {
    accepted: true, version: 'cloud-primary-v3', updatedAt: '2026-08-29T00:00:00.000Z',
  }))
  let saved = null
  await page.route('**/api/user/roleplay', route => {
    if (route.request().method() === 'DELETE') { saved = null; return json(route, 200, { success: true }) }
    saved = route.request().postDataJSON()
    return json(route, 200, { roleName: saved.name, roleSetting: saved.setting })
  })
  await page.goto('/profile')

  await page.getByLabel('角色名').fill('同桌的你')
  await page.getByLabel('角色设定').fill('坐我旁边的女生，爱吐槽但总会帮我讲题。')
  await page.getByRole('button', { name: '保存角色' }).click()
  await expect(page.getByText('角色已设置，下一条消息立即生效')).toBeVisible()
  expect(saved).toEqual({ name: '同桌的你', setting: '坐我旁边的女生，爱吐槽但总会帮我讲题。' })

  await page.getByRole('button', { name: '清除角色' }).click()
  await expect(page.getByText('已清除角色设定')).toBeVisible()
  await expectNoSeriousAxeFindings(page)
})


// 2x2 有效 PNG：选照片/单品上传用（<img> 能触发 onLoad）
const TINY_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEUlEQVR4nGP4z8AAQv//Q0kASMgJ9xYlCaIAAAAASUVORK5CYII=', 'base64')

test('work mode: desktop grid fills the empty state and the header button summons the same panel', async ({ page }) => {
  await seedAuth(page)
  await mockChatBootstrap(page, true)
  await page.goto('/chat')

  const modeSwitch = page.getByLabel('会话模式')
  await modeSwitch.getByRole('button', { name: '工作' }).click()

  // 空态直出功能桌面，原插画空态让位
  const desktop = page.locator('nav[aria-label="功能桌面"]')
  await expect(desktop).toBeVisible()
  await expect(page.getByText('嗨，我是你的Amie')).toHaveCount(0)
  await expect(desktop.getByRole('link', { name: /化妆间/ })).toHaveAttribute('href', '/tools/makeup-room')
  await expect(desktop.getByRole('link', { name: /3D 衣柜/ })).toHaveAttribute('href', '/tools/wardrobe')
  await expect(desktop.getByRole('link', { name: /日记/ })).toHaveAttribute('href', '/tools/diary')

  // 头部「功能」按钮唤出同一网格的遮罩层，可关闭
  await page.getByRole('button', { name: '打开功能桌面' }).click()
  const dialog = page.getByRole('dialog', { name: '功能桌面' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('link', { name: /大姨妈记录/ })).toHaveAttribute('href', '/tools/period')
  await dialog.getByRole('button', { name: '关闭', exact: true }).click()
  await expect(dialog).toHaveCount(0)

  // 切回聊天模式：按钮消失、插画空态回来
  await modeSwitch.getByRole('button', { name: '聊天' }).click()
  await expect(page.getByRole('button', { name: '打开功能桌面' })).toHaveCount(0)
  await expect(page.getByText('嗨，我是你的Amie')).toBeVisible()

  // 卡片直达对应路由
  await modeSwitch.getByRole('button', { name: '工作' }).click()
  await desktop.getByRole('link', { name: /3D 衣柜/ }).click()
  await expect(page).toHaveURL(/\/tools\/wardrobe/)
})

test('makeup room: save a custom preset, re-apply it, and stay honest when the engine is absent', async ({ page }) => {
  await seedAuth(page)
  const presets = []
  await page.route('**/api/makeup-presets', route => {
    if (route.request().method() === 'GET') return json(route, 200, presets)
    const created = {
      id: `preset-${presets.length + 1}`,
      userId: 'user-e2e',
      ...route.request().postDataJSON(),
      createdAt: '2026-09-08T00:00:00.000Z',
      updatedAt: '2026-09-08T00:00:00.000Z',
    }
    presets.push(created)
    return json(route, 200, created)
  })
  await page.goto('/tools/makeup-room')

  await page.getByRole('tab', { name: '选照片' }).click()
  await page.locator('input[aria-label="选择照片"]').setInputFiles({ name: 'face.png', mimeType: 'image/png', buffer: TINY_PNG })

  const saveButton = page.getByRole('button', { name: '把当前存为妆容' })
  await expect(saveButton).toBeVisible()
  await page.getByLabel('磨皮').fill('60')
  await saveButton.click()
  await page.getByLabel('妆容名字').fill('日常')
  await page.getByRole('button', { name: '保存', exact: true }).click()

  // 服务端收到了完整四参数；预设横排出现并处于选中态
  expect(presets[0]).toMatchObject({ name: '日常', smooth: 60, whiten: 20, slim: 10, eye: 10 })
  const presetButton = page.getByRole('button', { name: '日常', exact: true })
  await expect(presetButton).toBeVisible()
  await expect(presetButton).toHaveAttribute('aria-pressed', 'true')

  // 改动滑杆后点回预设，四项值回到保存值
  await page.getByLabel('磨皮').fill('5')
  await presetButton.click()
  await expect(page.getByLabel('磨皮')).toHaveValue('60')

  await expectNoSeriousAxeFindings(page)
})

test('wardrobe: unconfigured 3D service shows the honest 503 and no fake success', async ({ page }) => {
  await seedAuth(page)
  await page.route('**/api/wardrobe', route => {
    if (route.request().method() === 'GET') return json(route, 200, [])
    return json(route, 503, { error: '3D 生成服务还没接好，开放后第一时间告诉你', code: 'IMAGE_TO_3D_NOT_CONFIGURED' })
  })
  await page.goto('/tools/wardrobe')

  await page.locator('input[aria-label="选择单品照片"]').setInputFiles({ name: 'coat.png', mimeType: 'image/png', buffer: TINY_PNG })
  await page.getByLabel('单品名字').fill('黑色风衣')
  await page.getByRole('button', { name: '生成 3D 模型' }).click()

  await expect(page.getByRole('alert')).toHaveText('3D 生成服务还没接好，开放后第一时间告诉你')
  await expect(page.getByText('衣柜还空着，传一张单品照试试。')).toBeVisible()
  await expect(page.getByRole('button', { name: /黑色风衣/ })).toHaveCount(0)

  await expectNoSeriousAxeFindings(page)
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

  // AI 点评落气泡；用户气泡内出现照片（done 后由服务端取图渲染）
  await expect(page.getByText('这个配色很衬你。')).toBeVisible()
  await expect(page.getByAltText('发出的照片')).toBeVisible()
})

test('workspace: resolve a conflict insight and find it under the resolved tab', async ({ page }) => {
  await seedAuth(page)
  const conflict = {
    id: 'insight-e2e',
    kind: 'conflict',
    content: '她既想独居又想合住',
    confidence: 'high',
    evidence: null,
    status: 'active',
    resolution: null,
    createdAt: '2026-09-08T08:00:00.000Z',
  }
  let resolved = null
  await page.route('**/api/derived**', route => {
    const request = route.request()
    const url = new URL(request.url())
    if (request.method() === 'GET' && url.pathname === '/api/derived') {
      const status = url.searchParams.get('status') || 'active'
      if (status === 'resolved') return json(route, 200, { insights: resolved ? [resolved] : [] })
      return json(route, 200, { insights: resolved ? [] : [conflict] })
    }
    if (request.method() === 'POST' && url.pathname === '/api/derived/insight-e2e/resolve') {
      const payload = request.postDataJSON()
      resolved = { ...conflict, status: 'resolved', resolution: payload.content }
      return json(route, 200, {
        memory: { id: 'memory-e2e', content: payload.content, origin: 'promoted', sourceRef: 'insight-e2e' },
        insight: resolved,
      })
    }
    return json(route, 400, { error: 'unexpected derived request' })
  })

  await page.goto('/tools/workspace')
  await expect(page.getByText('她既想独居又想合住')).toBeVisible()
  await page.getByRole('button', { name: '厘清一下' }).click()
  const draft = page.getByLabel('定稿文案')
  await expect(draft).toHaveValue('她既想独居又想合住')
  await draft.fill('她想要的是独立书房')
  await page.getByRole('button', { name: '保存' }).click()
  await expect(page.getByText('已厘清并记入记忆')).toBeVisible()

  await page.getByRole('button', { name: '已厘清' }).click()
  const card = page.locator('article', { hasText: '她既想独居又想合住' })
  await expect(card.getByText('她想要的是独立书房')).toBeVisible()
})

test('workspace: confirm a derived relation edge under the edges tab', async ({ page }) => {
  await seedAuth(page)
  const edge = {
    id: 'edge-e2e',
    relation: 'similar',
    confidence: 'high',
    status: 'derived',
    evidence: ['两条都提到火锅'],
    from: { id: 'm1', content: '喜欢火锅' },
    to: { id: 'm2', content: '每周五吃火锅' },
    createdAt: '2026-09-09T08:00:00.000Z',
  }
  await page.route('**/api/derived**', route => {
    const request = route.request()
    const url = new URL(request.url())
    if (request.method() === 'GET' && url.pathname === '/api/derived/edges') {
      return json(route, 200, { edges: [edge] })
    }
    if (request.method() === 'POST' && url.pathname === '/api/derived/edges/edge-e2e/promote') {
      return json(route, 200, { edge: { ...edge, status: 'canonical' } })
    }
    if (request.method() === 'GET' && url.pathname === '/api/derived') {
      return json(route, 200, { insights: [] })
    }
    return json(route, 400, { error: 'unexpected derived request' })
  })

  await page.goto('/tools/workspace')
  await page.getByRole('button', { name: '关系' }).click()
  await expect(page.getByText('喜欢火锅 —相似→ 每周五吃火锅')).toBeVisible()
  await page.getByRole('button', { name: '确认关系' }).click()
  await expect(page.getByText('已定为关系')).toBeVisible()
  await expect(page.getByRole('button', { name: '确认关系' })).toHaveCount(0)
})

test('tools: care touchpoint card shows reason and dismisses in place', async ({ page }) => {
  await seedAuth(page)
  const card = {
    key: 'countdown:c1:2026-09-09',
    kind: 'countdown',
    title: '「面试」还有 1 天',
    body: '时间刚刚好，今天顺手推进一点。',
    reason: '你在倒数日里记的日子',
    action: { to: '/tools/countdown', label: '看看倒数日' },
  }
  let dismissedKey = null
  await page.route('**/api/care/touchpoints**', route => {
    const request = route.request()
    if (request.method() === 'GET') return json(route, 200, { touchpoints: dismissedKey ? [] : [card] })
    if (request.method() === 'POST') {
      dismissedKey = request.postDataJSON().key
      return json(route, 200, { dismissed: true })
    }
    return json(route, 400, { error: 'unexpected care request' })
  })

  await page.goto('/tools')
  await expect(page.getByText('她来想你')).toBeVisible()
  await expect(page.getByText('「面试」还有 1 天')).toBeVisible()
  await expect(page.getByText('为什么看到这条：你在倒数日里记的日子')).toBeVisible()

  await page.getByRole('button', { name: '今天不再提醒这条' }).click()
  await expect(page.getByText('「面试」还有 1 天')).toHaveCount(0)
  expect(dismissedKey).toBe('countdown:c1:2026-09-09')
})

test('letters: the weekly letter renders expanded from real week data', async ({ page }) => {
  await seedAuth(page)
  await page.route('**/api/letters**', route => {
    if (route.request().method() === 'GET') {
      return json(route, 200, {
        letters: [{
          id: 'l1',
          weekStart: '2026-09-07T00:00:00.000Z',
          content: '内测用户，见信好。\n\n这周你们聊了 23 轮；新记下了 1 件事：「喜欢火锅」。\n\n—— 你的姐妹',
          createdAt: '2026-09-09T08:00:00.000Z',
        }],
      })
    }
    return json(route, 400, { error: 'unexpected letters request' })
  })

  await page.goto('/tools/letters')
  await expect(page.getByText('9月7日那周的信')).toBeVisible()
  await expect(page.getByText(/这周你们聊了 23 轮/)).toBeVisible()
  await expect(page.getByText('—— 你的姐妹')).toBeVisible()
})