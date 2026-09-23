// 手帐小装饰（2026-09-23，路线图 C18）：手绘的压花、叶子、火漆印、邮票、纸胶带与日期旁的小画。
// 只放在页边（封面、日期旁、页码那一行、来信信头），不压正文，全部静止，全部是装饰：读屏读不到，点不到。
// 研究依据与规则见 docs/02-设计/手帐装饰.md；贴纸由本机 ComfyUI 生成，来源记录在 public/design-assets/decor/decor-assets.json。
// 设置里「小装饰：没有」时，:root[data-decor="off"] 下所有 .decor 都不显示。

const BASE = '/design-assets/decor/'

/** 贴纸清单：width/height 是文件的像素宽高（约为显示尺寸的 2 倍），与 decor-assets.json 一致（有测试核对） */
export const STICKERS = {
  daisy: { file: 'daisy.webp', width: 59, height: 96 },
  'forget-me-not': { file: 'forget-me-not.webp', width: 39, height: 64 },
  sage: { file: 'sage.webp', width: 44, height: 64 },
  ginkgo: { file: 'ginkgo.webp', width: 64, height: 61 },
  clover: { file: 'clover.webp', width: 53, height: 64 },
  lavender: { file: 'lavender.webp', width: 42, height: 64 },
  'wax-seal': { file: 'wax-seal.webp', width: 72, height: 70 },
  stamp: { file: 'stamp.webp', width: 120, height: 105 },
}

/** 页码那一行轮着用的植物贴纸：只用植物，信纸页上不放小猫 */
export const PAGE_STICKERS = ['daisy', 'forget-me-not', 'sage', 'ginkgo', 'clover', 'lavender']

/** 第几页用哪一枚：按页码固定地轮，同一页刷新、来回翻都不变 */
export const pageStickerFor = (page) => PAGE_STICKERS[((page % PAGE_STICKERS.length) + PAGE_STICKERS.length) % PAGE_STICKERS.length]

export const stickerSrc = (name) => (STICKERS[name] ? BASE + STICKERS[name].file : null)

/**
 * 一枚贴纸。size 是显示时的长边（CSS 像素），另一边按文件比例算，先占好位置免得页面跳动。
 * @param {{ name: string, size: number, className?: string }} props
 */
export function Sticker({ name, size, className = '' }) {
  const sticker = STICKERS[name]
  if (!sticker) return null
  const scale = size / Math.max(sticker.width, sticker.height)
  return (
    <img
      src={BASE + sticker.file}
      alt=""
      aria-hidden="true"
      width={Math.round(sticker.width * scale)}
      height={Math.round(sticker.height * scale)}
      decoding="async"
      draggable={false}
      className={`decor decor-sticker ${className}`}
    />
  )
}

// 日期旁的小画：铅笔一笔画出的弯月、太阳、日出、日落，跟着纸上的铅笔灰变色
const DOODLES = {
  night: (
    <>
      <path d="M12.1 10.5A5.3 5.3 0 0 1 5.5 3.9a5.5 5.5 0 1 0 6.6 6.6z" />
      <path d="M12.7 2.2v2.4M11.5 3.4h2.4" />
    </>
  ),
  day: (
    <>
      <circle cx="8" cy="8" r="2.7" />
      <path d="M8 1.7v1.7M8 12.6v1.7M1.7 8h1.7M12.6 8h1.7M3.5 3.5l1.2 1.2M11.3 11.3l1.2 1.2M3.5 12.5l1.2-1.2M11.3 4.7l1.2-1.2" />
    </>
  ),
  dawn: (
    <>
      <path d="M2 11.6h12" />
      <path d="M4.8 11.6a3.2 3.2 0 0 1 6.4 0" />
      <path d="M8 4.8v1.5M4.3 6.5l1 1M11.7 6.5l-1 1" />
    </>
  ),
  dusk: (
    <>
      <path d="M2 11.6h12" />
      <path d="M4.8 11.6a3.2 3.2 0 0 1 6.4 0" />
      <path d="M5.2 14h5.6" />
    </>
  ),
}

/**
 * @param {{ phase: 'dawn' | 'day' | 'dusk' | 'night', size?: number, className?: string }} props
 */
export function DayPartDoodle({ phase, size = 14, className = '' }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-phase={phase}
      className={`decor decor-doodle ${className}`}
    >
      {DOODLES[phase] ?? DOODLES.day}
    </svg>
  )
}

/** 一段纸胶带：杏色底、浅浅的鼠尾草竖纹、两头撕口（样式在 globals.css「手帐小装饰」一节） */
export function WashiTape({ className = '' }) {
  return <span aria-hidden="true" className={`decor decor-tape ${className}`} />
}
