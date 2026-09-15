export function safeWorkLink(value) {
  if (typeof value !== 'string') return ''
  if (value.startsWith('#')) return value
  try {
    const url = new URL(value)
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : ''
  } catch { return '' }
}

export default function WorkSources({ toolRuns = [], progress = [] }) {
  const sources = [...new Map([...toolRuns, ...progress].flatMap((run) => run.sources || [])
    .filter((source) => safeWorkLink(source.url) && !source.url.startsWith('#'))
    .map((source) => [source.url, source])).values()].slice(0, 20)
  if (!sources.length) return null
  return <details className="mt-3 text-xs text-text-secondary">
    <summary className="min-h-8 cursor-pointer">已查阅来源 · {sources.length}</summary>
    <ol aria-label="已查阅来源" className="mt-1 space-y-2">
      {sources.map((source, index) => <li key={source.url}>
        <a className="break-words text-status-info underline" href={safeWorkLink(source.url)} target="_blank" rel="noopener noreferrer">{index + 1}. {source.title || source.url}</a>
      </li>)}
    </ol>
  </details>
}
