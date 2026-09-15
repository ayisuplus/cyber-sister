// 品牌标识：落地页同款单叶线稿（public/landing/index.html 的 #leaf-single）+ 斜体衬线 "Amie"。
const SIZES = {
  md: { leaf: 20, text: 'text-[21px]' },
  lg: { leaf: 30, text: 'text-[34px]' },
}

export function LeafIcon({ size = 20, className = '' }) {
  return (
    <svg width={Math.round(size * 0.75)} height={size} viewBox="0 0 24 32" fill="none" aria-hidden="true" className={className}>
      <path d="M12 2 C20 10 20 22 12 30 C4 22 4 10 12 2 Z" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12 4 L12 28" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  )
}

/** @param {{ as?: 'span'|'h1'|'div', size?: 'md'|'lg', className?: string }} props */
export default function BrandMark({ as: Tag = 'span', size = 'md', className = '' }) {
  const { leaf, text } = SIZES[size]
  return (
    <Tag className={`inline-flex items-center gap-2 ${className}`}>
      <LeafIcon size={leaf} className="shrink-0 text-action-primary" />
      <span className={`font-display font-normal italic leading-none tracking-[0.02em] text-text-primary ${text}`}>Amie</span>
    </Tag>
  )
}
