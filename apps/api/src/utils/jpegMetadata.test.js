import { describe, expect, it } from 'vitest'
import { Buffer } from 'node:buffer'
import { isJpeg, stripJpegMetadata } from './jpegMetadata.js'

// 一个带长度的段：FF <marker> <长度含自身两字节> <内容>
const segment = (marker, body) => {
  const payload = Buffer.from(body)
  const head = Buffer.from([0xff, marker, 0, 0])
  head.writeUInt16BE(payload.length + 2, 2)
  return Buffer.concat([head, payload])
}
const SOI = Buffer.from([0xff, 0xd8])
const JFIF = segment(0xe0, 'JFIF\u0000')
const EXIF = segment(0xe1, 'Exif\u0000\u0000GPS 31.2304N 121.4737E')
const XMP = segment(0xe1, 'http://ns.adobe.com/xap/1.0/ <exif:GPSLatitude>31</exif:GPSLatitude>')
const ICC = segment(0xe2, 'ICC_PROFILE\u0000sRGB')
const IPTC = segment(0xed, 'Photoshop 3.0 location')
const COMMENT = segment(0xfe, 'shot at home')
const ADOBE = segment(0xee, 'Adobe')
const DQT = segment(0xdb, [0, 1, 2, 3])
// 图像数据：SOS 段头 + 压缩数据（含 FF 00 填充与 RST 标记）+ EOI，一个字节都不能动
const SCAN = Buffer.from([0xff, 0xda, 0x00, 0x04, 0x01, 0x00, 0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56, 0xff, 0xd9])

describe('去掉 JPEG 里的拍摄信息', () => {
  it('去掉 EXIF、XMP、IPTC 与注释，保留解码要用的段，图像数据原样', () => {
    const original = Buffer.concat([SOI, JFIF, EXIF, XMP, ICC, IPTC, COMMENT, ADOBE, DQT, SCAN])
    const stripped = stripJpegMetadata(original)

    expect(stripped).toEqual(Buffer.concat([SOI, JFIF, ICC, ADOBE, DQT, SCAN]))
    for (const secret of ['GPS', 'GPSLatitude', 'location', 'shot at home']) expect(stripped.includes(secret)).toBe(false)
    expect(stripped.subarray(stripped.indexOf(SCAN))).toEqual(SCAN)
  })

  it('本来就干净的 JPEG 原样返回；段间的 0xFF 填充不影响', () => {
    const clean = Buffer.concat([SOI, JFIF, DQT, SCAN])
    expect(stripJpegMetadata(clean)).toEqual(clean)
    const padded = Buffer.concat([SOI, Buffer.from([0xff]), EXIF, DQT, SCAN])
    expect(stripJpegMetadata(padded).includes('GPS')).toBe(false)
  })

  it('不是 JPEG、被截断、没有图像数据的一律拒绝', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    expect(isJpeg(png)).toBe(false)
    expect(() => stripJpegMetadata(png)).toThrow(expect.objectContaining({ statusCode: 400 }))
    const truncated = Buffer.concat([SOI, EXIF]).subarray(0, 10)
    expect(() => stripJpegMetadata(truncated)).toThrow(expect.objectContaining({ statusCode: 400 }))
    expect(() => stripJpegMetadata(Buffer.concat([SOI, JFIF, DQT]))).toThrow(expect.objectContaining({ statusCode: 400 }))
    const badLength = Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x01, 0xff, 0xd9])
    expect(() => stripJpegMetadata(badLength)).toThrow(expect.objectContaining({ statusCode: 400 }))
    expect(() => stripJpegMetadata('not a buffer')).toThrow(expect.objectContaining({ statusCode: 400 }))
  })
})
