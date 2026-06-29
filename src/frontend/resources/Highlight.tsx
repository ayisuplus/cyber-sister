// Highlight 工具: 在搜索结果中高亮匹配的关键字 (case-insensitive).
// 用法: <Highlight text=\"abc xyz\" query=\"xyz\" /> → 'abc <mark>xyz</mark>'
// 多段匹配都标, 保留原始大小写.

import type { ReactNode } from 'react';

export interface HighlightSegment {
  text: string;
  /** true 表示这是匹配段 (要高亮). */
  match: boolean;
}

/**
 * 纯函数版: 把字符串切成匹配 / 非匹配段.
 * 公开便于单测.
 */
export function splitHighlight(text: string, query: string): HighlightSegment[] {
  if (!query) return [{ text, match: false }];
  const q = query.trim();
  if (!q) return [{ text, match: false }];
  const lowerText = text.toLowerCase();
  const lowerQ = q.toLowerCase();
  const out: HighlightSegment[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const idx = lowerText.indexOf(lowerQ, cursor);
    if (idx < 0) {
      out.push({ text: text.slice(cursor), match: false });
      break;
    }
    if (idx > cursor) {
      out.push({ text: text.slice(cursor, idx), match: false });
    }
    out.push({ text: text.slice(idx, idx + q.length), match: true });
    cursor = idx + q.length;
  }
  return out;
}

export function Highlight({ text, query }: { text: string; query: string }): ReactNode {
  const segments = splitHighlight(text, query);
  return segments.map((seg, i) =>
    seg.match ? (
      <mark
        key={i}
        className="bg-primary/25 text-ink font-semibold rounded px-0.5"
        style={{ backgroundColor: 'rgba(234,182,188,0.45)' }}
      >
        {seg.text}
      </mark>
    ) : (
      <span key={i}>{seg.text}</span>
    ),
  );
}
