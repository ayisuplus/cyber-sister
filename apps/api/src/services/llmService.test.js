import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createServer } from 'node:http'
import { once } from 'node:events'

const gatewayComplete = vi.hoisted(() => vi.fn())
const gatewayStream = vi.hoisted(() => vi.fn())
const providerRows = vi.hoisted(() => ({ listProvidersForGateway: vi.fn(async () => []) }))

vi.mock('@cyber-sister/llm-gateway', () => ({
  createGateway: vi.fn(() => Promise.resolve({
    complete: gatewayComplete,
    stream: gatewayStream,
    getHealth: () => [],
  })),
}))

// 只替换读库那一步：槽名与场景常量仍用真实实现，测试才算真的验了装配
vi.mock('./modelProviderService.js', async (importOriginal) => ({
  ...(await importOriginal()),
  listProvidersForGateway: providerRows.listProvidersForGateway,
}))

vi.mock('../utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { createGateway } from '@cyber-sister/llm-gateway'
import logger from '../utils/logger.js'
import {
  activeChatProviders,
  buildMemoryContext,
  buildDerivedContext,
  buildModelMessages,
  buildGatewayEnv,
  filterModelOutput,
  generateCompanionNote,
  generateExplanationWithModel,
  generateLocalTemplateResponse,
  generateResponse,
  generateResponseStream,
  getGateway,
  isCloudProviderConfigured,
  loadCloudProviders,
  cosineSimilarity,
  CloudConsentRequiredError,
  LlmUnavailableError,
  redactSensitiveText,
  resetCloudProviders,
  resetGatewayCache,
  retrieveRelevantMemories,
} from './llmService.js'

// 云端切割（2026-09-07）：供应商槽 GATEWAY_QWEN_* 是唯一 provider。
// 测试通过环境变量控制供应商是否配置（isCloudProviderConfigured 直接读 env）。
const CLOUD_ENV = {
  GATEWAY_QWEN_BASE_URL: 'https://example.invalid/v1',
  GATEWAY_QWEN_MODEL: 'qwen-model',
  GATEWAY_QWEN_API_KEY: 'k',
}

function withCloudEnv() {
  Object.assign(process.env, CLOUD_ENV)
}

function withoutCloudEnv() {
  for (const key of Object.keys(CLOUD_ENV)) delete process.env[key]
}

const authorized = () => Promise.resolve(true)

// 供应商快照是模块级状态：每个用例都从「还没读过库」开始，避免互相影响
beforeEach(() => { resetCloudProviders() })

describe('工作代码协议回归', () => {
  beforeEach(() => { withCloudEnv(); resetGatewayCache(); vi.clearAllMocks() })
  it('原生工具调用只在网关成功结束后交给执行层，上游迟到错误会阻止执行', async () => {
    const call = { type: 'toolcall', name: 'execute_python', args: { code: 'print(42)' } }
    gatewayStream.mockImplementationOnce(async function* () { yield call; yield { type: 'error', reason: 'upstream_error' } })
    const failed = await collectEvents(generateResponseStream('分析文件', 'rational', [], [], 'r1', { agent: true, allowExternal: true, authorizeExternal: authorized }))
    expect(failed.some((event) => event.type === 'toolcall')).toBe(false)
    gatewayStream.mockImplementationOnce(async function* () { yield call; yield { type: 'done', provider: 'qwen' } })
    expect(await collectEvents(generateResponseStream('分析文件', 'rational', [], [], 'r1', { agent: true, allowExternal: true, authorizeExternal: authorized }))).toEqual([call])
  })
  it('流式的长代码保持在工具通道，任何片段都不作为回复显示', async () => {
    const code = 'print("code block")\n'.repeat(400)
    const reply = JSON.stringify({ tool: 'execute_python', args: { code } })
    gatewayStream.mockImplementationOnce(async function* () {
      yield { type: 'delta', text: reply.slice(0, 4500) }
      yield { type: 'delta', text: reply.slice(4500) }
      yield { type: 'done', provider: 'qwen', model: 'dots-test' }
    })
    const events = await collectEvents(generateResponseStream('分析文件', 'rational', [], [], 'r1', { agent: true, allowExternal: true, authorizeExternal: authorized }))
    expect(events).toEqual([{ type: 'toolcall', name: 'execute_python', args: { code } }])
  })
  it('无效代码 JSON 在普通与流式接口都要求修正，不冒充已完成回复', async () => {
    const bad = '{"tool":"execute_python","args":{"code":"print("bad")"}}'
    gatewayComplete.mockResolvedValueOnce({ content: bad, provider: 'qwen' })
    const response = await generateResponse('分析文件', 'rational', [], [], 'r1', { agent: true, allowExternal: true, authorizeExternal: authorized })
    expect(JSON.parse(response.content)).toEqual({ tool: '__malformed__', args: {} })
    gatewayStream.mockImplementationOnce(async function* () {
      yield { type: 'delta', text: bad }
      yield { type: 'done', provider: 'qwen' }
    })
    expect(await collectEvents(generateResponseStream('分析文件', 'rational', [], [], 'r1', { agent: true, allowExternal: true, authorizeExternal: authorized })))
      .toEqual([{ type: 'toolcall', name: '__malformed__', args: {} }])
  })
})

async function collectEvents(generator) {
  const events = []
  for await (const event of generator) events.push(event)
  return events
}

function streamOf(events) {
  return (async function* () {
    for (const event of events) yield event
  })()
}

describe('llmService 数据最小化', () => {
  beforeEach(() => {
    gatewayComplete.mockReset()
    gatewayStream.mockReset()
    resetGatewayCache()
    withCloudEnv()
  })

  it('本地带工具的回合保留长文与完整文件协议，网页聊天仍沿用短输出限制', async () => {
    const content = '这是一段长文。'.repeat(450)
    expect(filterModelOutput(content, '写报告', 'rational', 'qwen', true).content.length).toBe(content.length)
    expect(filterModelOutput(content, '聊天', 'rational').content.length).toBe(2000)
    const tool = JSON.stringify({ tool: 'create_artifact', args: { title: '报告', format: 'md', content } })
    gatewayComplete.mockResolvedValue({ content: tool, provider: 'qwen', model: 'test' })
    const result = await generateResponse('写报告', 'rational', [], [], undefined, { agent: true, allowExternal: true, authorizeExternal: authorized })
    expect(JSON.parse(result.content).args.content).toBe(content)
  })

  it('本地多步任务的上下文预算保留原任务与最近的工具结果', () => {
    const text = '将证据整理成报告'
    const history = [{ role: 'user', content: text }, ...Array.from({ length: 30 }, (_v, i) => ({ role: i % 2 ? 'user' : 'assistant', content: `${i}:` + 'x'.repeat(12000) }))]
    const messages = buildModelMessages(text, history, true, true)
    expect(messages[0]).toEqual({ role: 'user', content: text })
    expect(messages.at(-1).content).toBe(history.at(-1).content)
    expect(messages.reduce((total, message) => total + message.content.length, 0)).toBeLessThanOrEqual(64000)
  })

  it('注意力已选中的语义记忆无需再次按关键词筛选，普通与流式上下文一致', async () => {
    gatewayComplete.mockResolvedValue({ content: '好的。', provider: 'qwen', model: 'test' })
    gatewayStream.mockReturnValue(streamOf([{ type: 'delta', text: '好的。' }, { type: 'done', provider: 'qwen', model: 'test' }]))
    // 无字面交集，投影已在上层检索完成后剥离；二次关键词过滤会错误丢弃它。
    const selected = [{ id: 'm1', type: 'semantic', content: '经常徒步' }]
    expect(retrieveRelevantMemories('登山准备', selected)).toEqual([])
    const options = { allowExternal: true, authorizeExternal: authorized, memoriesSelected: true }
    await generateResponse('登山准备', 'gentle', [], selected, 'selected', options)
    await collectEvents(generateResponseStream('登山准备', 'gentle', [], selected, 'selected', options))
    expect(gatewayComplete.mock.calls[0][0].systemAppend).toEqual(gatewayStream.mock.calls[0][0].systemAppend)
    expect(JSON.stringify(gatewayComplete.mock.calls[0][0].systemAppend)).toContain('经常徒步')
  })

  it.each(['看这张照片', ''])('工具续轮保持原请求/工具调用/工具结果的顺序，图片不覆盖结果（文本=%s）', async (text) => {
    gatewayComplete.mockResolvedValue({ content: '好的。', provider: 'qwen', model: 'test' })
    gatewayStream.mockReturnValue(streamOf([{ type: 'delta', text: '好的。' }, { type: 'done', provider: 'qwen', model: 'test' }]))
    const history = [
      { role: 'user', content: text || '（用户发来一张照片，什么也没说）' },
      { role: 'assistant', content: '{"tool":"web_search","args":{"query":"搭配"}}' },
      { role: 'user', content: '工具执行结果：已查到资料' },
    ]
    const options = { allowExternal: true, authorizeExternal: authorized, promptInHistory: true, image: { mime: 'image/png', buffer: Buffer.from('fixture') } }
    await generateResponse(text, 'gentle', history, [], 'chronology', options)
    await collectEvents(generateResponseStream(text, 'gentle', history, [], 'chronology', options))
    const normal = gatewayComplete.mock.calls[0][0].messages
    expect(normal).toEqual(gatewayStream.mock.calls[0][0].messages)
    expect(normal).toHaveLength(3)
    expect(normal[0].content[1].type).toBe('image_url')
    expect(normal[1]).toEqual(history[1])
    expect(normal.at(-1)).toEqual({ role: 'user', content: history.at(-1).content.normalize('NFKC') })
  })

  it('ordinary and streamed chat receive the same curated health skill without replacing persona', async () => {
    gatewayComplete.mockResolvedValue({ content: '我们可以整理就诊问题。', provider: 'qwen', model: 'test' })
    gatewayStream.mockReturnValue(streamOf([
      { type: 'delta', text: '我们可以整理就诊问题。' },
      { type: 'done', provider: 'qwen', model: 'test' },
    ]))
    await generateResponse('我害怕妇科检查', 'toxic', [], [], 'health', { allowExternal: true, authorizeExternal: authorized })
    await collectEvents(generateResponseStream('我害怕妇科检查', 'toxic', [], [], 'health', { allowExternal: true, authorizeExternal: authorized }))
    const regular = gatewayComplete.mock.calls[0][0]
    const streamed = gatewayStream.mock.calls[0][0]
    expect(regular.systemAppend).toEqual(streamed.systemAppend)
    expect(regular.systemAppend[0].content).toContain('身体呵护 v1')
    expect(regular.systemAppend[0].content).toContain('暂停')
    expect(regular.persona).toBe('toxic')
    expect(regular.authorizeExternal).toBe(authorized)
  })

  it('ordinary and streamed chat receive the same emotion skill, with consent intact', async () => {
    gatewayComplete.mockResolvedValue({ content: '可以先聊聊那种落差。', provider: 'qwen', model: 'test' })
    gatewayStream.mockReturnValue(streamOf([
      { type: 'delta', text: '可以先聊聊那种落差。' },
      { type: 'done', provider: 'qwen', model: 'test' },
    ]))
    await generateResponse('我嫉妒朋友', 'gentle', [], [], 'emotion', { allowExternal: true, authorizeExternal: authorized })
    await collectEvents(generateResponseStream('我嫉妒朋友', 'gentle', [], [], 'emotion', { allowExternal: true, authorizeExternal: authorized }))
    expect(gatewayComplete.mock.calls[0][0].systemAppend).toEqual(gatewayStream.mock.calls[0][0].systemAppend)
    expect(gatewayComplete.mock.calls[0][0].systemAppend[0].content).toContain('情绪与关系梳理 v1')
    gatewayComplete.mockClear()
    gatewayStream.mockClear()
    await expect(generateResponse('我很孤独')).rejects.toBeInstanceOf(CloudConsentRequiredError)
    expect(await collectEvents(generateResponseStream('我很孤独'))).toEqual([{ type: 'error', reason: 'CLOUD_NOT_CONSENTED' }])
    expect(gatewayComplete).not.toHaveBeenCalled()
    expect(gatewayStream).not.toHaveBeenCalled()
  })

  it('a health topic does not bypass cloud consent', async () => {
    await expect(generateResponse('白带问题', 'gentle')).rejects.toBeInstanceOf(CloudConsentRequiredError)
    const events = await collectEvents(generateResponseStream('白带问题', 'gentle'))
    expect(events).toEqual([{ type: 'error', reason: 'CLOUD_NOT_CONSENTED' }])
    expect(gatewayComplete).not.toHaveBeenCalled()
    expect(gatewayStream).not.toHaveBeenCalled()
  })

  it('最多发送 19 条历史加当前消息，且只保留 role/content', () => {
    const history = Array.from({ length: 25 }, (_, index) => ({
      role: index % 2 ? 'assistant' : 'user',
      content: `消息${index}`,
      createdAt: new Date(),
      userId: 'should-not-leak',
    }))

    const messages = buildModelMessages('当前消息', history)
    expect(messages).toHaveLength(20)
    expect(messages.at(-1)).toEqual({ role: 'user', content: '当前消息' })
    expect(Object.keys(messages[0]).sort()).toEqual(['content', 'role'])
    expect(messages[0].content).toBe('消息6')
  })

  it('确定性脱敏手机号、邮箱与证件号（NFKC 归一后全角逗号变半角）', () => {
    expect(redactSensitiveText('打我13800138000或a@b.co，证件110101199001011234'))
      .toBe('打我[手机号]或[邮箱],证件[证件号]')
  })

  it('记忆上下文带不可信包裹，且不含原始 importance', () => {
    const context = buildMemoryContext([{ type: 'semantic', content: '喜欢火锅', importance: 9 }])
    expect(context).toContain('【不可信用户记忆数据】')
    expect(context).toContain('"content":"喜欢火锅"')
    expect(context).not.toContain('importance')
  })

  it('记忆分两组：此刻可以自然提起的，和知道就好、不必主动提的', () => {
    const context = buildMemoryContext([
      { id: 'a', type: 'semantic', content: '周三要答辩', foreground: true },
      { id: 'b', type: 'semantic', content: '喜欢下雨天', foreground: false },
    ])
    const [mention, background] = context.split('你知道、但不必主动提起')
    expect(mention).toContain('此刻相关、可以自然地提起')
    expect(mention).toContain('周三要答辩')
    expect(background).toContain('喜欢下雨天')
    expect(background).not.toContain('周三要答辩')
  })

  it('没经过内核挑选的记忆都算可以提起，不出现空的那一组', () => {
    const context = buildMemoryContext([{ id: 'a', type: 'semantic', content: '喜欢火锅' }])
    expect(context).toContain('此刻相关、可以自然地提起')
    expect(context).not.toContain('你知道、但不必主动提起')
  })

  it('记忆带跨功能来源标注 from，没有可标注来源就不加这个键', () => {
    const labeled = buildMemoryContext([
      { id: 'm1', type: 'semantic', content: '喜欢火锅', sources: [{ type: 'reading_note', id: 'n1', quote: 'x' }] },
    ])
    expect(labeled).toContain('"from":"你读书时记的"')

    const plain = buildMemoryContext([{ id: 'm2', type: 'semantic', content: '喜欢火锅', sources: [] }])
    expect(plain).not.toContain('"from"')
    expect(buildMemoryContext([{ id: 'm3', type: 'semantic', content: '喜欢火锅' }])).not.toContain('"from"')
  })

  it('兼容入口也永远不会为未确认草稿构建聊天上下文', () => {
    expect(buildDerivedContext([])).toBe('')
    const context = buildDerivedContext([
      { kind: 'pattern', content: '她习惯深夜学习', confidence: 'medium' },
      { kind: 'hypothesis', content: '她可能在准备考试', confidence: 'low' },
    ])
    expect(context).toBe('')
  })

  it('retrieveRelevantMemories 只返回有词重合的记忆', () => {
    const memories = [
      { id: '1', type: 'semantic', content: '用户喜欢吃火锅', importance: 5, tags: [] },
      { id: '2', type: 'semantic', content: '完全无关的内容', importance: 10, tags: [] },
    ]
    const result = retrieveRelevantMemories('火锅好吃吗', memories)
    expect(result.map((m) => m.id)).toEqual(['1'])
  })

  it('cosineSimilarity：同向趋近 1，正交为 0，长度不等或零范数为 0', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1)
    expect(cosineSimilarity([3, 4], [6, 8])).toBeCloseTo(1)
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0)
    expect(cosineSimilarity([1, 0], [1])).toBe(0)
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0)
    expect(cosineSimilarity([], [])).toBe(0)
  })

  it('语义路径：带 queryEmbedding 时按余弦排序、阈值入选并剥离向量字段', () => {
    const spec = { provider: 'https://embedding.invalid/v1', model: 'm', dimensions: 2, ruleVersion: 1 }
    const memories = [
      { id: 'a', type: 'semantic', content: '甲', importance: 5, tags: [], embedding: [1, 0], embeddingModel: 'm' },
      { id: 'b', type: 'semantic', content: '乙', importance: 9, tags: [], embedding: [1, 0], embeddingModel: 'm' },
      { id: 'c', type: 'semantic', content: '丙', importance: 1, tags: [], embedding: [0.9, 0.1], embeddingModel: 'm' },
      { id: 'd', type: 'semantic', content: '丁', importance: 10, tags: [] },
    ]
    const projected = memories.map((memory) => ({ ...memory, revision: 1,
      projection: memory.embedding ? { ...spec, memoryRevision: 1, vector: memory.embedding } : null }))
    const result = retrieveRelevantMemories('任意文本', projected, { ...spec, vector: [1, 0] })
    // 同分按 importance 降序（b 在 a 前），c 次之分；d 无向量不参与语义路径
    expect(result.map((m) => m.id)).toEqual(['b', 'a', 'c'])
    expect(result[0].embedding).toBeUndefined()
    expect(result[0].embeddingModel).toBeUndefined()
    expect(result[0].projection).toBeUndefined()
  })

  it('语义路径：低于阈值不入选；无向量记忆存在时关键词路径原样回退', () => {
    const weak = retrieveRelevantMemories('任意文本', [
      { id: 'a', type: 'semantic', content: '甲', importance: 5, tags: [], embedding: [1, 0] },
    ], [0, 1])
    expect(weak).toEqual([])

    const keywordMemories = [
      { id: '1', type: 'semantic', content: '用户喜欢吃火锅', importance: 5, tags: [] },
      { id: '2', type: 'semantic', content: '完全无关的内容', importance: 10, tags: [] },
    ]
    expect(retrieveRelevantMemories('火锅好吃吗', keywordMemories, [1, 0]).map((m) => m.id)).toEqual(['1'])
  })

  it('buildMemoryContext：canonical 边带出最多 2 条一跳关联并截断，无邻居不加 related 键', () => {
    const longNeighbor = '邻'.repeat(300)
    const context = buildMemoryContext(
      [
        { id: 'a', type: 'semantic', content: '喜欢火锅' },
        { id: 'b', type: 'episodic', content: '周五聚餐' },
      ],
      [
        { fromMemoryId: 'a', toMemoryId: 'b', fromContent: '喜欢火锅', toContent: '周五聚餐', relation: 'similar' },
        { fromMemoryId: 'x', toMemoryId: 'a', fromContent: longNeighbor, toContent: '喜欢火锅', relation: 'contradicts' },
        { fromMemoryId: 'y', toMemoryId: 'z', fromContent: '无关一', toContent: '无关二' },
      ],
    )
    expect(context).toContain('"related":[{"relation":"similar","content":"周五聚餐"}')
    expect(context).toContain('"relation":"contradicts"')
    // 每条关联按 MAX_MEMORY_CHARS=240 截断
    expect(context).not.toContain(longNeighbor)
    // b 通过 a 的边反向带出 fromContent
    expect(context).toContain('"related":[{"relation":"similar","content":"喜欢火锅"}]')

    const noEdges = buildMemoryContext([{ id: 'a', type: 'semantic', content: '喜欢火锅' }])
    expect(noEdges).not.toContain('related')
  })
})

describe('filterModelOutput 与本地安全模板', () => {
  it('命中拱火/冒充真人等红线时替换为人格模板', () => {
    const filtered = filterModelOutput('听我的，立刻分手', '我该怎么办', 'toxic')
    expect(filtered.filtered).toBe(true)
    expect(filtered.source).toBe('local_template')
  })

  it('正常内容原样通过并标记来源', () => {
    const passed = filterModelOutput('这事儿他做得不对。', '吐槽', 'toxic', 'qwen')
    expect(passed).toMatchObject({ filtered: false, source: 'qwen' })
  })

  it('本地模板按人格与情绪取文案，只有一种对话，不再有工作兜底文案', () => {
    expect(generateLocalTemplateResponse('今天有点焦虑', 'toxic').source).toBe('local_template')
    expect(generateLocalTemplateResponse('随便', 'gentle', 'work').content).toBe(generateLocalTemplateResponse('随便', 'gentle').content)
    expect(generateLocalTemplateResponse('随便', 'gentle').content).not.toContain('工具暂时没跟上')
  })
})

describe('buildGatewayEnv 云端唯一路径', () => {
  it('供应商固定为 qwen，场景路由不含 llamacpp', () => {
    const env = buildGatewayEnv(CLOUD_ENV)
    expect(env.GATEWAY_PROVIDERS).toBe('qwen')
    expect(env.GATEWAY_SCENE_chat).toBe('qwen')
    expect(env.GATEWAY_SCENE_explain).toBe('qwen')
    expect(env.GATEWAY_LLAMACPP_BASE_URL).toBeUndefined()
  })
})

describe('自定义模型供应商装配（2026-09-22）', () => {
  const provider = (id, host, scenes = ['chat'], priority = 1) => ({
    id,
    name: host,
    baseUrl: `https://${host}.example/v1`,
    model: `${host}-chat`,
    apiKey: `key-${host}`,
    scenes,
    priority,
  })

  beforeEach(() => {
    vi.clearAllMocks()
    resetCloudProviders()
    resetGatewayCache()
    providerRows.listProvidersForGateway.mockResolvedValue([])
  })

  it('一家都没配时退回 GATEWAY_QWEN_* 槽位，现有部署不受影响', async () => {
    await loadCloudProviders()
    const env = buildGatewayEnv({ ...CLOUD_ENV })
    expect(env.GATEWAY_PROVIDERS).toBe('qwen')
    expect(env.GATEWAY_SCENE_chat).toBe('qwen')
    expect(env.GATEWAY_SCENE_work).toBe('qwen')
    expect(env.GATEWAY_QWEN_SCOPE).toBe('external')
    expect(activeChatProviders()).toEqual([])
  })

  it('配了两家就按优先级拼出两家槽位与场景路由', async () => {
    providerRows.listProvidersForGateway.mockResolvedValue([
      provider('id-1', 'jia', ['chat', 'explain'], 1),
      provider('id-2', 'yi', ['chat'], 2),
    ])
    await loadCloudProviders()
    const env = buildGatewayEnv({ ...process.env, ...CLOUD_ENV })

    expect(env.GATEWAY_PROVIDERS).toBe('mpid1,mpid2')
    expect(env.GATEWAY_SCENE_chat).toBe('mpid1,mpid2')
    expect(env.GATEWAY_SCENE_explain).toBe('mpid1')
    // 没有一家承接工作台：不写这条路由，网关就不会误用一家没声明过的供应商
    expect(env.GATEWAY_SCENE_work).toBeUndefined()
    expect(env.GATEWAY_MPID1_BASE_URL).toBe('https://jia.example/v1')
    expect(env.GATEWAY_MPID1_MODEL).toBe('jia-chat')
    expect(env.GATEWAY_MPID1_API_KEY).toBe('key-jia')
    expect(env.GATEWAY_MPID1_SCOPE).toBe('external')
    expect(env.GATEWAY_MPID1_SAFE_NETWORK).toBe('true')
    expect(env.GATEWAY_MPID1_ALLOW_LOOPBACK).toBe('false')
    expect(env.GATEWAY_MPID1_SCENES).toBe('chat,explain')
    expect(env.GATEWAY_MPID1_PRIORITY).toBe('1')
    expect(env.GATEWAY_MPID2_PRIORITY).toBe('2')
    // 数据库里有配置时，环境变量槽不再参与
    expect(env.GATEWAY_PROVIDERS).not.toContain('qwen')
    expect(activeChatProviders()).toEqual([{ name: 'jia', model: 'jia-chat' }, { name: 'yi', model: 'yi-chat' }])
  })

  it('isCloudProviderConfigured 同时看数据库与环境变量', async () => {
    withoutCloudEnv()
    await loadCloudProviders()
    expect(isCloudProviderConfigured()).toBe(false)

    providerRows.listProvidersForGateway.mockResolvedValue([provider('id-1', 'jia')])
    await loadCloudProviders()
    expect(isCloudProviderConfigured()).toBe(true)
  })

  it('配置一变就清掉网关缓存，下一次聊天用新的装配', async () => {
    providerRows.listProvidersForGateway.mockResolvedValue([provider('id-1', 'jia')])
    await loadCloudProviders()
    await getGateway()
    expect(createGateway).toHaveBeenCalledTimes(1)
    expect(createGateway.mock.calls[0][0].GATEWAY_PROVIDERS).toBe('mpid1')

    // 管理员又加了一家：网关重建，而不是继续用旧的那一家
    providerRows.listProvidersForGateway.mockResolvedValue([provider('id-1', 'jia'), provider('id-2', 'yi', ['chat'], 2)])
    await loadCloudProviders()
    await getGateway()
    expect(createGateway).toHaveBeenCalledTimes(2)
    expect(createGateway.mock.calls[1][0].GATEWAY_PROVIDERS).toBe('mpid1,mpid2')
  })

  it('网关的日志转成我们的 logger 口径：切换原因不会只剩 [object Object]', async () => {
    providerRows.listProvidersForGateway.mockResolvedValue([provider('id-1', 'jia')])
    await loadCloudProviders()
    await getGateway()

    const { logger: gatewayLogger } = createGateway.mock.calls[0][1]
    expect(typeof gatewayLogger.warn).toBe('function')

    // 网关是 pino 式调用（对象在前、消息在后），我们的 logger 相反
    gatewayLogger.warn({ provider: 'mpid1', model: 'jia-chat', attempt: 1, result: 'http_401' }, 'llm gateway attempt failed')
    expect(logger.warn).toHaveBeenCalledWith('llm gateway attempt failed', {
      provider: 'mpid1', model: 'jia-chat', attempt: 1, result: 'http_401',
    })

    gatewayLogger.info('only a message')
    expect(logger.info).toHaveBeenCalledWith('only a message')
  })

  it('两家时前一家失败就换下一家（真网关，本机测试端点）', async () => {
    const calls = []
    const first = createServer((_request, response) => { calls.push('jia'); response.writeHead(500).end() })
    const second = createServer((_request, response) => {
      calls.push('yi')
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ choices: [{ message: { content: '我在。' } }] }))
    })
    first.listen(0, '127.0.0.1')
    second.listen(0, '127.0.0.1')
    await Promise.all([once(first, 'listening'), once(second, 'listening')])
    providerRows.listProvidersForGateway.mockResolvedValue([
      { ...provider('id-1', 'jia', ['chat'], 1), baseUrl: `http://127.0.0.1:${first.address().port}/v1` },
      { ...provider('id-2', 'yi', ['chat'], 2), baseUrl: `http://127.0.0.1:${second.address().port}/v1` },
    ])
    await loadCloudProviders()
    const { createGateway: realCreateGateway } = await vi.importActual('@cyber-sister/llm-gateway')
    const realGateway = await realCreateGateway(buildGatewayEnv({ APP_DISTRIBUTION: 'local', BIND_ADDRESS: '127.0.0.1' }), {})

    try {
      const result = await realGateway.complete({
        scene: 'chat',
        requestId: 'r-provider-failover',
        messages: [{ role: 'user', content: '你好' }],
        allowExternal: true,
        authorizeExternal: async () => true,
      })
      expect(result).toMatchObject({ content: '我在。', provider: 'mpid2', model: 'yi-chat', scope: 'external' })
      expect(calls).toEqual(['jia', 'jia', 'yi'])
    } finally {
      await Promise.all([first, second].map(server => new Promise(resolve => server.close(resolve))))
    }
  })
})

describe('generateResponse 同意门', () => {
  beforeEach(() => {
    gatewayComplete.mockReset()
    resetGatewayCache()
    withCloudEnv()
  })

  it('未同意（allowExternal=false）时抛 CLOUD_NOT_CONSENTED 且不调用网关', async () => {
    await expect(generateResponse('你好', 'toxic', [], [], 'req-1', { allowExternal: false }))
      .rejects.toThrow(CloudConsentRequiredError)
    expect(gatewayComplete).not.toHaveBeenCalled()
  })

  it('供应商未配置时抛 LLM_UNAVAILABLE，即使已同意', async () => {
    withoutCloudEnv()
    await expect(generateResponse('你好', 'toxic', [], [], 'req-1', { allowExternal: true, authorizeExternal: authorized }))
      .rejects.toThrow(LlmUnavailableError)
    expect(gatewayComplete).not.toHaveBeenCalled()
  })

  it('已同意且网关返回内容时来源为 qwen', async () => {
    gatewayComplete.mockResolvedValue({ content: '我在。', provider: 'qwen', model: 'm', scope: 'external' })
    const result = await generateResponse('你好', 'toxic', [], [], 'req-1', { allowExternal: true, authorizeExternal: authorized })
    expect(result).toMatchObject({ source: 'qwen', provider: 'qwen' })
  })

  it('即使旧调用者传入工作台草稿，模型提示词中也没有这些内容', async () => {
    gatewayComplete.mockResolvedValue({ content: '我在。', provider: 'qwen', model: 'm', scope: 'external' })
    await generateResponse('你好', 'toxic', [], [], 'req-1', {
      allowExternal: true,
      authorizeExternal: authorized,
      derivedInsights: [{ kind: 'pattern', content: '她习惯深夜学习', confidence: 'medium' }],
      extraSystem: [{ role: 'system', content: '工具目录' }],
    })
    const append = gatewayComplete.mock.calls[0][0].systemAppend
    const workspace = append.find((m) => m.content.includes('【她的工作台'))
    expect(workspace).toBeUndefined()
    expect(JSON.stringify(gatewayComplete.mock.calls)).not.toContain('她习惯深夜学习')
    expect(append.some((m) => m.content === '工具目录')).toBe(true)
  })

  it('无工作台条目时 systemAppend 不含工作台包裹', async () => {
    gatewayComplete.mockResolvedValue({ content: '我在。', provider: 'qwen', model: 'm', scope: 'external' })
    await generateResponse('你好', 'toxic', [], [], 'req-1', { allowExternal: true, authorizeExternal: authorized })
    const append = gatewayComplete.mock.calls[0][0].systemAppend
    expect(append.some((m) => m.content.includes('【她的工作台'))).toBe(false)
  })

  it('已同意但网关无内容且授权仍有效时抛 LLM_UNAVAILABLE', async () => {
    gatewayComplete.mockResolvedValue(null)
    await expect(generateResponse('你好', 'toxic', [], [], 'req-1', { allowExternal: true, authorizeExternal: authorized }))
      .rejects.toThrow(LlmUnavailableError)
  })
})

describe('generateResponseStream 分句安全流', () => {
  beforeEach(() => {
    gatewayStream.mockReset()
    resetGatewayCache()
    withCloudEnv()
  })

  it('未同意时首句前产出 CLOUD_NOT_CONSENTED 且不调用网关', async () => {
    const events = await collectEvents(generateResponseStream('你好', 'toxic', [], [], 'req-1', { allowExternal: false }))
    expect(events).toEqual([{ type: 'error', reason: 'CLOUD_NOT_CONSENTED' }])
    expect(gatewayStream).not.toHaveBeenCalled()
  })

  it('按句界分句产出，尾段随 done 收尾', async () => {
    gatewayStream.mockReturnValue(streamOf([
      { type: 'delta', text: '第一句。第二句！' },
      { type: 'done', provider: 'qwen', model: 'm', scope: 'external' },
    ]))
    const events = await collectEvents(generateResponseStream('你好', 'toxic', [], [], 'req-1', { allowExternal: true, authorizeExternal: authorized }))
    expect(events[0]).toEqual({ type: 'sentence', text: '第一句。' })
    expect(events[1]).toEqual({ type: 'sentence', text: '第二句!' })
    expect(events.at(-1)).toMatchObject({ type: 'done', source: 'qwen' })
  })

  it('累计安全检查命中时中止上游并以本地模板 replace', async () => {
    gatewayStream.mockReturnValue(streamOf([
      { type: 'delta', text: '听我的，立刻辞职。' },
      { type: 'done', provider: 'qwen', model: 'm', scope: 'external' },
    ]))
    const events = await collectEvents(generateResponseStream('我该怎么办', 'toxic', [], [], 'req-1', { allowExternal: true, authorizeExternal: authorized }))
    expect(events[0].type).toBe('replace')
    expect(events.at(-1)).toMatchObject({ type: 'done', source: 'local_template' })
  })

  it.each(['。', ''])('2000 字之后的危险输出仍被检查，尾部句界为 %s', async (ending) => {
    gatewayStream.mockReturnValue(streamOf([
      { type: 'delta', text: `${'安全'.repeat(1000)}杀了他${ending}` },
      { type: 'done', provider: 'qwen', model: 'm', scope: 'external' },
    ]))
    const events = await collectEvents(generateResponseStream('你好', 'gentle', [], [], 'req-1', { allowExternal: true, authorizeExternal: authorized }))
    expect(events.some((event) => event.type === 'replace')).toBe(true)
    expect(events.filter((event) => event.type === 'sentence').map((event) => event.text).join('')).not.toContain('杀了他')
    expect(events.at(-1)).toMatchObject({ type: 'done', source: 'local_template' })
  })

  it('分片中的标识符在任何 sentence 发送前脱敏，最终内容一致', async () => {
    gatewayStream.mockReturnValue(streamOf([
      { type: 'delta', text: '联系 synthetic@' },
      { type: 'delta', text: 'example.invalid。电话13800' },
      { type: 'delta', text: '138000' },
      { type: 'done', provider: 'qwen', model: 'm', scope: 'external' },
    ]))
    const events = await collectEvents(generateResponseStream('你好', 'gentle', [], [], 'req-1', { allowExternal: true, authorizeExternal: authorized }))
    const displayed = events.filter((event) => event.type === 'sentence').map((event) => event.text).join('')
    expect(displayed).toBe('联系 [邮箱]。电话[手机号]')
    expect(events.at(-1).content).toBe(displayed)
  })

  it('自然语言的流式输出与 done 共用长度上限', async () => {
    gatewayStream.mockReturnValue(streamOf([
      { type: 'delta', text: '安全。'.repeat(800) },
      { type: 'done', provider: 'qwen', model: 'm', scope: 'external' },
    ]))
    const events = await collectEvents(generateResponseStream('你好', 'gentle', [], [], 'req-1', { allowExternal: true, authorizeExternal: authorized }))
    const displayed = events.filter((event) => event.type === 'sentence').map((event) => event.text).join('')
    expect(displayed).toHaveLength(2000)
    expect(events.at(-1).content).toBe(displayed)
  })

  it('本地带工具的回合累计过滤同样换成她的说话方式模板，模型场景仍是 chat', async () => {
    gatewayStream.mockReturnValue(streamOf([{ type: 'delta', text: '杀了他。' }]))
    const events = await collectEvents(generateResponseStream('你好', 'gentle', [], [], 'req-1', { allowExternal: true, authorizeExternal: authorized, agent: true }))
    expect(events.at(-1).content).toBe(generateLocalTemplateResponse('你好', 'gentle').content)
    expect(gatewayStream.mock.calls[0][0].scene).toBe('chat')
  })

  it('首句产出后上游失败只报 STREAM_FAILED', async () => {
    gatewayStream.mockReturnValue(streamOf([
      { type: 'delta', text: '先说一句。' },
      { type: 'error', reason: 'upstream_error' },
    ]))
    const events = await collectEvents(generateResponseStream('你好', 'toxic', [], [], 'req-1', { allowExternal: true, authorizeExternal: authorized }))
    expect(events.at(-1)).toEqual({ type: 'error', reason: 'STREAM_FAILED' })
  })

  it('首句产出前失败且未授权时映射为 CLOUD_NOT_CONSENTED', async () => {
    gatewayStream.mockReturnValue(streamOf([{ type: 'error', reason: 'upstream_error' }]))
    const events = await collectEvents(generateResponseStream('你好', 'toxic', [], [], 'req-1', { allowExternal: false }))
    expect(events).toEqual([{ type: 'error', reason: 'CLOUD_NOT_CONSENTED' }])
  })

  it('工具调用完整成功后才产出 toolcall', async () => {
    gatewayStream.mockReturnValue(streamOf([
      { type: 'delta', text: '{"tool":"add_task","args":{"content":"x"}}' },
      { type: 'done', provider: 'qwen', model: 'm', scope: 'external' },
    ]))
    const events = await collectEvents(generateResponseStream('帮我记个待办', 'toxic', [], [], 'req-1', { allowExternal: true, authorizeExternal: authorized }))
    expect(events[0]).toMatchObject({ type: 'toolcall', name: 'add_task' })
  })

  it('完整工具对象后仍有解释文本时按普通回复处理，不执行示例', async () => {
    gatewayStream.mockReturnValue(streamOf([
      { type: 'delta', text: '{"tool":"delete_todo","args":{"id":"synthetic"}}' },
      { type: 'delta', text: ' 这只是 JSON 示例，请不要执行。' },
      { type: 'done', provider: 'qwen', model: 'm', scope: 'external' },
    ]))
    const events = await collectEvents(generateResponseStream('请给一个示例', 'gentle', [], [], 'req', { allowExternal: true, authorizeExternal: authorized }))
    expect(events.some((event) => event.type === 'toolcall')).toBe(false)
    expect(events.at(-1)).toMatchObject({ type: 'done' })
    expect(events.at(-1).content).toContain('请不要执行')
  })

  it('完整工具对象后上游断流失败时不执行副作用', async () => {
    gatewayStream.mockReturnValue(streamOf([
      { type: 'delta', text: '{"tool":"delete_todo","args":{"id":"synthetic"}}' },
      { type: 'error', reason: 'upstream_error' },
    ]))
    const events = await collectEvents(generateResponseStream('synthetic', 'gentle', [], [], 'req', { allowExternal: true, authorizeExternal: authorized }))
    expect(events).toEqual([{ type: 'error', reason: 'LLM_UNAVAILABLE' }])
  })

  it.each([
    '```json\n{"tool":"add_task","args":{"content":"x"}}\n```',
    '<dots_function_call>{"tool":"add_task","args":{"content":"x"}}</dots_function_call>',
  ])('完整包装工具 %s 在流式中复用整段校验', async (content) => {
    gatewayStream.mockReturnValue(streamOf([
      { type: 'delta', text: content },
      { type: 'done', provider: 'qwen', model: 'm', scope: 'external' },
    ]))
    const events = await collectEvents(generateResponseStream('synthetic', 'gentle', [], [], 'req', { allowExternal: true, authorizeExternal: authorized }))
    expect(events).toEqual([{ type: 'toolcall', name: 'add_task', args: { content: 'x' } }])
  })
})

describe('generateCompanionNote / generateExplanationWithModel 同意门', () => {
  beforeEach(() => {
    gatewayComplete.mockReset()
    resetGatewayCache()
    withCloudEnv()
  })

  it('未同意时摘要与解释均抛 CLOUD_NOT_CONSENTED', async () => {
    await expect(generateCompanionNote({ instruction: 'i', userText: 'u' }, 'req-1', { allowExternal: false }))
      .rejects.toThrow(CloudConsentRequiredError)
    await expect(generateExplanationWithModel('p', 'req-1', { allowExternal: false }))
      .rejects.toThrow(CloudConsentRequiredError)
    expect(gatewayComplete).not.toHaveBeenCalled()
  })

  it('摘要是内部笔记：走 explain、不带说话方式，含过滤词也原样保留', async () => {
    // 回复过滤会把「找他理论」换成安慰模板；摘要若也被换掉，那段历史就永久丢了
    const vent = '用户说被同事抢功，气到想去找他理论，最后决定先写邮件。'
    gatewayComplete.mockResolvedValue({ content: vent, provider: 'qwen', model: 'm', scope: 'external' })

    const note = await generateCompanionNote({ instruction: 'i', userText: 'u' }, 'req-1', { allowExternal: true, authorizeExternal: authorized })

    expect(note).toMatchObject({ source: 'qwen', content: vent })
    const request = gatewayComplete.mock.calls[0][0]
    expect(request.scene).toBe('explain')
    expect(request.persona).toBeUndefined()
  })

  for (const [name, call] of [
    ['response', (options) => generateResponse('synthetic', 'gentle', [], [], 'req', options)],
    ['explanation', (options) => generateExplanationWithModel('synthetic', 'req', options)],
    ['note', (options) => generateCompanionNote({ instruction: 'synthetic', userText: 'synthetic' }, 'req', options)],
  ]) {
    it(`${name} 已取消时不调用网关`, async () => {
      const abort = new AbortController()
      abort.abort()
      await expect(call({ allowExternal: true, authorizeExternal: authorized, signal: abort.signal })).rejects.toMatchObject({ name: 'AbortError' })
      expect(gatewayComplete).not.toHaveBeenCalled()
    })

    it(`${name} 传导取消信号并拒绝取消后的迟到回复`, async () => {
      const abort = new AbortController()
      gatewayComplete.mockImplementation(async () => {
        abort.abort()
        return { content: '迟到的回复', provider: 'qwen', model: 'm' }
      })
      await expect(call({ allowExternal: true, authorizeExternal: authorized, signal: abort.signal })).rejects.toMatchObject({ name: 'AbortError' })
      expect(gatewayComplete.mock.calls[0][0].signal).toBe(abort.signal)
    })
  }
})

describe('generateResponse 图片消息（多模态 parts）', () => {
  const image = { buffer: Buffer.from('fake-jpeg'), mime: 'image/jpeg' }

  beforeEach(() => {
    gatewayComplete.mockReset()
    resetGatewayCache()
    withCloudEnv()
  })

  it('带 image 时 messages 末条替换为 parts（text + data URL）', async () => {
    gatewayComplete.mockResolvedValue({ content: '这身好看。', provider: 'qwen', model: 'm', scope: 'external' })
    await generateResponse('看这身搭配', 'toxic', [], [], 'req-1', {
      allowExternal: true,
      authorizeExternal: authorized,
      image,
    })
    const messages = gatewayComplete.mock.calls[0][0].messages
    const last = messages[messages.length - 1]
    expect(last.role).toBe('user')
    expect(Array.isArray(last.content)).toBe(true)
    expect(last.content[0]).toEqual({ type: 'text', text: '看这身搭配' })
    expect(last.content[1].type).toBe('image_url')
    expect(last.content[1].image_url.url).toMatch(/^data:image\/jpeg;base64,/)
  })

  it('空文本 + 图 → 占位文案', async () => {
    gatewayComplete.mockResolvedValue({ content: '这身好看。', provider: 'qwen', model: 'm', scope: 'external' })
    await generateResponse('', 'toxic', [], [], 'req-1', {
      allowExternal: true,
      authorizeExternal: authorized,
      image,
    })
    const messages = gatewayComplete.mock.calls[0][0].messages
    const last = messages[messages.length - 1]
    expect(last.content[0].text).toBe('（用户发来一张照片，什么也没说）')
  })

  it('不带 image 时 messages 末条仍是纯字符串（既有行为不变）', async () => {
    gatewayComplete.mockResolvedValue({ content: '我在。', provider: 'qwen', model: 'm', scope: 'external' })
    await generateResponse('你好', 'toxic', [], [], 'req-1', { allowExternal: true, authorizeExternal: authorized })
    const messages = gatewayComplete.mock.calls[0][0].messages
    expect(typeof messages[messages.length - 1].content).toBe('string')
  })
})
