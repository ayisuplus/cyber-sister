/**
 * 回复质量评测装置：只把数据库换成假的，其余全部走真实的生产聊天链路
 * （chatService.sendMessageStream → agentTurn → companionService → llmService → 网关 → 输出过滤），
 * 所以 B、C 两组之间唯一的区别就是「女性层」（共用前言与书籍技能）。
 *
 * 三种用法（由 EVAL_MODE 决定，只能经 apps/api/scripts/eval-replies.mjs 设成 dry / live）：
 * - 不设（CI）：fetch 换成桩，逐组断言发出去的请求长什么样；不联网、不写文件。
 * - dry：整套流程用桩跑一遍，列出要发多少次请求、提示词多少字，写一份桩报告。
 * - live：真实调用生成与打分模型，要花钱；每次跑之前先问产品负责人。
 * 结果写到 apps/api/eval-results/<时间>-<模式>/（不进仓库）。密钥只从文件读，不打印。
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { execSync } from 'node:child_process'
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const h = vi.hoisted(() => ({
  bookSkills: true,
  user: null,
  messages: [],
  memories: [],
  nudges: [],
  requests: [],
  logs: [],
}))

vi.mock('../../src/prisma/client.js', () => {
  const tx = {
    user: { findUnique: async () => ({ companionState: null, companionRevision: 0 }), update: async () => ({}) },
    $queryRaw: async () => [{ id: 'eval-user' }],
    message: { create: async ({ data }) => ({ id: `eval-${data.role}`, ...data }) },
    conversation: { update: async () => ({}) },
    crisisLog: { create: async () => ({ id: 'eval-crisis' }) },
  }
  return {
    default: {
      user: { findUnique: async () => h.user },
      conversation: {
        findFirst: async () => ({ id: 'eval-thread', userId: 'eval-user', mode: 'chat', archivedAt: null }),
        findUnique: async () => ({ summary: null, summaryUpToAt: null }),
        update: async () => ({}),
      },
      message: { findMany: async () => h.messages, count: async () => 0 },
      memory: { findMany: async () => h.memories },
      memoryEdge: { findMany: async () => [] },
      derivedInsight: { findMany: async () => [] },
      diaryEntry: { findMany: async () => [] },
      periodRecord: { findFirst: async () => null },
      crisisLog: { create: async () => ({ id: 'eval-crisis' }) },
      $transaction: (callback) => callback(tx),
    },
  }
})
vi.mock('../../src/services/nudgeService.js', () => ({ describeRecentNudges: async () => h.nudges }))
vi.mock('../../src/services/embeddingService.js', () => ({ embedQuery: async () => null }))
vi.mock('../../src/services/chatImageService.js', () => ({ saveChatImage: async () => null, deleteChatImages: async () => {} }))
// 日志里只有供应商、模型、尝试次数与结果，不含正文；真跑时存下来排查失败原因
vi.mock('../../src/utils/logger.js', () => {
  const record = (level) => (message, context) => { h.logs.push({ level, message, ...(context ?? {}) }) }
  return { default: { debug: () => {}, info: record('info'), warn: record('warn'), error: record('error') } }
})
// 一家自定义供应商都不读：网关退回 GATEWAY_QWEN_* 环境变量槽，由装置填上生成模型
vi.mock('../../src/services/modelProviderService.js', async (importOriginal) => ({
  ...(await importOriginal()),
  listProvidersForGateway: async () => [],
}))
// 工具在评测环境里什么都读不到，也不执行任何操作；如实告诉模型
vi.mock('../../src/services/agentService.js', async (importOriginal) => {
  const offline = async (_userId, { name }) => ({
    tool: name, ok: false, summary: '评测环境没有数据',
    feedback: '这是离线评测环境：工具读不到任何数据，也没有执行任何操作。请直接回复她，不要编造结果。',
  })
  return { ...(await importOriginal()), executeToolCall: offline, executeToolCallOnce: offline }
})
// 去掉「书」这一层只替换这一个模块（见 bookSkills.js）
vi.mock('../../src/services/bookSkills.js', async (importOriginal) => {
  const actual = await importOriginal()
  return { buildBookSkillContexts: (...args) => (h.bookSkills ? actual.buildBookSkillContexts(...args) : []) }
})

import { createGateway } from '@cyber-sister/llm-gateway'
import { sendMessageStream } from '../../src/services/chatService.js'
import { getGateway, resetCloudProviders, resetGatewayCache } from '../../src/services/llmService.js'
import { EXTERNAL_LLM_CONSENT_VERSION } from '../../src/services/userService.js'
import { ARMS, parseArms } from '../../src/eval/arms.js'
import { DEFAULT_LOCAL_TIME, loadDataset, validateRubric, validateScenarios } from '../../src/eval/dataset.js'
import { JUDGE_INSTRUCTION } from '../../src/eval/judge.js'
import { renderMarkdown, summarize } from '../../src/eval/report.js'
import { runEvaluation } from '../../src/eval/runner.js'

const MODE = ['dry', 'live'].includes(process.env.EVAL_MODE) ? process.env.EVAL_MODE : 'ci'
const HERE = fileURLToPath(new URL('.', import.meta.url))
const RESULTS_ROOT = path.resolve(HERE, '../../eval-results')
const STUB_GEN = 'https://gen.eval.invalid/v1'
const STUB_JUDGE = 'https://judge.eval.invalid/v1'
const MIMO_JUDGE_BODY = '{"thinking":{"type":"disabled"},"response_format":{"type":"json_object"}}'
// 场景都放在同一天；没写 localTime 的按 DEFAULT_LOCAL_TIME（晚上八点半，不落在深夜的分寸里）
const EVAL_DAY = '2026-09-24'
const DAY_MS = 24 * 60 * 60 * 1000

const { rubric, scenarios } = loadDataset(HERE)
const scenarioById = new Map(scenarios.cases.map((scenario) => [scenario.id, scenario]))

// ---------- 网络：桩或真实调用，两种都记下发了几次、提示词多少字 ----------

const encoder = new TextEncoder()
const jsonResponse = (content) => new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] }), { status: 200 })
const sseResponse = (content) => new Response(new ReadableStream({
  start(controller) {
    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`))
    controller.enqueue(encoder.encode('data: [DONE]\n\n'))
    controller.close()
  },
}), { status: 200 })

function stubFetch(url, init) {
  const body = JSON.parse(init.body)
  if (String(url).startsWith(STUB_JUDGE)) {
    const user = body.messages.at(-1).content
    if (user.includes('【回复一】')) return Promise.resolve(jsonResponse('{"winner":"tie","reason":"桩"}'))
    const ids = [...user.matchAll(/^(R\d+)：/gm)].map((match) => match[1])
    return Promise.resolve(jsonResponse(JSON.stringify(Object.fromEntries(ids.map((id) => [id, { verdict: 'yes', reason: '桩' }])))))
  }
  return Promise.resolve(body.stream ? sseResponse('嗯，我在。') : jsonResponse('嗯，我在。'))
}

// 模型的原话（过滤之前）：SSE 拼出增量文本，非流式取 message.content
function rawContentOf(text) {
  if (!text.includes('data:')) {
    try {
      return JSON.parse(text).choices?.[0]?.message?.content ?? ''
    } catch {
      return ''
    }
  }
  let content = ''
  for (const line of text.split('\n')) {
    const data = line.startsWith('data:') ? line.slice(5).trim() : ''
    if (!data || data === '[DONE]') continue
    try {
      content += JSON.parse(data).choices?.[0]?.delta?.content ?? ''
    } catch {
      // 半截的帧不影响其余部分
    }
  }
  return content
}

// 打分请求按内容认（生成与打分可能是同一家、同一个地址）
const isJudgeRequest = (body) => (body.messages ?? []).some((message) => message.role === 'system' && message.content === JUDGE_INSTRUCTION)

// 记下每次请求；发给生成模型的那些顺手把原话存下来，好核对输出过滤到底换掉了什么
const recording = (inner) => async (url, init) => {
  const body = JSON.parse(init?.body ?? '{}')
  const entry = { host: new URL(String(url)).host, body, judge: isJudgeRequest(body) }
  h.requests.push(entry)
  const response = await inner(url, init)
  if (entry.judge) return response
  const text = await response.text()
  entry.raw = rawContentOf(text)
  return new Response(text, { status: response.status, statusText: response.statusText, headers: response.headers })
}

const contentChars = (content) => (typeof content === 'string' ? content.length : 0)
const promptCharsOf = (requests) => requests.reduce((sum, request) => sum + (request.body.messages ?? []).reduce((total, message) => total + contentChars(message.content), 0), 0)

function readKey(file) {
  try {
    return readFileSync(file, 'utf8').trim()
  } catch {
    throw new Error(`读不到密钥文件：${file}`)
  }
}

function modelConfig() {
  if (MODE !== 'live') {
    return {
      gen: { baseUrl: STUB_GEN, model: 'stub-gen', apiKey: 'stub' },
      judge: { baseUrl: STUB_JUDGE, model: 'stub-judge', apiKey: 'stub', extraBody: '' },
    }
  }
  const required = ['EVAL_GEN_BASE_URL', 'EVAL_GEN_MODEL', 'EVAL_GEN_API_KEY_FILE', 'EVAL_JUDGE_BASE_URL', 'EVAL_JUDGE_MODEL', 'EVAL_JUDGE_API_KEY_FILE']
  const missing = required.filter((name) => !process.env[name])
  if (missing.length) throw new Error(`真实调用缺少配置：${missing.join('、')}`)
  const judgeUrl = process.env.EVAL_JUDGE_BASE_URL
  return {
    gen: { baseUrl: process.env.EVAL_GEN_BASE_URL, model: process.env.EVAL_GEN_MODEL, apiKey: readKey(process.env.EVAL_GEN_API_KEY_FILE) },
    judge: {
      baseUrl: judgeUrl,
      model: process.env.EVAL_JUDGE_MODEL,
      apiKey: readKey(process.env.EVAL_JUDGE_API_KEY_FILE),
      // MiMo 默认开着思考模式：开着时温度被强制成 1.0、JSON 也不一定合法，打分时关掉
      extraBody: process.env.EVAL_JUDGE_EXTRA_BODY ?? (new URL(judgeUrl).host.endsWith('xiaomimimo.com') ? MIMO_JUDGE_BODY : ''),
    },
  }
}

// ---------- 生成：把场景摆进假数据库，按组切换女性层，走真实的聊天链路 ----------

let currentArm = null

function applyArm(armConfig) {
  if (currentArm === armConfig.id) return
  currentArm = armConfig.id
  h.bookSkills = armConfig.bookSkills !== false
  vi.stubEnv('GATEWAY_PERSONA_SHARED_PREAMBLE', armConfig.amie && armConfig.sharedPreamble === false ? 'off' : undefined)
  resetGatewayCache()
}

function prepareScenario(scenario, style) {
  const given = scenario.given ?? {}
  const now = new Date(`${EVAL_DAY}T${given.localTime ?? DEFAULT_LOCAL_TIME}:00+08:00`)
  vi.setSystemTime(now)
  h.user = {
    persona: style,
    nickname: given.nickname ?? null,
    birthDate: null,
    periodConsentAt: null,
    periodToneAt: null,
    externalLlmConsent: true,
    externalLlmConsentVersion: EXTERNAL_LLM_CONSENT_VERSION,
    companionState: null,
    companionRevision: 0,
  }
  const history = scenario.history ?? []
  // 数据库按时间倒序给出最近的消息
  h.messages = history
    .map((turn, index) => ({ role: turn.role, content: turn.content, createdAt: new Date(now.getTime() - (history.length - index) * 60_000), workArtifacts: [] }))
    .reverse()
  if (!history.length && given.lastMessageDaysAgo) {
    h.messages = [{ role: 'assistant', content: '晚安', createdAt: new Date(now.getTime() - given.lastMessageDaysAgo * DAY_MS), workArtifacts: [] }]
  }
  h.memories = (given.memories ?? []).map((memory) => ({
    id: memory.id, revision: 1, content: memory.content, type: memory.type ?? 'semantic', importance: memory.importance ?? 5,
    tags: memory.tags ?? [], pinned: memory.pinned === true, projection: null, sources: [],
  }))
  h.nudges = (given.nudges ?? []).map((content, index) => ({ id: `nudge-${index}`, kind: 'reminder', content }))
}

/** 生成一条回复，并记下这一条一共发出去多少字的提示词（含工具回合）。 */
async function generate(task) {
  const before = h.requests.length
  const result = await generateReply(task)
  const sent = h.requests.slice(before).filter((request) => !request.judge)
  return { ...result, promptChars: promptCharsOf(sent), raw: sent.map((request) => request.raw ?? '') }
}

async function generateReply({ scenario, armConfig, style }) {
  applyArm(armConfig)
  if (!armConfig.amie) {
    // 通用模型：同一个生成模型，不带任何 Amie 提示词、上下文与输出过滤
    const gateway = await getGateway()
    const result = await gateway.complete({
      scene: 'explain',
      requestId: `eval-${scenario.id}-A`,
      messages: [...(scenario.history ?? []), { role: 'user', content: scenario.text }],
      allowExternal: true,
      authorizeExternal: async () => true,
    })
    return { reply: result?.content ?? null, source: result ? 'raw' : null }
  }
  vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true })
  try {
    prepareScenario(scenario, style)
    let done = null
    let failure = null
    for await (const event of sendMessageStream('eval-thread', 'eval-user', scenario.text, `eval-${scenario.id}-${armConfig.id}-${style}`)) {
      if (event.type === 'done') done = event
      else if (event.type === 'error') failure = event.reason
      else if (event.type === 'blocked') failure = '整轮被危机分流拦下'
    }
    if (!done) return { error: failure ?? '回复没有完成' }
    return { reply: done.aiMessage?.content ?? null, source: done.source }
  } finally {
    vi.useRealTimers()
  }
}

async function createJudge(config) {
  const gateway = await createGateway({
    GATEWAY_PROVIDERS: 'judge',
    GATEWAY_JUDGE_BASE_URL: config.baseUrl,
    GATEWAY_JUDGE_MODEL: config.model,
    GATEWAY_JUDGE_API_KEY: config.apiKey,
    GATEWAY_JUDGE_SCOPE: 'external',
    GATEWAY_JUDGE_SCENES: 'explain',
    GATEWAY_SCENE_explain: 'judge',
    ...(config.extraBody ? { GATEWAY_JUDGE_EXTRA_BODY: config.extraBody } : {}),
  })
  return async ({ system, user }) => {
    // 偶尔会回一段空内容（DeepSeek 实测）：再问一次
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      // eslint-disable-next-line no-await-in-loop
      const result = await gateway.complete({
        scene: 'explain',
        requestId: 'eval-judge',
        messages: [{ role: 'user', content: user }],
        systemAppend: [{ role: 'system', content: system }],
        temperature: 0,
        maxTokens: 1024,
        timeoutMs: 120_000,
        allowExternal: true,
        authorizeExternal: async () => true,
      })
      if (result?.content) return result.content
    }
    throw new Error('打分模型没有回答')
  }
}

function selectCases() {
  const prefixes = (process.env.EVAL_CASES ?? '').split(',').map((item) => item.trim()).filter(Boolean)
  const picked = prefixes.length ? scenarios.cases.filter((scenario) => prefixes.some((prefix) => scenario.id.startsWith(prefix))) : scenarios.cases
  const limit = Number.parseInt(process.env.EVAL_LIMIT ?? '', 10)
  return Number.isInteger(limit) && limit > 0 ? picked.slice(0, limit) : picked
}

const hostOf = (url) => new URL(url).host
const gitCommit = () => {
  try {
    const hash = execSync('git rev-parse --short HEAD', { cwd: HERE }).toString().trim()
    const dirty = execSync('git status --porcelain', { cwd: HERE }).toString().trim()
    return dirty ? `${hash}（另有未提交的改动）` : hash
  } catch {
    return '（读不到提交）'
  }
}
const stampOf = (date) => date.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)
const readJsonl = (file) => readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
const writeJsonl = (file, rows) => writeFileSync(file, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''))

// ---------- 装配与收尾 ----------

let config
let judge

beforeAll(async () => {
  config = modelConfig()
  // 托管版的部署形态：不打开本机工具（vitest 配置默认是本机分发）
  vi.stubEnv('APP_DISTRIBUTION', 'web')
  vi.stubEnv('GATEWAY_QWEN_BASE_URL', config.gen.baseUrl)
  vi.stubEnv('GATEWAY_QWEN_MODEL', config.gen.model)
  vi.stubEnv('GATEWAY_QWEN_API_KEY', config.gen.apiKey)
  vi.stubGlobal('fetch', recording(MODE === 'live' ? globalThis.fetch : stubFetch))
  resetCloudProviders()
  resetGatewayCache()
  judge = await createJudge(config.judge)
})

afterAll(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  resetGatewayCache()
  resetCloudProviders()
})

const generationRequests = () => h.requests.filter((request) => !request.judge)
const systemText = (request) => request.body.messages.filter((message) => message.role === 'system').map((message) => message.content).join('\n')

async function lastRequestFor(caseId, armId, style = 'gentle') {
  const before = generationRequests().length
  const result = await generate({ scenario: scenarioById.get(caseId), armConfig: ARMS[armId], style: ARMS[armId].amie ? style : null })
  expect(result.error ?? null).toBeNull()
  const sent = generationRequests().slice(before)
  expect(sent.length).toBeGreaterThan(0)
  return sent.at(-1)
}

describe.runIf(MODE === 'ci')('回复质量评测装置（离线：只看发出去的请求）', () => {
  it('A 组是不带任何 Amie 提示词的通用模型', async () => {
    const request = await lastRequestFor('b01-period-pain', 'A')
    expect(request.body.messages).toEqual([{ role: 'user', content: scenarioById.get('b01-period-pain').text }])
  })

  it('B 组去掉共用前言与书籍技能，安全边界还在', async () => {
    const system = systemText(await lastRequestFor('b01-period-pain', 'B'))
    expect(system).toContain('你是 AI，不是真人')
    expect(system).not.toContain('她的决定永远归她')
    // 模块操作技能（如「经期」）是产品功能，各组都在；去掉的只是由书改编的那两本
    expect(system).not.toContain('[Amie 内置技能：身体呵护')
    expect(system).not.toContain('[Amie 内置技能：情绪与关系梳理')
  })

  it('C 组带上共用前言，话题命中时带上书籍技能', async () => {
    const body = systemText(await lastRequestFor('b01-period-pain', 'C'))
    expect(body).toContain('她的决定永远归她')
    expect(body).toContain('[Amie 内置技能：身体呵护 v1]')
    const emotion = systemText(await lastRequestFor('e02-friend-promoted', 'C', 'cool'))
    expect(emotion).toContain('[Amie 内置技能：情绪与关系梳理 v1]')
    expect(emotion).toContain('人设：安静型闺蜜')
  })

  it('小心模式的场景带上小心模式块，深夜的场景知道现在是凌晨', async () => {
    expect(systemText(await lastRequestFor('c01-tired-of-living', 'C'))).toContain('【这一轮请格外小心】')
    expect(systemText(await lastRequestFor('e01-night-presentation', 'C'))).toContain('凌晨 01:40')
  })

  it('整套流程用桩跑得通：生成、打分、比较、自检与报告', async () => {
    const cases = ['e01-night-presentation', 'x01-are-you-real'].map((id) => scenarioById.get(id))
    const run = await runEvaluation({ rubric, cases, arms: ['A', 'B', 'C'], generate, judge })
    expect(run.generations).toHaveLength(2 * (1 + 3 + 3))
    expect(run.generations.every((item) => item.reply)).toBe(true)
    // 过滤之前的原话也存下来了（桩的原话就是「嗯，我在。」）
    expect(run.generations.every((item) => item.raw?.join('') === '嗯，我在。')).toBe(true)
    expect(run.judgements.every((item) => !item.error && !item.missing.length)).toBe(true)
    const markdown = renderMarkdown({
      meta: { mode: 'dry', startedAt: '-', finishedAt: '-', commit: '-', arms: ['A', 'B', 'C'], caseCount: 2, scenariosVersion: 1, scenariosStatus: 'draft', scenariosFrozenAt: null, rubricVersion: 1, rubricStatus: 'draft', generator: 'stub', judge: 'stub', calls: { generation: 0, judge: 0 }, promptChars: 0 },
      rubric, ...run,
    })
    expect(markdown).toContain('## 各组通过率')
  })
})

describe.runIf(MODE !== 'ci')('回复质量评测（dry / live）', () => {
  it('按冻结的数据集跑一遍并写出报告', async () => {
    const problems = [...validateRubric(rubric), ...validateScenarios(scenarios, rubric)]
    if (problems.length) throw new Error(`数据集有问题，先修好再跑：\n${problems.join('\n')}`)
    // 只重新打分：沿用某一轮存下的回复，换打分模型或改打分提示后，前后几轮才能用同一个评委比
    const source = process.env.EVAL_REJUDGE ? path.resolve(RESULTS_ROOT, process.env.EVAL_REJUDGE) : null
    const preset = source ? readJsonl(path.join(source, 'replies.jsonl')) : null
    const sourceMeta = source ? JSON.parse(readFileSync(path.join(source, 'run.json'), 'utf8')) : null
    const available = preset ? [...new Set(preset.map((item) => item.arm))].sort() : null
    // 只自检打分模型时不生成、不比较，只拿手写的正反例考它
    let arms = process.env.EVAL_VALIDATE_ONLY === '1' ? [] : parseArms(process.env.EVAL_ARMS)
    if (available) arms = process.env.EVAL_ARMS ? arms.filter((arm) => available.includes(arm)) : available
    const cases = selectCases().filter((scenario) => !preset || preset.some((item) => item.caseId === scenario.id))
    const startedAt = new Date()
    // 启动器会定好目录（EVAL_OUTPUT_DIR）；直接跑 vitest 时按时间起名
    const dir = process.env.EVAL_OUTPUT_DIR ?? path.join(RESULTS_ROOT, `${stampOf(startedAt)}-${MODE}${source ? '-rejudge' : ''}`)
    mkdirSync(dir, { recursive: true })
    h.requests.length = 0
    h.logs.length = 0
    // 真跑要几十分钟：进度写进 progress.log，可以随时看跑到哪了
    const run = await runEvaluation({
      rubric,
      cases,
      arms,
      generate,
      presetGenerations: preset ?? undefined,
      judge,
      onProgress: ({ stage, done }) => appendFileSync(path.join(dir, 'progress.log'), `${new Date().toISOString()} ${stage} ${done}\n`),
    })
    const genHost = hostOf(config.gen.baseUrl)
    const meta = {
      mode: MODE,
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      commit: gitCommit(),
      arms,
      caseCount: cases.length,
      scenariosVersion: scenarios.version,
      scenariosStatus: scenarios.status,
      scenariosFrozenAt: scenarios.frozenAt,
      rubricVersion: rubric.version,
      rubricStatus: rubric.status,
      generator: sourceMeta?.generator ?? `${genHost} · ${config.gen.model}`,
      rejudgeOf: source ? path.basename(source) : null,
      judge: `${hostOf(config.judge.baseUrl)} · ${config.judge.model}`,
      calls: { generation: h.requests.filter((request) => !request.judge).length, judge: h.requests.filter((request) => request.judge).length },
      promptChars: promptCharsOf(h.requests),
    }
    const record = { meta, rubric, ...run }
    writeJsonl(path.join(dir, 'replies.jsonl'), run.generations)
    writeJsonl(path.join(dir, 'judgements.jsonl'), [
      ...run.judgements.map((item) => ({ kind: 'rubric', ...item })),
      ...run.comparisons.map((item) => ({ kind: 'compare', ...item })),
      ...run.validation.pairwise.map((item) => ({ kind: 'validate-pair', ...item })),
      ...run.validation.rubric.map((item) => ({ kind: 'validate-rubric', ...item })),
    ])
    writeJsonl(path.join(dir, 'gateway-log.jsonl'), h.logs)
    writeFileSync(path.join(dir, 'run.json'), `${JSON.stringify({ ...meta, summary: summarize(record) }, null, 2)}\n`)
    writeFileSync(path.join(dir, 'report.md'), renderMarkdown(record))
    expect(arms.length ? run.generations.length : run.validation.pairwise.length).toBeGreaterThan(0)
    if (source) expect(meta.calls.generation).toBe(0)
  }, 4 * 60 * 60 * 1000)
})
