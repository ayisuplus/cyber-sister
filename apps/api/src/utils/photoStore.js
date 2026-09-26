/**
 * 收藏与花草图鉴共用的照片存储：<根目录>/<userId>/<id>.jpg 与 <id>.thumb.jpg，行内只记 imageExt。
 * 只收 JPEG（手机上先压缩好），存之前再去一遍拍摄信息；先写临时文件再改名，同时在读的请求不会读到半张图。
 */
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { HttpError } from './dbHelpers.js'
import { stripJpegMetadata } from './jpegMetadata.js'

export const PHOTO_EXT = '.jpg'
export const MAX_PHOTO_BYTES = 3 * 1024 * 1024
export const MAX_THUMB_BYTES = 512 * 1024
const KINDS = ['photo', 'thumb']

// 与 chatImageService 相同的用户目录名净化：杜绝路径穿越
const sanitizeUserSegment = (userId) => String(userId ?? '').replace(/[^a-zA-Z0-9-]/g, '_')
const fileName = (id, kind) => `${id}${kind === 'thumb' ? '.thumb' : ''}${PHOTO_EXT}`

/** 照片和缩略图要一起来；都去掉拍摄信息。没有照片时返回 null。 */
export function preparePhotoPair(files = {}) {
  const photo = files.photo?.[0]?.buffer
  const thumb = files.thumb?.[0]?.buffer
  if (!photo && !thumb) return null
  if (!photo || !thumb) throw new HttpError('照片和缩略图要一起上传', 400)
  if (photo.length > MAX_PHOTO_BYTES || thumb.length > MAX_THUMB_BYTES) throw new HttpError('这张照片太大了，请换一张', 400)
  return { photo: stripJpegMetadata(photo), thumb: stripJpegMetadata(thumb) }
}

/** @param {(env: Record<string, string | undefined>) => string} rootDirOf 按环境变量给出根目录 */
export function createPhotoStore(rootDirOf) {
  const userDir = (env, userId) => join(rootDirOf(env), sanitizeUserSegment(userId))

  return {
    async write(env, userId, id, images) {
      const dir = userDir(env, userId)
      await mkdir(dir, { recursive: true })
      await Promise.all(KINDS.map(async (kind) => {
        const target = join(dir, fileName(id, kind))
        const tmpPath = `${target}.${randomUUID()}.tmp`
        await writeFile(tmpPath, images[kind])
        await rename(tmpPath, target)
      }))
    },

    remove(env, userId, id) {
      return Promise.all(KINDS.map((kind) => rm(join(userDir(env, userId), fileName(id, kind)), { force: true })))
    },

    /** 文件不在就返回 null。 */
    read(env, userId, id, kind) {
      return readFile(join(userDir(env, userId), fileName(id, kind === 'thumb' ? 'thumb' : 'photo'))).catch(() => null)
    },
  }
}
