import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { safeWorkLink } from './WorkSources'

const components = {
  a: ({ href, children }) => {
    const url = safeWorkLink(href)
    return url ? <a href={url} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span>
  },
  // Reading a generated answer must not fetch arbitrary remote images or tracking URLs.
  img: ({ alt, src }) => {
    const url = safeWorkLink(src)
    return url ? <a href={url} target="_blank" rel="noopener noreferrer">{alt || '图片链接'}</a> : <span>{alt || '图片'}</span>
  },
  // letter-table：在信纸上贴成一张印刷体小卡片
  table: ({ children }) => <div className="letter-table overflow-x-auto"><table>{children}</table></div>,
}

export default function WorkAnswer({ content }) {
  return <div className="message-markdown min-w-0 text-[15px] leading-[1.75]">
    <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={components} urlTransform={safeWorkLink}>{String(content || '')}</ReactMarkdown>
  </div>
}
