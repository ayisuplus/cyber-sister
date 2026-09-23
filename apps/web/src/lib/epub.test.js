import { describe, expect, it } from 'vitest'
import { EpubError, readEpub } from './epub'

// 夹具：现造一个真的 zip（stored 与 deflate 各来一个），不引第三方打包库。
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i += 1) {
    let c = i
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[i] = c >>> 0
  }
  return table
})()

const crc32 = (bytes) => {
  let c = 0xffffffff
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

const deflateRaw = async (bytes) => {
  const source = new ReadableStream({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    },
  })
  const compressed = source.pipeThrough(new CompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(compressed).arrayBuffer())
}

/** files: [{ name, text, deflate?, encrypted? }] */
async function makeZip(files, { zip64 = false } = {}) {
  const encoder = new TextEncoder()
  const locals = []
  const centrals = []
  let offset = 0

  for (const file of files) {
    const name = encoder.encode(file.name)
    const raw = encoder.encode(file.text)
    const method = file.deflate ? 8 : 0
    const body = file.deflate ? await deflateRaw(raw) : raw
    const flags = (file.encrypted ? 0x1 : 0) | 0x800

    const local = new Uint8Array(30 + name.length + body.length)
    const localView = new DataView(local.buffer)
    localView.setUint32(0, 0x04034b50, true)
    localView.setUint16(4, 20, true)
    localView.setUint16(6, flags, true)
    localView.setUint16(8, method, true)
    localView.setUint32(14, crc32(raw), true)
    localView.setUint32(18, body.length, true)
    localView.setUint32(22, raw.length, true)
    localView.setUint16(26, name.length, true)
    local.set(name, 30)
    local.set(body, 30 + name.length)
    locals.push(local)

    const central = new Uint8Array(46 + name.length)
    const centralView = new DataView(central.buffer)
    centralView.setUint32(0, 0x02014b50, true)
    centralView.setUint16(4, 20, true)
    centralView.setUint16(6, 20, true)
    centralView.setUint16(8, flags, true)
    centralView.setUint16(10, method, true)
    centralView.setUint32(16, crc32(raw), true)
    centralView.setUint32(20, body.length, true)
    centralView.setUint32(24, raw.length, true)
    centralView.setUint16(28, name.length, true)
    centralView.setUint32(42, offset, true)
    central.set(name, 46)
    centrals.push(central)

    offset += local.length
  }

  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0)
  const eocd = new Uint8Array(22)
  const eocdView = new DataView(eocd.buffer)
  eocdView.setUint32(0, 0x06054b50, true)
  eocdView.setUint16(8, zip64 ? 0xffff : files.length, true)
  eocdView.setUint16(10, zip64 ? 0xffff : files.length, true)
  eocdView.setUint32(12, centralSize, true)
  eocdView.setUint32(16, offset, true)

  const parts = [...locals, ...centrals, eocd]
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let cursor = 0
  for (const part of parts) {
    out.set(part, cursor)
    cursor += part.length
  }
  return out.buffer
}

const CONTAINER = `<?xml version="1.0"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`

const OPF = `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>活着</dc:title>
    <dc:creator>余华</dc:creator>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="text/ch2.xhtml" media-type="application/xhtml+xml"/>
    <item id="cover" href="cover.jpg" media-type="image/jpeg"/>
  </manifest>
  <spine toc="ncx">
    <itemref idref="c1"/>
    <itemref idref="c2"/>
  </spine>
</package>`

const NCX = `<?xml version="1.0"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <navMap>
    <navPoint id="n1"><navLabel><text>第一章 出门</text></navLabel><content src="ch1.xhtml"/></navPoint>
    <navPoint id="n2"><navLabel><text>第二章 回家</text></navLabel><content src="text/ch2.xhtml"/></navPoint>
  </navMap>
</ncx>`

const CH1 = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>一</title>
<style>p { color: red }</style></head>
<body>
  <h1>第一章</h1>
  <p>我比现在年轻十岁的时候。</p>
  <p>获得了一个<em>游手好闲</em>的职业。</p>
  <script>console.log('不该出现')</script>
</body></html>`

const CH2 = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>二</title></head>
<body><div>第一行<br/>第二行</div></body></html>`

const fullBook = (overrides = {}) => makeZip([
  { name: 'META-INF/container.xml', text: CONTAINER },
  { name: 'OEBPS/content.opf', text: OPF, deflate: true },
  { name: 'OEBPS/toc.ncx', text: NCX, deflate: true },
  { name: 'OEBPS/ch1.xhtml', text: CH1, deflate: true },
  { name: 'OEBPS/text/ch2.xhtml', text: CH2 },
], overrides)

describe('读 EPUB', () => {
  it('读出书名、作者和按 spine 排的章节', async () => {
    const book = await readEpub(await fullBook())

    expect(book.title).toBe('活着')
    expect(book.author).toBe('余华')
    expect(book.chapters.map((chapter) => chapter.title)).toEqual(['第一章 出门', '第二章 回家'])
  })

  it('正文抽成纯文本：段落断行，script 和 style 不要', async () => {
    const book = await readEpub(await fullBook())

    expect(book.chapters[0].text).toContain('我比现在年轻十岁的时候。')
    expect(book.chapters[0].text).toContain('获得了一个游手好闲的职业。')
    expect(book.chapters[0].text).not.toContain('console.log')
    expect(book.chapters[0].text).not.toContain('color: red')
    expect(book.chapters[1].text).toBe('第一行\n第二行')
  })

  it('stored 和 deflate 两种条目都能读', async () => {
    // ch1 是 deflate、ch2 是 stored，两章都读到就说明两条路都通
    const book = await readEpub(await fullBook())
    expect(book.chapters).toHaveLength(2)
    expect(book.chapters.every((chapter) => chapter.text.length > 0)).toBe(true)
  })

  it('不是 zip 就直说', async () => {
    const notAZip = new TextEncoder().encode('这就是一段普通文字'.repeat(20)).buffer
    await expect(readEpub(notAZip)).rejects.toThrow(EpubError)
    await expect(readEpub(notAZip)).rejects.toThrow('不是 EPUB')
  })

  it('zip64 打不开，如实说', async () => {
    await expect(readEpub(await fullBook({ zip64: true }))).rejects.toThrow('zip64')
  })

  it('有 DRM 加密就直说，不装作能读', async () => {
    const buffer = await makeZip([
      { name: 'META-INF/container.xml', text: CONTAINER, encrypted: true },
    ])
    await expect(readEpub(buffer)).rejects.toThrow('DRM')
  })

  it('没有正文时报错，而不是给一本空书', async () => {
    const buffer = await makeZip([
      { name: 'META-INF/container.xml', text: CONTAINER },
      { name: 'OEBPS/content.opf', text: OPF.replace(/<itemref[^>]*\/>/g, ''), deflate: true },
    ])
    await expect(readEpub(buffer)).rejects.toThrow('没找到可读的正文')
  })

  it('目录读不出来时退回正文里的标题', async () => {
    const buffer = await makeZip([
      { name: 'META-INF/container.xml', text: CONTAINER },
      { name: 'OEBPS/content.opf', text: OPF.replace('<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>', ''), deflate: true },
      { name: 'OEBPS/ch1.xhtml', text: CH1, deflate: true },
      { name: 'OEBPS/text/ch2.xhtml', text: CH2 },
    ])

    const book = await readEpub(buffer)

    expect(book.chapters[0].title).toBe('第一章')
    expect(book.chapters[1].title).toBe('第 2 节')
  })
})
