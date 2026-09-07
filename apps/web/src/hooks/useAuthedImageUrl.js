import { useEffect, useState } from 'react'
import { useAppearanceStore } from '../stores/appearanceStore'

/**
 * 鉴权图片路径 → object URL。经 appearanceStore 的会话级路径缓存：
 * 同路径（如每条用户消息气泡的头像）只拉取一次；object URL 生命周期归 store，
 * 本 hook 不 revoke（也避免了 path 切换时先撤销正在展示的 URL 造成短暂破图）。
 * 路径为空或拉取失败一律 null；卸载或换路径后不再 setState（cancelled 防竞态）。
 */
export function useAuthedImageUrl(path) {
  const [url, setUrl] = useState(null)
  const resolveAssetUrl = useAppearanceStore(s => s.resolveAssetUrl)

  useEffect(() => {
    if (!path) {
      setUrl(null)
      return undefined
    }
    let cancelled = false
    resolveAssetUrl(path).then((resolved) => {
      if (!cancelled && resolved) setUrl(resolved)
    })
    return () => { cancelled = true }
  }, [path, resolveAssetUrl])

  return url
}
