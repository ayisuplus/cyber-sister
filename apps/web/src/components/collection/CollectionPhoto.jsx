import { useState } from 'react'
import { useAuthedImageUrl } from '../../hooks/useAuthedImageUrl'

// 收藏的照片要带登录身份取；取到之后慢慢淡入，取不到就留一块安静的底色。
/** @param {{ path: string | null, alt?: string, className?: string }} props */
export default function CollectionPhoto({ path, alt = '', className = '' }) {
  const url = useAuthedImageUrl(path)
  const [loaded, setLoaded] = useState(false)
  if (!url) return <div aria-hidden="true" className={`bg-surface-muted ${className}`} />
  return (
    <img
      src={url}
      alt={alt}
      onLoad={() => setLoaded(true)}
      className={`transition-opacity duration-300 ease-calm ${loaded ? 'opacity-100' : 'opacity-0'} ${className}`}
    />
  )
}
