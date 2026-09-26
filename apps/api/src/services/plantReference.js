/**
 * 花草图鉴的「名录与毒性」（路线图 C27）：模型给出候选之后，拿本机的两份资料核一遍——
 * - 名录：《中国生物物种名录》植物界（Catalogue of Life China · China Checklist of Higher Plants），
 *   用学名（含异名）或中文名找到这一种，给出名录里的标准中文名、接受学名、科和审核信息；
 * - 毒性：《中国植物志》经济用途「中国有毒植物」，有记载就一定提醒，只取有没有毒、哪儿有毒，从不给药用说法。
 *
 * 资料只放本机（plant-data/，不进仓库：来源条款不许再分发），由 scripts/build-plant-reference.mjs 建成一个 JSON。
 * 没有这个文件就什么都不核，页面照旧只有模型的说法；只有其中一份时，另一份照样核。
 */
import { readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import logger from '../utils/logger.js'

export const REFERENCE_VERSION = 1
const DEFAULT_FILE = fileURLToPath(new URL('../../../../plant-data/plant-reference.json', import.meta.url))

export const referenceFileOf = (env = process.env) => env.PLANT_REFERENCE_FILE || DEFAULT_FILE

const normalizeName = (value) => String(value ?? '').normalize('NFKC').replace(/\s+/g, '').toLowerCase()
/** 学名只取属 + 种（去掉命名人、变种、杂交符号），小写；只有属名的返回属名。 */
export function scientificKey(value) {
  const words = String(value ?? '').normalize('NFKC').replace(/[×✕]/g, ' ').trim().split(/\s+/).filter(Boolean)
  if (!words.length || !/^[A-Za-z]/.test(words[0])) return null
  const genus = words[0].toLowerCase()
  const species = words[1] && /^[a-z-]+$/.test(words[1]) ? words[1] : null
  return species ? `${genus} ${species}` : genus
}
const genusOf = (key) => (key ? key.split(' ')[0] : null)

// ---- 《中国植物志》功用摘录里的毒性：只认「有毒 / 剧毒 / 小毒」和哪个部位 ----

const LEVELS = [[/剧毒|大毒|巨毒/, '剧毒'], [/小毒|微毒/, '小毒'], [/有毒|毒性|含毒|中毒/, '有毒']]
const PART_WORDS = '全株|全草|植株|种子|果实|花果|果|块根|根茎|根|鳞茎|茎叶|茎|嫩叶|幼叶|叶|花粉|花|树皮|乳汁|汁液|芽'
const PART_TOXIC = new RegExp(`(${PART_WORDS})[^，。；、,;]{0,6}?(?:有(?:剧|大|巨|小|微)?毒|含毒)`, 'g')
const PART_NAMES = { 植株: '全株', 果: '果实', 幼叶: '嫩叶', 花果: '花和果实' }

/** 从功用摘录里取毒性：{ level: 剧毒|有毒|小毒|null, parts: [...] }。列进有毒植物但摘录里没写清的，level 为 null。 */
export function parseToxicText(text) {
  const clean = String(text ?? '')
  const level = LEVELS.find(([pattern]) => pattern.test(clean))?.[1] ?? null
  const parts = [...new Set([...clean.matchAll(PART_TOXIC)].map((match) => PART_NAMES[match[1]] ?? match[1]))]
  return { level, parts }
}

// ---- 索引：名录的一种一条，另有异名表；毒性按这一种、按学名、按属、按中文名各挂一份 ----

const RANK = /^(var|subsp|ssp|f|forma)\.?$/i
const RANK_NAMES = { ssp: 'subsp', forma: 'f' }
const EPITHET = /^[a-z-]+$/

/** 完整学名：属 + 种加词，有种下等级再加「var. xxx」这样一段；去掉命名人、杂交符号，小写。用来对上名录里的那一行。 */
export function fullNameKey(value) {
  const words = String(value ?? '').normalize('NFKC').replace(/[×✕]/g, ' ').trim().split(/\s+/).filter(Boolean)
  const species = scientificKey(value)
  if (!species?.includes(' ')) return species
  const rankAt = words.findIndex((word, position) => position >= 2 && RANK.test(word))
  const epithet = rankAt > 0 ? words[rankAt + 1] : null
  if (!epithet || !EPITHET.test(epithet)) return species
  const rank = words[rankAt].toLowerCase().replace(/\.$/, '')
  return `${species} ${RANK_NAMES[rank] ?? rank} ${epithet}`
}

/**
 * 名录：完整学名 → 第几种；属 + 种 → 同一种下的几条（种本身排第一，其后是变种、亚种）；
 * 异名 → 第几种；中文名与别名 → 第几种（可能不止一种）
 */
function indexTaxa(taxa, synonyms) {
  const byFull = new Map()
  const bySci = new Map()
  const byCn = new Map()
  const addCn = (name, index) => {
    const key = normalizeName(name)
    if (key) byCn.set(key, [...new Set([...(byCn.get(key) ?? []), index])])
  }
  taxa.forEach((taxon, index) => {
    const full = fullNameKey(taxon.sci)
    const key = scientificKey(taxon.sci)
    if (full && !byFull.has(full)) byFull.set(full, index)
    if (key) bySci.set(key, [...(bySci.get(key) ?? []), index])
    for (const name of [taxon.cn, ...(taxon.aliases ?? [])]) addCn(name, index)
  })
  for (const [key, group] of bySci) {
    bySci.set(key, [...group].sort((a, b) => Number(fullNameKey(taxa[b].sci) === key) - Number(fullNameKey(taxa[a].sci) === key)))
  }
  const bySyn = new Map(Object.entries(synonyms).filter(([, index]) => taxa[index]))
  return { byFull, bySci, bySyn, byCn }
}

/** 毒性：对上名录的按那一种挂；另按学名（到种）、按属、按中文名各挂一份 */
function indexToxic(entries, taxa) {
  const toxicByTaxon = new Map()
  const toxicBySci = new Map()
  const toxicByGenus = new Map()
  const toxicByCn = new Map()
  for (const entry of entries) {
    const key = scientificKey(entry.sci)
    const species = Boolean(key?.includes(' '))
    if (Number.isInteger(entry.taxon) && taxa[entry.taxon]) toxicByTaxon.set(entry.taxon, entry)
    if (species) toxicBySci.set(key, entry)
    else if (key) toxicByGenus.set(key, entry)
    if (entry.cn && species) toxicByCn.set(normalizeName(entry.cn), entry)
  }
  return { toxicByTaxon, toxicBySci, toxicByGenus, toxicByCn }
}

/** 把建好的 JSON 变成查找表。 */
export function indexReference(data) {
  const taxa = Array.isArray(data?.taxa) ? data.taxa : []
  const toxic = indexToxic(Array.isArray(data?.toxic) ? data.toxic : [], taxa)
  return {
    taxa,
    ...indexTaxa(taxa, data?.synonyms ?? {}),
    ...toxic,
    hasChecklist: taxa.length > 0,
    hasToxic: toxic.toxicBySci.size + toxic.toxicByGenus.size + toxic.toxicByTaxon.size > 0,
    sources: data?.sources ?? {},
  }
}

const namesOf = (taxon) => [taxon.cn, ...(taxon.aliases ?? [])].map(normalizeName).filter(Boolean)

/**
 * 一个候选在名录里是哪一种：
 * 完整学名（含变种）对得上就是那一行；只对上属 + 种时，同一种下有和她说的中文名一样的变种就取它（她说「水仙」，
 * 学名写 Narcissus tazetta，取变种「水仙」而不是种「欧洲水仙」），否则取种本身；再看异名；最后按中文名（只认唯一的一种）。
 */
export function lookupTaxon(index, candidate) {
  if (!index?.hasChecklist || !candidate) return null
  const full = fullNameKey(candidate.scientificName)
  if (full?.split(' ').length > 2 && index.byFull.has(full)) return { taxonIndex: index.byFull.get(full), via: 'scientific' }
  const key = scientificKey(candidate.scientificName)
  const group = key ? index.bySci.get(key) : null
  if (group?.length) {
    const name = normalizeName(candidate.name)
    const same = group.find((position) => namesOf(index.taxa[position]).includes(name))
    return { taxonIndex: same ?? group[0], via: 'scientific' }
  }
  if (key && index.bySyn.has(key)) return { taxonIndex: index.bySyn.get(key), via: 'synonym' }
  const matches = index.byCn.get(normalizeName(candidate.name)) ?? []
  return matches.length === 1 ? { taxonIndex: matches[0], via: 'chinese' } : null
}

function toxicFor(index, candidate, found) {
  const taxon = found ? index.taxa[found.taxonIndex] : null
  const key = scientificKey(taxon?.sci) ?? scientificKey(candidate.scientificName)
  if (found && index.toxicByTaxon.has(found.taxonIndex)) return { entry: index.toxicByTaxon.get(found.taxonIndex), by: 'species' }
  if (key && index.toxicBySci.has(key)) return { entry: index.toxicBySci.get(key), by: 'species' }
  if (key && index.toxicByGenus.has(genusOf(key))) return { entry: index.toxicByGenus.get(genusOf(key)), by: 'genus' }
  // 名录里的叫法和她说的叫法都试一下：宁可多提醒一句（她说「海芋」、学名写成了另一种海芋，也照样提醒）
  const byName = [taxon?.cn, candidate.name].map((name) => index.toxicByCn.get(normalizeName(name))).find(Boolean)
  return byName ? { entry: byName, by: 'species' } : null
}

/**
 * 给识别结果挂上 reference（不改模型的候选与讲解）：
 * { checked, toxicChecked, candidates: [{ found, standardName?, scientificName?, family?, scrutiny?, via? }], toxic: [...], sources }
 * 不是植物的原样返回；没有资料时 checked 与 toxicChecked 都是 false。
 */
export function groundIdentification(identification, index) {
  if (!identification?.isPlant) return identification
  if (!index) return { ...identification, reference: { checked: false, toxicChecked: false, candidates: [], toxic: [], sources: {} } }
  const founds = identification.candidates.map((candidate) => lookupTaxon(index, candidate))
  const candidates = founds.map((found) => {
    if (!found) return { found: false }
    const taxon = index.taxa[found.taxonIndex]
    return { found: true, standardName: taxon.cn ?? null, scientificName: taxon.sci ?? null, family: taxon.family ?? null, scrutiny: taxon.scrutiny ?? null, via: found.via }
  })
  const seen = new Set()
  const toxic = []
  identification.candidates.forEach((candidate, position) => {
    if (!index.hasToxic) return
    const hit = toxicFor(index, candidate, founds[position])
    if (!hit || seen.has(hit.entry)) return
    seen.add(hit.entry)
    toxic.push({
      candidate: position,
      name: candidates[position].standardName ?? candidate.name,
      recordedAs: hit.entry.cn ?? hit.entry.sci,
      level: hit.entry.level ?? null,
      parts: Array.isArray(hit.entry.parts) ? hit.entry.parts : [],
      by: hit.by,
    })
  })
  return {
    ...identification,
    reference: { checked: index.hasChecklist, toxicChecked: index.hasToxic, candidates, toxic, sources: index.sources },
  }
}

let cache = null

/** 读本机建好的名录索引（按文件修改时间缓存）；没有文件返回 null，文件坏了记一笔也返回 null。 */
export function loadPlantReference(env = process.env) {
  const file = referenceFileOf(env)
  let mtimeMs
  try {
    mtimeMs = statSync(file).mtimeMs
  } catch {
    cache = null
    return null
  }
  if (cache?.file === file && cache.mtimeMs === mtimeMs) return cache.index
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'))
    if (data?.version !== REFERENCE_VERSION) throw new Error(`版本 ${data?.version} 不是 ${REFERENCE_VERSION}，重建一次`)
    cache = { file, mtimeMs, index: indexReference(data) }
    return cache.index
  } catch (error) {
    logger.warn('花草名录索引读不出来，这次不核', { error: error.message })
    cache = null
    return null
  }
}

export function resetPlantReference() {
  cache = null
}
