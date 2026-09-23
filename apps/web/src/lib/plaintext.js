// 纯文本的书：编码先按 BOM 认，认不出就试 UTF-8，再不行退回 GBK（中文 TXT 多是这个）。
// 章节按常见标题切；切不出来就按长度分段，不假装有目录。

const CHAPTER_PATTERN = /^[ \t\u3000]*(?:第\s*[0-9０-９〇零一二三四五六七八九十百千两]+\s*[章节節回卷篇部]|Chapter\s+\d+|CHAPTER\s+\d+)[^\n]{0,40}$/
const FALLBACK_CHARS = 4000
const MAX_TEXT_CHARS = 5_000_000

const tryDecode = (bytes, encoding) => {
  try {
    return new TextDecoder(encoding, { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}

/** 按 BOM 与试解码确定编码；都不行就用 UTF-8 宽松解，保证总能读出点东西。 */
export function decodePlainText(buffer) {
  const bytes = new Uint8Array(buffer)
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2))
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2))
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(bytes.subarray(3))
  }
  return tryDecode(bytes, 'utf-8') ?? tryDecode(bytes, 'gbk') ?? new TextDecoder('utf-8').decode(bytes)
}

/** 没有章节标题时按长度切，尽量断在空行上，不要把一句话劈成两半。 */
function splitByLength(text) {
  const chapters = []
  let cursor = 0
  while (cursor < text.length) {
    let end = Math.min(cursor + FALLBACK_CHARS, text.length)
    if (end < text.length) {
      const boundary = text.lastIndexOf('\n\n', end)
      if (boundary > cursor + FALLBACK_CHARS / 2) end = boundary
    }
    const slice = text.slice(cursor, end).trim()
    if (slice) chapters.push({ title: `第 ${chapters.length + 1} 段`, text: slice })
    cursor = end
  }
  return chapters
}

/**
 * 读一本 TXT。
 * @param {ArrayBuffer} buffer
 * @returns {{ title: string, author: string, chapters: { title: string, text: string }[] }}
 */
export function readPlainText(buffer) {
  const raw = decodePlainText(buffer)
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .slice(0, MAX_TEXT_CHARS)
    .trim()
  if (!raw) throw new Error('这个文件是空的')

  const lines = raw.split('\n')
  const starts = []
  for (const [index, line] of lines.entries()) {
    if (line.length <= 50 && CHAPTER_PATTERN.test(line)) starts.push(index)
  }

  // 只有一两处像标题的，多半是误判，宁可按长度切
  if (starts.length < 2) return { title: '', author: '', chapters: splitByLength(raw) }

  const chapters = []
  // 第一个标题之前的文字（序、前言）单独成一段，不丢掉
  const preface = lines.slice(0, starts[0]).join('\n').trim()
  if (preface) chapters.push({ title: '开头', text: preface })

  for (const [order, start] of starts.entries()) {
    const end = starts[order + 1] ?? lines.length
    const text = lines.slice(start, end).join('\n').trim()
    if (text) chapters.push({ title: lines[start].trim().slice(0, 60), text })
  }

  return { title: '', author: '', chapters }
}
