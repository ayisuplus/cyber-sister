// 信纸的版面：每页左边一条页边线，字写在横格上；本子一次只摊开一页，宽屏也一样。都是纯函数，方便测。
export const MARGIN_X = 44       // 页边线离纸的左边
export const TEXT_INSET = 10     // 字离页边线
export const RIGHT_PAD = 18      // 字离纸的右边
export const DEFAULT_LINE = 34

// 这些要对齐到整数行：不是一行行字的东西（照片、卡片、便签、代码、表格……）
export const SNAP_SELECTOR = [
  '.letter-snap',
  '.letter-entry > :not(.letter-text):not(.message-markdown):not(.letter-who):not(.sr-only):not(.letter-date):not(.letter-time)',
  '.letter-strip .message-markdown pre',
  '.letter-strip .message-markdown .letter-table',
].join(', ')

/**
 * 给定纸的宽高、行高与左右留白，算出每页的尺寸。高度向下取整到整行，顶上留一行做天头。
 * @returns {{ columnWidth: number, stripWidth: number, gap: number, pageWidth: number, pageHeight: number } | null}
 */
export function pageGeometry(width, height, line = DEFAULT_LINE, inset = MARGIN_X + TEXT_INSET, rightPad = RIGHT_PAD) {
  if (!(width > 0) || !(height > 0) || !(line > 0)) return null
  const pageHeight = Math.max(line, Math.floor((height - line) / line) * line)
  const columnWidth = Math.max(80, width - inset - rightPad)
  const gap = rightPad + inset
  // 一页的步长正好是纸的宽度：字占中间，两边分别是上一页的右留白与下一页的左边距
  return { columnWidth, stripWidth: columnWidth, gap, pageWidth: columnWidth + gap, pageHeight }
}

/** 最后一行字落在第几页（从 0 数）：看结尾标记离第一栏左边有多远。 */
export function pageOf(offsetX, geometry) {
  if (!geometry) return 0
  return Math.max(0, Math.floor((offsetX + 1) / geometry.pageWidth))
}

/** 页码怎么写：封面写「封面」，其余「3 / 8」；读屏另给一句完整的话。 */
export function pageLabel(index, pages, hasCover = false) {
  if (hasCover && index === 0) return { text: '封面', sr: '封面' }
  const total = Math.max(1, pages)
  const number = Math.min(Math.max(hasCover ? index : index + 1, 1), total)
  return { text: `${number} / ${total}`, sr: `第 ${number} 页，共 ${total} 页` }
}
