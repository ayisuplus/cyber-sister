// 植物小件：落地页同款枝叶线稿（public/landing/index.html 的 #leaf-sprig），
// 只用鼠尾草色、低透明度、极慢摇曳，像窗边探进来的几枝叶子；全部为装饰（aria-hidden）。

export function LeafSprig({ size = 64, flip = false }) {
  return (
    <svg
      width={Math.round(size * 0.44)}
      height={size}
      viewBox="0 0 44 100"
      fill="none"
      aria-hidden="true"
      style={flip ? { transform: 'scaleX(-1)' } : undefined}
    >
      <path d="M20 96 C20 60 22 34 30 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M26 78 C14 72 8 60 10 48 C22 52 28 64 26 78 Z" fill="currentColor" opacity="0.85" />
      <path d="M24 58 C36 52 42 40 40 28 C28 32 22 44 24 58 Z" fill="currentColor" opacity="0.7" />
      <path d="M28 40 C18 32 14 20 17 10 C28 16 32 28 28 40 Z" fill="currentColor" opacity="0.9" />
    </svg>
  )
}

// 聊天页背景的枝叶：贴边、错开节奏（负延迟让它们不同时起步），手机只留两枝
const FIELD_ITEMS = [
  { size: 84, className: 'left-[2%] bottom-[10%] opacity-[0.2]', duration: '13s', delay: '0s' },
  { size: 64, flip: true, className: 'right-[3%] top-[14%] opacity-[0.16]', duration: '15s', delay: '-5s' },
  { size: 52, className: 'left-[7%] top-[26%] opacity-[0.12] max-[640px]:hidden', duration: '17s', delay: '-9s' },
  { size: 72, flip: true, className: 'right-[6%] bottom-[18%] opacity-[0.14] max-[640px]:hidden', duration: '14s', delay: '-3s' },
]

export function DoodleField() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-0 overflow-hidden text-action-primary">
      {FIELD_ITEMS.map((item, index) => (
        <span
          key={index}
          className={`absolute animate-doodle-float ${item.className}`}
          style={{ animationDuration: item.duration, animationDelay: item.delay }}
        >
          <LeafSprig size={item.size} flip={item.flip} />
        </span>
      ))}
    </div>
  )
}

// 标题下的叶子分隔：细线 + 小叶 + 细线，mount 时描边画出
export function Squiggle({ width = 96 }) {
  return (
    <svg
      width={width}
      height="14"
      viewBox="0 0 96 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      aria-hidden="true"
      className="animate-squiggle-draw text-action-primary opacity-60"
    >
      <path pathLength="1" d="M6 7 H38" />
      <path pathLength="1" d="M48 1.5 C53.5 4.5 53.5 9.5 48 12.5 C42.5 9.5 42.5 4.5 48 1.5 Z M48 3.5 V11" />
      <path pathLength="1" d="M58 7 H90" />
    </svg>
  )
}
