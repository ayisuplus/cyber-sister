#!/usr/bin/env node
/**
 * 录音评测第二步（见 docs/04-开发/语音输入评测.md）：
 *
 *   pnpm --filter cyber-sister-server eval:asr -- --run asr-20260923-203000
 *
 * 读第一步（tools/asr-server/transcribe_batch.py）写的 eval-results/<目录>/transcripts.jsonl 与口语检验集，
 * 在同一目录写 report.md。不联网、不花钱，只读文字，从不碰录音。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderReport } from '../tests/spoken-input/asrMetrics.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const RESULTS_ROOT = path.resolve(HERE, '../eval-results')
const args = process.argv.slice(2).filter((arg) => arg !== '--')
const runIndex = args.indexOf('--run')
const run = runIndex >= 0 ? args[runIndex + 1] : undefined

if (!run || args.includes('--help')) {
  console.log('用法：eval-asr --run <eval-results 下的目录名，例如 asr-20260923-203000>')
  process.exit(run ? 0 : 1)
}
if (path.basename(run) !== run) {
  console.error('--run 只写 eval-results 下的目录名，不写路径')
  process.exit(1)
}

const runDir = path.join(RESULTS_ROOT, run)
const transcriptsFile = path.join(runDir, 'transcripts.jsonl')
if (!existsSync(transcriptsFile)) {
  console.error(`找不到 ${transcriptsFile}：先用 tools/asr-server/transcribe_batch.py 转写一批录音`)
  process.exit(1)
}

const rows = readFileSync(transcriptsFile, 'utf8').split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line))
const suite = JSON.parse(readFileSync(path.resolve(HERE, '../tests/spoken-input/spoken.cases.json'), 'utf8'))
const report = renderReport(run, rows, suite)
writeFileSync(path.join(runDir, 'report.md'), report, 'utf8')
console.log(report)
console.log(`已写入 ${path.join(runDir, 'report.md')}`)
