// EPUB 就是一个 zip：这里只用浏览器自带的 DecompressionStream 解开它，不引第三方库。
// 解不开的（zip64、加密/DRM、缺 spine）一律如实抛错，不装作能读。

const SIG_EOCD = 0x06054b50
const SIG_CENTRAL = 0x02014b50
const SIG_LOCAL = 0x04034b50
const METHOD_STORED = 0
const METHOD_DEFLATE = 8
const FLAG_ENCRYPTED = 0x1
// zip 注释最长 65535，EOCD 定长 22
const MAX_EOCD_SCAN = 65535 + 22
const MAX_TEXT_CHARS = 5_000_000
const MAX_TITLE_CHARS = 60

export class EpubError extends Error {
  constructor(message) {
    super(message)
    this.name = 'EpubError'
  }
}

/** 从末尾往回找 EOCD，跳过尾部注释。 */
function findEndOfCentralDirectory(view) {
  const start = Math.max(0, view.byteLength - MAX_EOCD_SCAN)
  for (let offset = view.byteLength - 22; offset >= start; offset -= 1) {
    if (view.getUint32(offset, true) === SIG_EOCD) return offset
  }
  throw new EpubError('这个文件不是 EPUB，或者已经损坏')
}

/** 读中央目录，返回文件名到条目的映射。 */
function readCentralDirectory(buffer) {
  const view = new DataView(buffer)
  const eocd = findEndOfCentralDirectory(view)
  const count = view.getUint16(eocd + 10, true)
  const offset = view.getUint32(eocd + 16, true)
  if (count === 0xffff || offset === 0xffffffff) {
    throw new EpubError('这本书用了 zip64 格式，暂时打不开')
  }

  const entries = new Map()
  const names = new TextDecoder('utf-8')
  let cursor = offset
  for (let i = 0; i < count; i += 1) {
    if (cursor + 46 > buffer.byteLength || view.getUint32(cursor, true) !== SIG_CENTRAL) {
      throw new EpubError('这本书的目录读不出来，文件可能损坏了')
    }
    const nameLength = view.getUint16(cursor + 28, true)
    entries.set(names.decode(new Uint8Array(buffer, cursor + 46, nameLength)), {
      flags: view.getUint16(cursor + 8, true),
      method: view.getUint16(cursor + 10, true),
      compressedSize: view.getUint32(cursor + 20, true),
      localOffset: view.getUint32(cursor + 42, true),
    })
    cursor += 46 + nameLength + view.getUint16(cursor + 30, true) + view.getUint16(cursor + 32, true)
  }
  return entries
}

const inflate = async (raw) => {
  const source = new ReadableStream({
    start(controller) {
      controller.enqueue(raw)
      controller.close()
    },
  })
  const stream = source.pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** 取出一个条目的原始字节：stored 直接切，deflate 交给 DecompressionStream。 */
async function readEntry(buffer, entry, name) {
  if (entry.flags & FLAG_ENCRYPTED) throw new EpubError('这本书有加密保护（DRM），打不开')
  if (entry.method !== METHOD_STORED && entry.method !== METHOD_DEFLATE) {
    throw new EpubError('这本书用了不支持的压缩方式，打不开')
  }
  const view = new DataView(buffer)
  if (view.getUint32(entry.localOffset, true) !== SIG_LOCAL) {
    throw new EpubError(`这本书里的「${name}」读不出来`)
  }
  const start = entry.localOffset + 30
    + view.getUint16(entry.localOffset + 26, true)
    + view.getUint16(entry.localOffset + 28, true)
  const raw = new Uint8Array(buffer, start, entry.compressedSize)
  return entry.method === METHOD_STORED ? raw : inflate(raw)
}

const decodeText = (bytes) => new TextDecoder('utf-8').decode(bytes)

/** 读出一个 zip 条目并按 XML 解析；条目不存在时抛出给定的说法。 */
async function readXml(buffer, entries, path, missingMessage) {
  const entry = entries.get(path)
  if (!entry) throw new EpubError(missingMessage)
  const doc = new DOMParser().parseFromString(decodeText(await readEntry(buffer, entry, path)), 'application/xml')
  if (doc.getElementsByTagName('parsererror').length) {
    throw new EpubError(`这本书的「${path}」格式不对，读不出来`)
  }
  return doc
}

/** 不管命名空间前缀，按本地名取元素。 */
const byTag = (root, local) => [...root.getElementsByTagName('*')].filter(
  (node) => node.localName === local
)

/** 把 zip 里的相对路径拼成规范路径（"a/b/../c.xhtml" → "a/c.xhtml"）。 */
function resolvePath(base, href) {
  const target = href.split('#')[0]
  if (!target) return ''
  const segments = base ? base.split('/') : []
  for (const segment of decodeURIComponent(target).split('/')) {
    if (segment === '.' || segment === '') continue
    if (segment === '..') segments.pop()
    else segments.push(segment)
  }
  return segments.join('/')
}

const dirOf = (path) => path.split('/').slice(0, -1).join('/')

const BLOCK_TAGS = new Set([
  'p', 'div', 'section', 'article', 'blockquote', 'li', 'tr', 'pre',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'figcaption', 'hr',
])

/** 把正文抽成纯文本：块级元素之间断行，script/style 丢掉。 */
function extractText(node, out) {
  for (const child of node.childNodes) {
    if (child.nodeType === 3) {
      out.push(child.nodeValue)
      continue
    }
    if (child.nodeType !== 1) continue
    const tag = child.localName?.toLowerCase()
    if (tag === 'script' || tag === 'style') continue
    if (tag === 'br') {
      out.push('\n')
      continue
    }
    const isBlock = BLOCK_TAGS.has(tag)
    if (isBlock) out.push('\n')
    extractText(child, out)
    if (isBlock) out.push('\n')
  }
}

function documentToText(doc) {
  // 只要 body：head 里的 <title>、<style> 不是正文
  const out = []
  extractText(byTag(doc, 'body')[0] || doc.documentElement, out)
  return out.join('')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function firstHeading(doc) {
  for (const level of ['h1', 'h2', 'h3']) {
    const text = byTag(doc, level)[0]?.textContent?.trim()
    if (text) return text.slice(0, MAX_TITLE_CHARS)
  }
  return ''
}

/** manifest：id → { path, mediaType, properties } */
function readManifest(opf, opfDir) {
  const manifest = new Map()
  for (const item of byTag(opf, 'item')) {
    const id = item.getAttribute('id')
    const href = item.getAttribute('href')
    if (!id || !href) continue
    manifest.set(id, {
      path: resolvePath(opfDir, href),
      mediaType: item.getAttribute('media-type') || '',
      properties: item.getAttribute('properties') || '',
    })
  }
  return manifest
}

/** 目录：EPUB3 的 nav 与 EPUB2 的 ncx 结构不同，但都是「链接 → 标题」。 */
function labelsFrom(doc, tocDir, isNav) {
  const labels = new Map()
  const rows = isNav
    ? byTag(doc, 'a').map((node) => [node.getAttribute('href'), node.textContent])
    : byTag(doc, 'navPoint').map((node) => [
      byTag(node, 'content')[0]?.getAttribute('src'),
      byTag(node, 'navLabel')[0]?.textContent,
    ])
  for (const [href, raw] of rows) {
    const text = raw?.trim()
    if (href && text) labels.set(resolvePath(tocDir, href), text.slice(0, MAX_TITLE_CHARS))
  }
  return labels
}

/** 取不到目录不影响正文，章节名会退回正文里的标题。 */
async function readTocLabels(buffer, entries, manifest) {
  const nav = [...manifest.values()].find((item) => item.properties?.includes('nav'))
  const target = nav || [...manifest.values()].find((item) => item.mediaType === 'application/x-dtbncx+xml')
  if (!target || !entries.has(target.path)) return new Map()
  try {
    const doc = await readXml(buffer, entries, target.path, '')
    return labelsFrom(doc, dirOf(target.path), Boolean(nav))
  } catch {
    return new Map()
  }
}

/** 按 spine 顺序读正文；单篇读不出来就跳过，不让整本书打不开。 */
async function readChapters(buffer, entries, spine, labels) {
  const parsed = await Promise.all(spine.map(async (item, index) => {
    if (!entries.has(item.path)) return null
    try {
      const doc = await readXml(buffer, entries, item.path, '')
      const text = documentToText(doc)
      if (!text) return null
      return { title: labels.get(item.path) || firstHeading(doc) || `第 ${index + 1} 节`, text }
    } catch {
      return null
    }
  }))

  const chapters = []
  let total = 0
  for (const chapter of parsed) {
    if (!chapter) continue
    chapters.push(chapter)
    total += chapter.text.length
    if (total > MAX_TEXT_CHARS) break
  }
  return chapters
}

/**
 * 读一本 EPUB。
 * @param {ArrayBuffer} buffer 整本书的字节
 * @returns {Promise<{ title: string, author: string, chapters: { title: string, text: string }[] }>}
 */
export async function readEpub(buffer) {
  const entries = readCentralDirectory(buffer)

  const container = await readXml(buffer, entries, 'META-INF/container.xml', '这个文件不像是 EPUB')
  const opfPath = byTag(container, 'rootfile')[0]?.getAttribute('full-path')
  if (!opfPath) throw new EpubError('这本书没写明正文在哪里')

  const opf = await readXml(buffer, entries, opfPath, '这本书的正文目录找不到了')
  const manifest = readManifest(opf, dirOf(opfPath))
  const spine = byTag(opf, 'itemref')
    .map((ref) => manifest.get(ref.getAttribute('idref')))
    .filter((item) => item && /xhtml|html/.test(item.mediaType))
  if (!spine.length) throw new EpubError('这本书里没找到可读的正文')

  const labels = await readTocLabels(buffer, entries, manifest)
  const chapters = await readChapters(buffer, entries, spine, labels)
  if (!chapters.length) throw new EpubError('这本书里没读到正文')

  return {
    title: byTag(opf, 'title')[0]?.textContent?.trim() || '',
    author: byTag(opf, 'creator')[0]?.textContent?.trim() || '',
    chapters,
  }
}
