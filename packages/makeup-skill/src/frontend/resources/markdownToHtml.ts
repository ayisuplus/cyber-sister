/** 简易 Markdown → HTML 转换（仅用于教学资源正文展示）. */
export function markdownToHtml(md: string): string {
  // 先转义原始文本, 防止资源正文里的 HTML 注入 (输出经 dangerouslySetInnerHTML 渲染)
  const escaped = md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return escaped
    .replace(/^### (.+)$/gm, '<h3 class="font-semibold text-ink mb-2">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="font-serif font-bold text-ink text-lg mb-3">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 class="font-serif font-bold text-ink text-xl mb-4">$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong class="font-semibold">$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^- (.+)$/gm, '<li class="ml-4 mb-1 list-disc">$1</li>')
    .replace(/(<li[^>]*>.*<\/li>\n?)+/g, (m) => `<ul class="my-2">${m}</ul>`)
    .replace(/\n\n+/g, '</p><p class="mb-2">')
    .replace(/\n/g, '<br/>');
}
