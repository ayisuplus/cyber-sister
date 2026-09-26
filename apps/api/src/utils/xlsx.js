/**
 * 只读的最小 .xlsx 读取器：不引依赖，给花草图鉴建名录索引用（scripts/build-plant-reference.mjs）。
 * .xlsx 是一个 zip：读中央目录找到共享字符串表与第一张工作表，用 zlib 解压，按单元格位置排成行。
 * 只支持普通 zip（不支持 ZIP64 与加密）、只读文字与数字，公式取缓存值。
 */
import { inflateRawSync } from 'node:zlib'

const EOCD = 0x06054b50
const CENTRAL = 0x02014b50
const LOCAL = 0x04034b50

/** 读 zip 里名字满足 wanted 的那几个文件：Map(名字 → Buffer)。 */
export function readZipEntries(buffer, wanted = () => true) {
  let eocd = -1
  for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 22 - 0xffff); offset -= 1) {
    if (buffer.readUInt32LE(offset) === EOCD) { eocd = offset; break }
  }
  if (eocd < 0) throw new Error('不是 zip 文件（找不到中央目录）')
  const count = buffer.readUInt16LE(eocd + 10)
  let cursor = buffer.readUInt32LE(eocd + 16)
  const files = new Map()
  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(cursor) !== CENTRAL) throw new Error('zip 中央目录坏了')
    const method = buffer.readUInt16LE(cursor + 10)
    const compressedSize = buffer.readUInt32LE(cursor + 20)
    const nameLength = buffer.readUInt16LE(cursor + 28)
    const extraLength = buffer.readUInt16LE(cursor + 30)
    const commentLength = buffer.readUInt16LE(cursor + 32)
    const localOffset = buffer.readUInt32LE(cursor + 42)
    const name = buffer.toString('utf8', cursor + 46, cursor + 46 + nameLength)
    cursor += 46 + nameLength + extraLength + commentLength
    if (!wanted(name)) continue
    if (buffer.readUInt32LE(localOffset) !== LOCAL) throw new Error(`zip 里 ${name} 的本地头坏了`)
    const start = localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28)
    const data = buffer.subarray(start, start + compressedSize)
    if (method === 0) files.set(name, Buffer.from(data))
    else if (method === 8) files.set(name, inflateRawSync(data))
    else throw new Error(`zip 里 ${name} 用了不支持的压缩方式 ${method}`)
  }
  return files
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
const decodeXml = (text) => text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code) => {
  if (code[0] === '#') return String.fromCodePoint(code[1].toLowerCase() === 'x' ? Number.parseInt(code.slice(2), 16) : Number(code.slice(1)))
  return ENTITIES[code] ?? whole
})
// 一个 <si> 或 <is> 里可能有好几段 <t>（富文本），拼起来
const textsIn = (xml) => decodeXml([...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((match) => match[1]).join(''))

/** "AB12" → 27（从 0 数） */
export function columnIndex(reference) {
  const letters = /^[A-Z]+/.exec(reference)?.[0] ?? 'A'
  return [...letters].reduce((sum, letter) => sum * 26 + (letter.charCodeAt(0) - 64), 0) - 1
}

/** 第一张工作表按行读成字符串数组（空单元格为 ''）。 */
export function readXlsxRows(buffer) {
  const files = readZipEntries(buffer, (name) => name === 'xl/sharedStrings.xml' || /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
  const sheetName = [...files.keys()].filter((name) => name.startsWith('xl/worksheets/')).sort((a, b) => Number(/\d+/.exec(a)[0]) - Number(/\d+/.exec(b)[0]))[0]
  if (!sheetName) throw new Error('这个 .xlsx 里没有工作表')
  const shared = files.has('xl/sharedStrings.xml')
    ? [...files.get('xl/sharedStrings.xml').toString('utf8').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((match) => textsIn(match[1]))
    : []
  const rows = []
  for (const rowMatch of files.get(sheetName).toString('utf8').matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = []
    for (const cell of rowMatch[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attributes = cell[1]
      const body = cell[2] ?? ''
      const position = columnIndex(/\br="([A-Z]+)\d*"/.exec(attributes)?.[1] ?? '')
      const type = /\bt="([^"]+)"/.exec(attributes)?.[1]
      const value = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1]
      let text = ''
      if (type === 's') text = shared[Number(value)] ?? ''
      else if (type === 'inlineStr') text = textsIn(body)
      else if (value !== undefined) text = decodeXml(value)
      while (row.length < position) row.push('')
      row[position] = text.trim()
    }
    rows.push(row)
  }
  return rows
}
