import { Buffer } from 'node:buffer'
import { deflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { columnIndex, readXlsxRows, readZipEntries } from './xlsx.js'

// 测试里现拼一个 zip：不算 CRC（读取器不校验），一个存储、其余压缩
function zip(entries) {
  const locals = []
  const centrals = []
  let offset = 0
  for (const [index, [name, text]] of entries.entries()) {
    const raw = Buffer.from(text, 'utf8')
    const stored = index === 0
    const data = stored ? raw : deflateRawSync(raw)
    const nameBytes = Buffer.from(name, 'utf8')
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(stored ? 0 : 8, 8)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(stored ? 0 : 8, 10)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(raw.length, 24)
    central.writeUInt16LE(nameBytes.length, 28)
    central.writeUInt32LE(offset, 42)
    locals.push(local, nameBytes, data)
    centrals.push(central, nameBytes)
    offset += local.length + nameBytes.length + data.length
  }
  const directory = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, directory, end])
}

const SHARED = '<sst><si><t>中文名</t></si><si><t>学名</t></si><si><r><t>栀</t></r><r><t>子</t></r></si><si><t>Gardenia jasminoides J.Ellis</t></si><si><t>A &amp; B</t></si></sst>'
const SHEET = '<worksheet><sheetData>'
  + '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>'
  + '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" t="s"><v>3</v></c><c r="D2"><v>42</v></c></row>'
  + '<row r="3"><c r="B3" t="inlineStr"><is><t>Nerium oleander</t></is></c><c r="C3" t="s"><v>4</v></c></row>'
  + '</sheetData></worksheet>'

describe('最小 xlsx 读取器', () => {
  it('列字母换成下标', () => {
    expect([columnIndex('A1'), columnIndex('Z9'), columnIndex('AA10'), columnIndex('AB2')]).toEqual([0, 25, 26, 27])
  })

  it('读 zip 里要的那几个文件：存储的和压缩的都行', () => {
    const files = readZipEntries(zip([['a.txt', 'hello'], ['b.txt', '世界'], ['c.txt', 'skip']]), (name) => name !== 'c.txt')
    expect([...files.keys()]).toEqual(['a.txt', 'b.txt'])
    expect(files.get('b.txt').toString('utf8')).toBe('世界')
  })

  it('共享字符串（含富文本）、行内字符串、数字、空格位都排对', () => {
    const buffer = zip([['[Content_Types].xml', '<Types/>'], ['xl/sharedStrings.xml', SHARED], ['xl/worksheets/sheet1.xml', SHEET]])
    expect(readXlsxRows(buffer)).toEqual([
      ['中文名', '学名'],
      ['栀子', 'Gardenia jasminoides J.Ellis', '', '42'],
      ['', 'Nerium oleander', 'A & B'],
    ])
  })

  it('不是 zip 就说清楚', () => {
    expect(() => readXlsxRows(Buffer.from('not a zip at all, just text padding padding'))).toThrow('不是 zip 文件')
  })
})
