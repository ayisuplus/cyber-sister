// 收藏的照片先在这台设备上重画一遍：原图最长边 1600px、缩略图 480px，都存成 JPEG。
// 重画之后，照片里的拍摄位置、相机型号这些信息就不在了（服务器存之前还会再去一遍）。
// 读不了就如实说，绝不退回去上传原文件——那样拍摄位置会跟着传上去。
const PHOTO_EDGE = 1600
const THUMB_EDGE = 480

export class PhotoError extends Error {}

const unreadable = () => new PhotoError('这张图读不了，换一张试试')

async function decode(url) {
  const image = new Image()
  image.src = url
  if (typeof image.decode === 'function') await image.decode()
  else await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject })
  if (!image.naturalWidth || !image.naturalHeight) throw unreadable()
  return image
}

function draw(image, edge, quality) {
  const scale = Math.min(1, edge / Math.max(image.naturalWidth, image.naturalHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
  const context = canvas.getContext('2d')
  if (!context) throw unreadable()
  // 透明的截图（比如商品图）铺白底，存成 JPEG 才不会变黑
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(unreadable())), 'image/jpeg', quality)
  })
}

/**
 * @param {File | Blob} file 相册里选的、相机拍的或页面相机截下的图
 * @returns {Promise<{ photo: Blob, thumb: Blob, previewUrl: string }>}
 */
export async function preparePhoto(file) {
  if (!file?.type?.startsWith('image/')) throw new PhotoError('只能放图片')
  const url = URL.createObjectURL(file)
  try {
    const image = await decode(url)
    const [photo, thumb] = await Promise.all([draw(image, PHOTO_EDGE, 0.85), draw(image, THUMB_EDGE, 0.8)])
    return { photo, thumb, previewUrl: URL.createObjectURL(photo) }
  } catch (error) {
    throw error instanceof PhotoError ? error : unreadable()
  } finally {
    URL.revokeObjectURL(url)
  }
}
