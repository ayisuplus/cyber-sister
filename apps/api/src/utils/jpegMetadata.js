/**
 * 去掉 JPEG 里说明性的段：APP1（EXIF、XMP，拍摄位置和相机信息都在这里）、APP3–APP13（含 IPTC）、APP15 和注释段。
 * 保留解码要用的 APP0（JFIF）、APP2（色彩配置）、APP14（Adobe 色彩变换），图像数据（SOS 之后）一个字节不动。
 * 浏览器压缩时已经重绘过一遍；这里在服务器上再兜一次底，「去掉拍摄位置」才站得住。
 */
import { Buffer } from 'node:buffer'
import { HttpError } from './dbHelpers.js'

const SOS = 0xda
const EOI = 0xd9
const COM = 0xfe
const KEPT_APP_SEGMENTS = new Set([0xe0, 0xe2, 0xee])

const invalid = () => new HttpError('这张图片读不了，请换一张', 400)
// 没有长度字段的标记：TEM 与 RST0–RST7
const isStandalone = (marker) => marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)
const isDescriptive = (marker) => marker === COM || (marker >= 0xe0 && marker <= 0xef && !KEPT_APP_SEGMENTS.has(marker))

/** 文件开头是不是 JPEG 的签名（FF D8 FF）。 */
export function isJpeg(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
}

/** @param {Buffer} buffer @returns {Buffer} 去掉说明性段之后的 JPEG；不是完整的 JPEG 时抛 400。 */
export function stripJpegMetadata(buffer) {
  if (!isJpeg(buffer)) throw invalid()
  const kept = [buffer.subarray(0, 2)]
  let offset = 2
  while (offset + 1 < buffer.length) {
    if (buffer[offset] !== 0xff) throw invalid()
    // 段与段之间允许多个 0xFF 填充
    let at = offset
    while (at + 1 < buffer.length && buffer[at + 1] === 0xff) at += 1
    const marker = buffer[at + 1]
    if (marker === undefined) throw invalid()
    if (marker === SOS || marker === EOI) {
      kept.push(buffer.subarray(at))
      return Buffer.concat(kept)
    }
    if (isStandalone(marker)) {
      kept.push(buffer.subarray(at, at + 2))
      offset = at + 2
      continue
    }
    if (at + 4 > buffer.length) throw invalid()
    const end = at + 2 + buffer.readUInt16BE(at + 2)
    if (end < at + 4 || end > buffer.length) throw invalid()
    if (!isDescriptive(marker)) kept.push(buffer.subarray(at, end))
    offset = end
  }
  // 没有图像数据
  throw invalid()
}
