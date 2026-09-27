// 宠物页的小线稿：零食（小鱼干 / 小骨头 / 胡萝卜 / 瓜子）、小心心、垫子。
// 和宠物同一种画法：藏青描边、粉彩填色；全部为装饰（aria-hidden），文字另外写。

const INK = '#2F3A5A'

const SNACKS = {
  cat: (
    <>
      <path d="M4 12 C8 6 16 6 20 12 C16 18 8 18 4 12 Z" fill="#F6C9A8" stroke={INK} strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M20 12 L25 8 L25 16 Z" fill="#F6C9A8" stroke={INK} strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx="9" cy="11" r="1" fill={INK} />
    </>
  ),
  dog: (
    <path d="M7 9 A2.6 2.6 0 1 1 9.5 6 L18.5 6 A2.6 2.6 0 1 1 21 9 A2.6 2.6 0 1 1 18.5 12 L9.5 12 A2.6 2.6 0 1 1 7 9 Z" transform="translate(-1 3)" fill="#FBEFD9" stroke={INK} strokeWidth="1.5" strokeLinejoin="round" />
  ),
  rabbit: (
    <>
      <path d="M7 20 L16 8 C18 6 21 9 19 11 Z" fill="#F7B37A" stroke={INK} strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M17 8 C17 5 19 3 21 3 M18.5 9 C20.5 7 23 7 24 8" fill="none" stroke="#7FB77E" strokeWidth="1.6" strokeLinecap="round" />
    </>
  ),
  hamster: (
    <>
      <path d="M14 4 C19 8 19 16 14 21 C9 16 9 8 14 4 Z" fill="#6F6A63" stroke={INK} strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M14 7 C16.5 10 16.5 15 14 18" fill="none" stroke="#F4EFE6" strokeWidth="1.4" strokeLinecap="round" />
    </>
  ),
}

export function SnackIcon({ species, size = 22, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 26 24" aria-hidden="true" className={className}>
      {SNACKS[species] ?? SNACKS.cat}
    </svg>
  )
}

export function HeartIcon({ filled = false, size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 22" aria-hidden="true">
      <path
        d="M12 20 C5 14.5 2 11.5 2 7.5 A4.8 4.8 0 0 1 12 5 A4.8 4.8 0 0 1 22 7.5 C22 11.5 19 14.5 12 20 Z"
        fill={filled ? '#F4A7B4' : 'none'}
        stroke={filled ? INK : 'currentColor'}
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      {filled && <path d="M7 8 C7.3 6.8 8.2 6.2 9.2 6.1" fill="none" stroke="#FFFFFF" strokeWidth="1.4" strokeLinecap="round" />}
    </svg>
  )
}

/** 宠物底下那块圆圆的小垫子，带一圈针脚。 */
export function Cushion({ className = '' }) {
  return (
    <svg viewBox="0 0 300 70" aria-hidden="true" className={className} preserveAspectRatio="none">
      <ellipse cx="150" cy="38" rx="140" ry="26" fill="var(--cs-pastel-blush)" stroke={INK} strokeWidth="2" opacity=".9" />
      <ellipse cx="150" cy="38" rx="122" ry="18" fill="none" stroke={INK} strokeWidth="1.2" strokeDasharray="5 6" opacity=".45" />
    </svg>
  )
}
