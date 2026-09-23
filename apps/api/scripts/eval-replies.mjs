#!/usr/bin/env node
/**
 * 回复质量评测启动器（见 docs/04-开发/回复质量评测.md）。
 *
 *   pnpm --filter cyber-sister-server eval:replies                  桩模式（默认）：不联网，列出要发多少次请求、提示词多少字
 *   pnpm --filter cyber-sister-server eval:replies -- --live        真实调用：要花钱，跑之前先问产品负责人
 *
 * 可选：--arms A,B,C（默认；另有 D 只留共用前言、E 只留书籍技能）
 *       --cases e01,b0（按场景 id 前缀挑）  --limit 5（只跑前几个，试跑用）
 * 真实调用要的环境变量：EVAL_GEN_BASE_URL / EVAL_GEN_MODEL / EVAL_GEN_API_KEY_FILE，
 * EVAL_JUDGE_BASE_URL / EVAL_JUDGE_MODEL / EVAL_JUDGE_API_KEY_FILE（密钥只从文件读）。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2).filter((arg) => arg !== '--')
const optionOf = (name) => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

if (args.includes('--help')) {
  console.log('用法：eval-replies [--live] [--validate-only] [--rejudge <结果目录名>] [--arms A,B,C] [--cases e01,b0] [--limit 5]')
  process.exit(0)
}

const env = { ...process.env, EVAL_MODE: args.includes('--live') ? 'live' : 'dry' }
// 只用手写的正反例自检打分模型，不生成、不比较各组：挑打分模型时用，花费最小
if (args.includes('--validate-only')) env.EVAL_VALIDATE_ONLY = '1'
// --rejudge <结果目录名>：沿用那一轮存下的回复，只重新打分（换打分模型或改打分提示后，前后几轮才能用同一个评委比）
for (const [flag, name] of [['--arms', 'EVAL_ARMS'], ['--cases', 'EVAL_CASES'], ['--limit', 'EVAL_LIMIT'], ['--rejudge', 'EVAL_REJUDGE']]) {
  const value = optionOf(flag)
  if (value) env[name] = value
}

const require = createRequire(import.meta.url)
const vitest = path.join(path.dirname(require.resolve('vitest/package.json')), 'vitest.mjs')
const apiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// 这一轮的结果目录由这里定好交给装置：同时跑两轮时，汇总也不会读错目录
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)
const suffix = `${env.EVAL_MODE}${env.EVAL_REJUDGE ? '-rejudge' : ''}${env.EVAL_VALIDATE_ONLY ? '-validate' : ''}`
env.EVAL_OUTPUT_DIR = path.join(apiDir, 'eval-results', `${stamp}-${suffix}`)
const result = spawnSync(process.execPath, [vitest, 'run', 'tests/reply-eval/replyEval.test.js'], { cwd: apiDir, env, stdio: 'inherit' })

// vitest 会吞掉通过用例的输出：这里自己读这次的 run.json，把结论打出来
const latest = existsSync(env.EVAL_OUTPUT_DIR) ? env.EVAL_OUTPUT_DIR : null
if (latest) {
  try {
    const meta = JSON.parse(readFileSync(path.join(latest, 'run.json'), 'utf8'))
    console.log([
      '',
      `[评测] ${meta.mode === 'live' ? '真实调用' : '桩模式（没有联网，数字不代表模型表现）'}：${meta.caseCount} 个场景，${meta.arms.length ? `分组 ${meta.arms.join('、')}` : '只自检打分模型'}${meta.rejudgeOf ? `（沿用 ${meta.rejudgeOf} 的回复，只重新打分）` : ''}`,
      `[评测] 生成 ${meta.calls.generation} 次，打分 ${meta.calls.judge} 次，发出的提示词共 ${meta.promptChars} 字`,
      `[评测] 报告：${path.join(latest, 'report.md')}`,
    ].join('\n'))
  } catch {
    console.log(`[评测] 没有跑完，进度见 ${path.join(latest, 'progress.log')}`)
  }
}
process.exit(result.status ?? 1)
