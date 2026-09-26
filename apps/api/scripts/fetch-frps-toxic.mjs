#!/usr/bin/env node
/**
 * 抓《中国植物志》的「中国有毒植物」列表（iPlant 植物智，据《中国植物志》全书记载分析而得），见 docs/04-开发/花草识别评测.md。
 *
 *   pnpm --filter cyber-sister-server plants:fetch-toxic
 *
 * 写到仓库根目录的 plant-data/frps-toxic.json（整个目录不进仓库）：© 中国科学院植物研究所，只供本机的课程作业与论文原型使用。
 * 一页一页慢慢抓（每页之间停 3 秒），robots.txt 没有禁止这一路径。原文「功用」里夹着药用说法：原样存在本机，
 * 构建名录索引时只取「有没有毒、哪儿有毒」，药用那部分从不交给页面或模型。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUT_DIR = path.resolve(HERE, '../../../plant-data')
const BASE = 'https://www.iplant.cn/frps/jingji/3'
const PAUSE_MS = 3000
const MAX_PAGES = 60

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const cellText = (html) => html.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()

/** 一页里的条目：中文名、拉丁名、功用（列表页上的摘录，长的以「...」截断）。 */
export function parseToxicPage(html) {
  const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((match) => [...match[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((cell) => cellText(cell[1])))
  return rows
    .filter((cells) => cells.length >= 3 && cells[1] && cells[1] !== '拉丁名')
    .map(([name, scientificName, text]) => ({ name: name || null, scientificName, text }))
}

/** 分页条上最大的页码 */
export const lastPageOf = (html) => Math.max(1, ...[...html.matchAll(/[?&]page=(\d+)/g)].map((match) => Number(match[1])))

async function fetchPage(page) {
  const response = await fetch(`${BASE}?page=${page}`, { headers: { 'user-agent': 'Amie-course-project/1.0 (plant field guide research; slow crawl)' }, signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error(`第 ${page} 页：HTTP ${response.status}`)
  return response.text()
}

async function main() {
  const entries = []
  let last = 1
  for (let page = 1; page <= Math.min(last, MAX_PAGES); page += 1) {
    // 一页一页来，不并发
    // eslint-disable-next-line no-await-in-loop
    const html = await fetchPage(page)
    const rows = parseToxicPage(html)
    last = Math.max(last, lastPageOf(html))
    entries.push(...rows)
    console.log(`[有毒植物] 第 ${page}/${last} 页：${rows.length} 条`)
    if (!rows.length) break
    // eslint-disable-next-line no-await-in-loop
    if (page < last) await sleep(PAUSE_MS)
  }
  mkdirSync(OUT_DIR, { recursive: true })
  const out = path.join(OUT_DIR, 'frps-toxic.json')
  writeFileSync(out, `${JSON.stringify({
    source: '《中国植物志》经济用途·中国有毒植物（据《中国植物志》全书记载分析而得），iPlant 植物智',
    url: BASE,
    rights: '© 中国科学院植物研究所。只供本机课程作业与论文原型使用，不再分发',
    fetchedAt: new Date().toISOString(),
    entries,
  }, null, 2)}\n`, 'utf8')
  console.log(`[有毒植物] 共 ${entries.length} 条，写到 ${out}`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`[有毒植物] 没抓完：${error.message}`)
    process.exit(1)
  })
}
