#!/usr/bin/env node
/**
 * 花草识别离线评测（见 docs/04-开发/花草识别评测.md）。
 *
 *   pnpm --filter cyber-sister-server eval:plants -- --photos D:\plant-photos           干跑：核对用例集和照片，说要调几次，不联网
 *   pnpm --filter cyber-sister-server eval:plants -- --photos D:\plant-photos --live    真实调用：要花钱，跑之前先问产品负责人
 *   pnpm --filter cyber-sister-server eval:plants -- --rescore <结果目录名>              用那一轮存下的回答，按现在的用例集重新打分，不联网
 *
 * 可选：--cases c0,h1（按 id 前缀挑）  --limit 5（只跑前几条，试跑用）  --persona gentle|toxic|cool（默认 gentle）
 * 照片目录也可以用环境变量 PLANT_EVAL_PHOTOS；必须在仓库外（照片是你和同学拍的，不进仓库）。
 * 模型：EVAL_PLANT_BASE_URL / EVAL_PLANT_MODEL / EVAL_PLANT_API_KEY_FILE；没配就用 apps/api/.env 里聊天那个槽
 * （GATEWAY_QWEN_BASE_URL / GATEWAY_QWEN_MODEL / GATEWAY_QWEN_API_KEY_FILE）。密钥只从文件读，不打印任何值。
 * 提示词、解析与兜底和页面上「认一认」是同一份（plant-id 版本号写进报告）。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderPlantReport, scoreCase, summarizePlantRun, validatePlantCases } from '../src/eval/plantIdEval.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const API_DIR = path.resolve(HERE, '..')
const REPO_DIR = path.resolve(API_DIR, '../..')
const RESULTS_ROOT = path.join(API_DIR, 'eval-results')
const SUITE_FILE = path.join(API_DIR, 'tests/plant-id/cases.json')
const TIMEOUT_MS = 45_000
const MAX_TOKENS = 900
const TEMPERATURE = 0.3

const args = process.argv.slice(2).filter((arg) => arg !== '--')
const optionOf = (name) => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}
const fail = (message) => {
  console.error(message)
  process.exit(1)
}

if (args.includes('--help')) {
  console.log('用法：eval-plants --photos <仓库外的照片目录> [--live] [--cases c0,h1] [--limit 5] [--persona gentle]\n      eval-plants --rescore <eval-results 下的目录名>')
  process.exit(0)
}

const suite = JSON.parse(readFileSync(SUITE_FILE, 'utf8'))
const problems = validatePlantCases(suite)
if (problems.length) fail(`用例集有问题：\n- ${problems.join('\n- ')}`)

const prefixes = (optionOf('--cases') ?? '').split(',').map((item) => item.trim()).filter(Boolean)
const limit = Number.parseInt(optionOf('--limit') ?? '', 10)
let cases = suite.cases.filter((testCase) => !prefixes.length || prefixes.some((prefix) => testCase.id.startsWith(prefix)))
if (Number.isFinite(limit) && limit > 0) cases = cases.slice(0, limit)

const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)
const readJsonl = (file) => readFileSync(file, 'utf8').split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line))
const saidOf = (records) => Object.fromEntries(records.map((record) => [record.id, record.identification?.isPlant === false
  ? '（不是植物）'
  : (record.identification?.candidates ?? []).map((candidate) => `${candidate.name}·${candidate.likelihood}`).join('、')]))

function writeReport(runDir, meta, records) {
  const byId = new Map(records.map((record) => [record.id, record]))
  const scored = cases.filter((testCase) => byId.has(testCase.id))
  const rows = scored.map((testCase) => scoreCase(testCase, byId.get(testCase.id).identification ?? null))
  const summary = summarizePlantRun(rows)
  const report = renderPlantReport({ ...meta, suiteVersion: suite.version, suiteStatus: suite.status, said: saidOf(records) }, rows, summary)
  writeFileSync(path.join(runDir, 'report.md'), report, 'utf8')
  writeFileSync(path.join(runDir, 'summary.json'), `${JSON.stringify({ ...meta, suiteVersion: suite.version, summary }, null, 2)}\n`, 'utf8')
  console.log(report)
  console.log(`[评测] 报告：${path.join(runDir, 'report.md')}`)
}

// ---- 重新打分：不联网 ----
const rescore = optionOf('--rescore')
if (rescore) {
  if (path.basename(rescore) !== rescore) fail('--rescore 只写 eval-results 下的目录名，不写路径')
  const from = path.join(RESULTS_ROOT, rescore, 'results.jsonl')
  if (!existsSync(from)) fail(`找不到 ${from}`)
  const records = readJsonl(from)
  const meta = JSON.parse(readFileSync(path.join(RESULTS_ROOT, rescore, 'run.json'), 'utf8'))
  const runDir = path.join(RESULTS_ROOT, `${stamp()}-plants-rescore`)
  mkdirSync(runDir, { recursive: true })
  writeFileSync(path.join(runDir, 'run.json'), `${JSON.stringify({ ...meta, run: path.basename(runDir), rescoreOf: rescore }, null, 2)}\n`, 'utf8')
  writeReport(runDir, { ...meta, run: `${path.basename(runDir)}（重打 ${rescore}）` }, records)
  process.exit(0)
}

// ---- 照片：必须在仓库外 ----
const photoDir = optionOf('--photos') ?? process.env.PLANT_EVAL_PHOTOS
if (!photoDir) fail('要给照片目录：--photos <目录> 或环境变量 PLANT_EVAL_PHOTOS（放在仓库外）')
const photos = path.resolve(photoDir)
const inside = path.relative(REPO_DIR, photos)
if (!inside.startsWith('..') && !path.isAbsolute(inside)) fail('照片目录在仓库里：照片是你和同学拍的，请放到仓库外面')
if (!existsSync(photos) || !statSync(photos).isDirectory()) fail(`照片目录不存在：${photos}`)

const require = createRequire(path.join(API_DIR, 'package.json'))
const { MAX_PHOTO_BYTES } = await import('../src/utils/photoStore.js')
const present = new Set(readdirSync(photos))
const ready = []
const missing = []
const unusable = []
for (const testCase of cases) {
  if (!present.has(testCase.file)) { missing.push(testCase.file); continue }
  const file = path.join(photos, testCase.file)
  if (!/\.jpe?g$/i.test(testCase.file) || statSync(file).size > MAX_PHOTO_BYTES) { unusable.push(testCase.file); continue }
  ready.push({ testCase, file })
}
console.log(`[评测] 用例 ${cases.length} 条（用例集 ${suite.version}，${suite.status}）；照片齐的 ${ready.length} 条`)
if (missing.length) console.log(`[评测] 缺照片 ${missing.length} 张：${missing.join('、')}`)
if (unusable.length) console.log(`[评测] 用不了 ${unusable.length} 张（要 3MB 以内的 JPEG，手机上导出成长边约 1600 像素）：${unusable.join('、')}`)

if (!args.includes('--live')) {
  console.log(`[评测] 干跑：没有联网。加 --live 会真调 ${ready.length} 次视觉模型（要花钱，跑之前先问产品负责人）`)
  process.exit(0)
}
if (!ready.length) fail('一张能用的照片都没有，没什么可跑的')

// ---- 真实调用：和页面上「认一认」同一份提示词、同一套解析与兜底 ----
const fileEnv = existsSync(path.join(API_DIR, '.env')) ? require('dotenv').parse(readFileSync(path.join(API_DIR, '.env'))) : {}
const setting = (name) => process.env[name] ?? fileEnv[name]
const baseUrl = setting('EVAL_PLANT_BASE_URL') ?? setting('GATEWAY_QWEN_BASE_URL')
const model = setting('EVAL_PLANT_MODEL') ?? setting('GATEWAY_QWEN_MODEL')
const keyFile = setting('EVAL_PLANT_API_KEY_FILE') ?? setting('GATEWAY_QWEN_API_KEY_FILE')
if (!baseUrl || !model || !keyFile) fail('没配模型：EVAL_PLANT_BASE_URL / EVAL_PLANT_MODEL / EVAL_PLANT_API_KEY_FILE，或 apps/api/.env 里的 GATEWAY_QWEN_*')
if (!existsSync(path.resolve(API_DIR, keyFile))) fail('密钥文件不存在（路径见 EVAL_PLANT_API_KEY_FILE 或 GATEWAY_QWEN_API_KEY_FILE）')
const apiKey = readFileSync(path.resolve(API_DIR, keyFile), 'utf8').trim()

const { createGateway } = await import('@cyber-sister/llm-gateway')
const { IDENTIFY_ASK, PLANT_ID_PROMPT, PLANT_ID_PROMPT_VERSION } = await import('../src/services/plantIdentification.js')
const { imagePart } = await import('../src/services/llmService.js')
const { readIdentification } = await import('../src/services/plantIdService.js')
const { stripJpegMetadata } = await import('../src/utils/jpegMetadata.js')

const gateway = await createGateway({
  GATEWAY_PROVIDERS: 'evalplant',
  GATEWAY_EVALPLANT_BASE_URL: baseUrl,
  GATEWAY_EVALPLANT_MODEL: model,
  GATEWAY_EVALPLANT_API_KEY: apiKey,
  GATEWAY_EVALPLANT_SCOPE: 'external',
  GATEWAY_EVALPLANT_SCENES: 'chat',
  GATEWAY_EVALPLANT_PRIORITY: '1',
})
const persona = optionOf('--persona') ?? 'gentle'
const runDir = path.join(RESULTS_ROOT, `${stamp()}-plants-live`)
mkdirSync(runDir, { recursive: true })
const meta = { run: path.basename(runDir), arm: 'cloud', model, promptVersion: PLANT_ID_PROMPT_VERSION, persona, startedAt: new Date().toISOString() }
writeFileSync(path.join(runDir, 'run.json'), `${JSON.stringify(meta, null, 2)}\n`, 'utf8')

const records = []
for (const [index, { testCase, file }] of ready.entries()) {
  const startedAt = Date.now()
  const record = { id: testCase.id, file: testCase.file, arm: 'cloud' }
  try {
    const image = { mime: 'image/jpeg', buffer: stripJpegMetadata(readFileSync(file)) }
    // 一张一张来：失败不重发，费用看得清
    // eslint-disable-next-line no-await-in-loop
    const result = await gateway.complete({
      scene: 'chat',
      persona,
      requestId: `eval-plant-${testCase.id}`,
      systemAppend: [{ role: 'system', content: PLANT_ID_PROMPT }],
      messages: [{ role: 'user', content: [{ type: 'text', text: IDENTIFY_ASK }, imagePart(image)] }],
      allowExternal: true,
      authorizeExternal: () => true,
      timeoutMs: TIMEOUT_MS,
      maxTokens: MAX_TOKENS,
      temperature: TEMPERATURE,
    })
    record.content = result?.content ?? null
    record.identification = result?.content ? readIdentification(result.content, result.model) : null
    if (!result?.content) record.error = 'no_response'
    else if (!record.identification) record.error = 'unreadable'
  } catch (error) {
    record.error = error?.message ?? 'error'
  }
  record.latencyMs = Date.now() - startedAt
  records.push(record)
  writeFileSync(path.join(runDir, 'results.jsonl'), `${records.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8')
  console.log(`[评测] ${index + 1}/${ready.length} ${testCase.id} ${record.error ? `✗ ${record.error}` : '✓'}（${record.latencyMs}ms）`)
}
writeReport(runDir, meta, records)
