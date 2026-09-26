#!/usr/bin/env node
/**
 * 建花草图鉴的本机名录与毒性索引（路线图 C27，见 docs/04-开发/花草识别评测.md「名录与毒性」）。
 *
 *   pnpm --filter cyber-sister-server plants:reference
 *
 * 读仓库根目录 plant-data/ 里的两份资料（都不进仓库），写 plant-data/plant-reference.json：
 * - 名录：从物种2000中国节点下载的《中国生物物种名录》植物界 .xlsx（要自己在 http://www.sp2000.org.cn/download 填表下载），
 *   也可以用 --checklist <文件> 指定；
 * - 毒性：plants:fetch-toxic 抓下来的 frps-toxic.json。
 * 两份缺哪份就只建另一份；都没有就不建。最后列出评测集里每种花草核得到核不到、有没有毒性记载。
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readXlsxRows } from '../src/utils/xlsx.js'
import { indexReference, lookupTaxon, parseToxicText, REFERENCE_VERSION } from '../src/services/plantReference.js'
import { mapChecklist } from '../src/services/plantChecklist.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.resolve(HERE, '../../../plant-data')
const OUT = path.join(DATA_DIR, 'plant-reference.json')
const args = process.argv.slice(2).filter((arg) => arg !== '--')
const optionOf = (name) => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

function findChecklist() {
  const given = optionOf('--checklist')
  if (given) return path.resolve(given)
  if (!existsSync(DATA_DIR)) return null
  const files = readdirSync(DATA_DIR).filter((name) => /植物界.*\.xlsx$/i.test(name)).sort()
  return files.length ? path.join(DATA_DIR, files.at(-1)) : null
}

function build() {
  const sources = {}
  let taxa = []
  let synonyms = {}
  const checklistFile = findChecklist()
  if (checklistFile) {
    const rows = readXlsxRows(readFileSync(checklistFile))
    const mapped = mapChecklist(rows)
    taxa = mapped.taxa
    synonyms = mapped.synonyms
    sources.checklist = {
      title: 'Catalogue of Life China: Annual Checklist（中国生物物种名录）',
      database: 'China Checklist of Higher Plants',
      node: 'Species 2000 China Node',
      file: path.basename(checklistFile),
    }
    console.log(`[名录] ${path.basename(checklistFile)}：${taxa.length} 种，异名 ${Object.keys(synonyms).length} 个（表头：${mapped.headers.join('、')}）`)
  } else {
    console.log('[名录] plant-data/ 里没有「植物界…xlsx」：这次只建毒性。名录要自己到 http://www.sp2000.org.cn/download 填表下载')
  }

  // 毒性条目对到名录里的哪一种：和聊天时核候选用同一套办法（完整学名、同一种下按中文名挑变种、异名、唯一的中文名）
  const checklist = indexReference({ taxa, synonyms })

  let toxic = []
  const toxicFile = path.join(DATA_DIR, 'frps-toxic.json')
  if (existsSync(toxicFile)) {
    const raw = JSON.parse(readFileSync(toxicFile, 'utf8'))
    let matched = 0
    toxic = raw.entries.map((entry) => {
      // 只有属名的条目（乌头属）按属挂，不对到某一种
      const genusOnly = !String(entry.scientificName ?? '').trim().includes(' ')
      const taxon = genusOnly ? null : (lookupTaxon(checklist, { name: entry.name, scientificName: entry.scientificName })?.taxonIndex ?? null)
      if (taxon !== null) matched += 1
      // 只存有没有毒、哪儿有毒；功用原文（夹着药用说法）不进索引
      return { ...(Number.isInteger(taxon) ? { taxon } : {}), cn: entry.name || null, sci: entry.scientificName, ...parseToxicText(entry.text) }
    })
    sources.toxic = { title: '《中国植物志》经济用途 · 中国有毒植物', via: 'iPlant 植物智（中国科学院植物研究所）', fetchedAt: raw.fetchedAt }
    console.log(`[毒性] ${toxic.length} 条，其中 ${matched} 条对上了名录里的一种${taxa.length ? '' : '（没有名录，按学名、属和中文名直接认）'}`)
  } else {
    console.log('[毒性] 没有 plant-data/frps-toxic.json：先跑 plants:fetch-toxic')
  }

  if (!taxa.length && !toxic.length) {
    console.error('两份资料都没有，没什么可建的')
    process.exit(1)
  }
  writeFileSync(OUT, JSON.stringify({ version: REFERENCE_VERSION, builtAt: new Date().toISOString(), sources, taxa, synonyms, toxic }), 'utf8')
  console.log(`[索引] 写到 ${OUT}`)
}

/** 评测集里每种花草：名录里核得到吗、有没有毒性记载（和用例标的毒性对照着看） */
async function coverage() {
  const { groundIdentification, indexReference } = await import('../src/services/plantReference.js')
  const index = indexReference(JSON.parse(readFileSync(OUT, 'utf8')))
  const suite = JSON.parse(readFileSync(path.resolve(HERE, '../tests/plant-id/cases.json'), 'utf8'))
  console.log('\n| 用例 | 名录 | 毒性记载 | 用例标的毒性 |\n|---|---|---|---|')
  for (const testCase of suite.cases.filter((item) => item.expect.names)) {
    const scientific = [testCase.expect.scientific].flat()[0]
    const grounded = groundIdentification({ isPlant: true, candidates: [{ name: testCase.expect.names[0], scientificName: testCase.expect.genusOk ? null : scientific }] }, index)
    const found = grounded.reference.candidates[0]
    const toxic = grounded.reference.toxic[0]
    console.log(`| ${testCase.id} | ${found?.found ? `${found.standardName}（${found.via === 'scientific' ? '学名' : '中文名'}）` : '—'} | ${toxic ? `${toxic.recordedAs}${toxic.level ? ` · ${toxic.level}` : ''}` : '—'} | ${testCase.expect.toxic ?? '不计'} |`)
  }
}

build()
await coverage()
