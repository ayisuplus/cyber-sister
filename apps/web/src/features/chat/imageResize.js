// 发图前客户端降采样：≤1024px、JPEG 0.85，控制在几百 KB；
// 解码/导出失败回退原文件（服务端 8MB 白名单兜底）。
export async function prepareChatImage(file, maxSize = 1024, quality = 0.85) {
  if (!file?.type?.startsWith('image/')) throw new Error('只支持图片文件')
  const fallback = () => ({ blob: file, previewUrl: URL.createObjectURL(file) })
  try {
    const objectUrl = URL.createObjectURL(file)
    try {
      const img = new Image()
      img.src = objectUrl
      if (typeof img.decode === 'function') {
        await img.decode()
      } else {
        await new Promise((resolve, reject) => {
          img.onload = resolve
          img.onerror = reject
        })
      }
      const scale = Math.min(1, maxSize / Math.max(img.naturalWidth, img.naturalHeight))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
      if (!blob) return fallback()
      return { blob, previewUrl: URL.createObjectURL(blob) }
    } finally {
      URL.revokeObjectURL(objectUrl)
    }
  } catch {
    return fallback()
  }
}
