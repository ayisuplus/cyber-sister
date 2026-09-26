/**
 * 把《中国生物物种名录》植物界的表格行变成名录索引要的样子（路线图 C27）：接受名一种一条，异名指向它。
 * 列按表头认（名录各年的表头写法不完全一样），认不出学名或中文名那一列就把看到的表头报出来，不瞎猜。
 * 两种排法都认：一行一种、「异名」一列里列着好几个；或者接受名与异名各占一行，用「名称状态」「接受名」两列连起来。
 */
import { scientificKey } from './plantReference.js'

const COLUMNS = {
  cn: ['中文名', '物种中文名', '种中文名', '中文名称', 'chinese name', 'chinesename', 'chinese_name'],
  sci: ['学名', '物种学名', '完整学名', '接受名学名', 'scientific name', 'scientificname', 'scientific_name', '拉丁名'],
  genus: ['属名', '属拉丁名', 'genus'],
  species: ['种加词', '种名', 'species', 'specific epithet'],
  infraRank: ['种下等级', 'infraspecific rank', 'rank'],
  infra: ['种下加词', 'infraspecies', 'infraspecific epithet'],
  status: ['名称状态', '状态', '名称类型', 'name status', 'status', 'namestatus'],
  accepted: ['接受名', '对应接受名', 'accepted name', 'acceptedname', 'accepted_name'],
  synonyms: ['异名', '同物异名', 'synonyms', 'synonym'],
  family: ['科中文名', '科名', '科', 'family chinese name', 'family'],
  familyLatin: ['科拉丁名', '科学名', 'family name', 'family latin name'],
  aliases: ['别名', '中文别名', '俗名', 'common names', 'common name', 'commonnames'],
  scrutiny: ['审核专家', '审核人', '专家', 'taxonomic scrutiny', 'scrutiny', 'specialist'],
  scrutinyDate: ['审核日期', '审核时间', 'scrutiny date'],
}

const headerKey = (text) => String(text ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase()
const splitList = (text) => String(text ?? '').split(/[;；,，、|/]+/).map((item) => item.trim()).filter(Boolean)
const isSynonymStatus = (text) => /异名|synonym/i.test(String(text ?? ''))

/** 在前几行里找表头：认出学名或中文名那一列的第一行。 */
function findHeader(rows) {
  for (let row = 0; row < Math.min(rows.length, 10); row += 1) {
    const keys = rows[row].map(headerKey)
    const columns = Object.fromEntries(Object.entries(COLUMNS).map(([field, names]) => [field, keys.findIndex((key) => names.includes(key))]))
    const hasSci = columns.sci >= 0 || (columns.genus >= 0 && columns.species >= 0)
    if (hasSci && columns.cn >= 0) return { row, columns }
  }
  const seen = (rows.slice(0, 3).map((row) => row.filter(Boolean).join('、')).join(' / ')) || '（空表）'
  throw new Error(`认不出学名或中文名那一列。前几行是：${seen}。把表头告诉维护者，在 plantChecklist.js 的 COLUMNS 里加上`)
}

/**
 * @param {string[][]} rows 表格的行（第一张工作表）
 * @returns {{ taxa: Array<{ cn: string|null, sci: string, family: string|null, aliases: string[], scrutiny: string|null }>, synonyms: Record<string, number>, headers: string[] }}
 */
export function mapChecklist(rows) {
  const { row: headerRow, columns } = findHeader(rows)
  const cell = (row, field) => (columns[field] >= 0 ? String(row[columns[field]] ?? '').trim() : '')
  const sciOf = (row) => cell(row, 'sci') || [cell(row, 'genus'), cell(row, 'species'), cell(row, 'infraRank'), cell(row, 'infra')].filter(Boolean).join(' ')
  // 一行接受名：名录里的一种；它那格「异名」里列的也记下来
  const acceptedOf = (row, sci, key) => ({
    taxon: {
      cn: cell(row, 'cn') || null,
      sci,
      family: cell(row, 'family') || cell(row, 'familyLatin') || null,
      aliases: splitList(cell(row, 'aliases')),
      scrutiny: [cell(row, 'scrutiny'), cell(row, 'scrutinyDate')].filter(Boolean).join(' ') || null,
    },
    synonyms: splitList(cell(row, 'synonyms')).map((synonym) => ({ key: scientificKey(synonym), accepted: key })),
  })

  const taxa = []
  const byKey = new Map()
  const pendingSynonyms = []
  for (const row of rows.slice(headerRow + 1)) {
    const sci = sciOf(row)
    const key = scientificKey(sci)
    if (!key?.includes(' ')) continue
    if (columns.status >= 0 && isSynonymStatus(cell(row, 'status'))) {
      pendingSynonyms.push({ key, accepted: scientificKey(cell(row, 'accepted')) })
    } else if (!byKey.has(key)) {
      const { taxon, synonyms } = acceptedOf(row, sci, key)
      byKey.set(key, taxa.length)
      taxa.push(taxon)
      pendingSynonyms.push(...synonyms)
    }
  }
  const synonyms = {}
  for (const { key, accepted } of pendingSynonyms) {
    if (key && accepted && byKey.has(accepted) && !byKey.has(key) && synonyms[key] === undefined) synonyms[key] = byKey.get(accepted)
  }
  return { taxa, synonyms, headers: rows[headerRow].filter(Boolean) }
}
