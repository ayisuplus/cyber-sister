import { useEffect, useState } from 'react'

const QUERY = '(orientation: landscape)'
// 横屏且视口高度不足 500px 才命中：桌面/平板横屏高度足够，不会误触发
const MAX_PHONE_LANDSCAPE_HEIGHT = 500

const isLandscapePhone = () =>
  window.matchMedia(QUERY).matches && window.innerHeight < MAX_PHONE_LANDSCAPE_HEIGHT

/**
 * 手机横屏检测（沉浸书桌触发条件）。
 * matchMedia 的 change 覆盖方向切换；resize 兜底部分浏览器方向变化不发 change 的情况。
 */
export function useLandscapePhone() {
  const [active, setActive] = useState(isLandscapePhone)

  useEffect(() => {
    const mql = window.matchMedia(QUERY)
    const update = () => setActive(isLandscapePhone())
    mql.addEventListener('change', update)
    window.addEventListener('resize', update)
    return () => {
      mql.removeEventListener('change', update)
      window.removeEventListener('resize', update)
    }
  }, [])

  return active
}
