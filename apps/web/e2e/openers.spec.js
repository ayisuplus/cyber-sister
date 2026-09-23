import { expect, test } from '@playwright/test'

const json = (route, status, data) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
// SSE 帧编码：与服务端契约一致的纯 data 帧（无 event: 行），帧间空行分隔
const sse = frames => frames.map(frame => `data: ${JSON.stringify(frame)}`).join('\n\n') + '\n\n'

// 空对话那一屏的三条候选：她惦记的事、在读的书、最近的手记（手记只作草稿）
const NOTES_TEXT = '上次我记下的那句我还想着：有庆死了，我哭了好久'
const OPENERS = [
  { id: 'followup:f1', label: '惦记的：周三答辩', text: '答辩怎么样了？', why: '你之前说过这件事' },
  { id: 'book:b1', label: '《活着》', text: '我在读《活着》，想跟你聊聊这本书', why: '你正在读这本' },
  { id: 'note:n1', label: '上次记的那句', text: NOTES_TEXT, draft: true, why: '你最近写下的一行' },
]

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('cyber-sister-auth', JSON.stringify({ state: { token: 'openers-e2e', user: { id: 'openers-e2e', nickname: '内测用户', persona: 'gentle' }, isLoggedIn: true }, version: 0 }))
    localStorage.setItem('cyber-sister-disclaimer-shown', 'true')
  })
  // Every application API request is handled here; an unexpected read or write fails instead of reaching a real account.
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname
    const method = route.request().method()
    const responses = {
      '/api/chat/thread': { id: 'openers-e2e', messages: [] },
      '/api/chat/openers': { openers: OPENERS },
      '/api/chat/nudges': { nudges: [] },
      '/api/bridge': { bridges: [] },
      '/api/llm/status': { externalFallback: { configured: false, consent: true } },
      '/api/user/external-llm-consent': { accepted: true, version: 'cloud-primary-v1', updatedAt: null },
      '/api/user/profile': { careEnabled: false },
      '/api/asr/status': { available: false },
      '/api/reminders/scheduled': { reminders: [] },
      '/api/diary': [], '/api/reading/notes': { notes: [] }, '/api/collection': { items: [] },
      '/api/derived': { insights: [] }, '/api/derived/edges': { edges: [] }, '/api/derived/followups': { followUps: [] },
      '/api/user/companion': { revision: 1, state: { protection: { mode: 'open' }, experienceCount: 0, learning: { brevity: 0.5, samples: 0 } } },
      '/api/work/status': { capabilities: { backgroundTasks: false } }, '/api/work/tasks': { tasks: [] },
    }
    if (/^\/api\/user\/assets\/(bg-home|bg-chat)$/.test(path)) return json(route, 404, {})
    if (/^\/api\/compliance\/usage\/(start|heartbeat|end)$/.test(path)) return json(route, 200, { minutes: 0, shouldRemind: false })
    expect(method, `Unexpected write to ${path}`).toBe('GET')
    expect(Object.hasOwn(responses, path), `Unmocked API request: ${path}`).toBe(true)
    return json(route, 200, responses[path])
  })
})

test('openers: 空白对话摆出她自己的线索，手记只填进输入框', async ({ page }) => {
  const sent = []
  await page.route('**/api/chat/conversations/*/messages/stream', route => {
    const content = route.request().postDataJSON().content
    sent.push(content)
    return route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: sse([{
        event: 'done',
        status: 'ok',
        userMessage: { id: 'u-openers-1', role: 'user', content, createdAt: '2026-09-22T01:00:00.000Z' },
        aiMessage: { id: 'a-openers-1', role: 'assistant', content: '嗯，我在听。', createdAt: '2026-09-22T01:00:01.000Z' },
        source: 'qwen',
      }]),
    })
  })

  await page.goto('/chat')

  const group = page.getByRole('group', { name: '开场话题' })
  await expect(group.getByRole('button')).toHaveCount(4)
  // 「为什么看到这条」如实写出来源，不用情感诱导的话术，也不另开面板
  await expect(group.getByRole('button', { name: /惦记的：周三答辩/ })).toContainText('你之前说过这件事')
  await expect(group.getByRole('button', { name: /《活着》/ })).toContainText('你正在读这本')
  const note = group.getByRole('button', { name: /上次记的那句/ })
  await expect(note).toContainText('你最近写下的一行')

  // 手记是你自己写下的字：只填进输入框，一条消息都不发
  await note.click()
  const input = page.getByRole('textbox', { name: '聊天消息' })
  await expect(input).toHaveValue(NOTES_TEXT)
  expect(sent).toEqual([])
  // 输入框里已经有你的草稿：手记那条置灰，不覆盖也不自动发
  await expect(note).toBeDisabled()
  expect(sent).toEqual([])

  // 她惦记的事一点即发
  await group.getByRole('button', { name: /惦记的：周三答辩/ }).click()
  await expect(page.getByRole('region', { name: '信纸' }).getByText('答辩怎么样了？')).toBeVisible()
  expect(sent).toEqual(['答辩怎么样了？'])
})
