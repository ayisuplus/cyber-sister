// 把笔记落回正文：locator 形如 "章序号:章内字符偏移"，引文才是真正的锚。
// 书换过版、文件换过一份都可能对不上——对不上就不标，不硬凑一个位置。

const NEAR = 50

/** 从 locator 里取章序号；取不出来返回 null（聊天里记的、纸书的笔记都没有位置）。 */
export function noteChapter(locator) {
  const [chapter] = String(locator ?? '').split(':')
  const index = Number.parseInt(chapter, 10)
  return Number.isInteger(index) && index >= 0 && String(index) === chapter ? index : null
}

/** 从 locator 里取章内偏移。 */
function noteOffset(locator) {
  const [, offset] = String(locator ?? '').split(':')
  return Number.parseInt(offset, 10) || 0
}

/** 这一章里的笔记。 */
export const chapterNotes = (notes, index) => notes.filter((note) => noteChapter(note.locator) === index)

/** 正文里没有锚点的笔记（没位置，或引文找不着）——只能在目录抽屉里列出来。 */
export const unanchoredNotes = (notes, chapters) => notes.filter((note) => {
  const index = noteChapter(note.locator)
  if (index === null || !note.quote?.trim()) return true
  const text = chapters[index]?.text
  return !text || locate(text, note) < 0
})

function locate(text, note) {
  const quote = note.quote?.trim()
  if (!quote) return -1
  const near = text.indexOf(quote, Math.max(0, noteOffset(note.locator) - NEAR))
  return near >= 0 ? near : text.indexOf(quote)
}

/**
 * 把一章正文切成若干段：带 note 的那段是你划过的句子。
 * 重叠的只留先出现的那条，免得同一句话套两层。
 * @returns {{ text: string, note?: object }[]}
 */
export function markChapter(text, notes) {
  const hits = []
  for (const note of notes) {
    const start = locate(text, note)
    if (start < 0) continue
    hits.push({ start, end: start + note.quote.trim().length, note })
  }
  hits.sort((a, b) => a.start - b.start || b.end - a.end)

  const segments = []
  let cursor = 0
  for (const hit of hits) {
    if (hit.start < cursor) continue
    if (hit.start > cursor) segments.push({ text: text.slice(cursor, hit.start) })
    segments.push({ text: text.slice(hit.start, hit.end), note: hit.note })
    cursor = hit.end
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor) })
  return segments
}
