import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { deleteAsset, readAsset, saveAsset } from './userAssetService.js'

describe('userAssetService', () => {
  let root
  let env

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'user-assets-'))
    env = { USER_ASSET_DIR: root }
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('非法 slot 与非法 mime 均 400', async () => {
    await expect(saveAsset('u1', 'banner', { buffer: Buffer.from('x'), mime: 'image/png' }, env))
      .rejects.toMatchObject({ statusCode: 400, message: '不支持的形象槽位' })
    await expect(saveAsset('u1', 'avatar', { buffer: Buffer.from('x'), mime: 'image/gif' }, env))
      .rejects.toMatchObject({ statusCode: 400, message: '仅支持 JPEG/PNG/WebP 图片' })
    await expect(readAsset('u1', 'banner', env))
      .rejects.toMatchObject({ statusCode: 400, message: '不支持的形象槽位' })
    await expect(deleteAsset('u1', 'banner', env))
      .rejects.toMatchObject({ statusCode: 400, message: '不支持的形象槽位' })
  })

  it('保存后可读回；png 换 jpg 覆盖后旧扩展名文件被删除', async () => {
    const png = Buffer.from([0x89, 0x50, 1, 2, 3])
    const saved = await saveAsset('u1', 'avatar', { buffer: png, mime: 'image/png' }, env)
    expect(saved.url).toMatch(/^\/api\/user\/assets\/avatar\?v=\d+$/)

    const read = await readAsset('u1', 'avatar', env)
    expect(read.mime).toBe('image/png')
    expect(read.buffer.equals(png)).toBe(true)

    const jpg = Buffer.from([0xff, 0xd8, 9, 9])
    await saveAsset('u1', 'avatar', { buffer: jpg, mime: 'image/jpeg' }, env)
    expect(await readdir(join(root, 'u1'))).toEqual(['avatar.jpg'])

    const reRead = await readAsset('u1', 'avatar', env)
    expect(reRead.mime).toBe('image/jpeg')
    expect(reRead.buffer.equals(jpg)).toBe(true)
  })

  it('readAsset 未设置 → 404 未设置', async () => {
    await expect(readAsset('u1', 'bg-home', env))
      .rejects.toMatchObject({ statusCode: 404, message: '未设置' })
  })

  it('deleteAsset 幂等：不存在也成功；存在则清空', async () => {
    await expect(deleteAsset('u1', 'avatar', env)).resolves.toBeUndefined()

    await saveAsset('u1', 'avatar', { buffer: Buffer.from('x'), mime: 'image/webp' }, env)
    await deleteAsset('u1', 'avatar', env)
    await expect(readAsset('u1', 'avatar', env))
      .rejects.toMatchObject({ statusCode: 404, message: '未设置' })
  })

  it('恶意 userId 净化后仍落在资产根目录内', async () => {
    await saveAsset('../../etc', 'avatar', { buffer: Buffer.from('x'), mime: 'image/png' }, env)

    expect(await readdir(root)).toEqual(['______etc'])
    const read = await readAsset('../../etc', 'avatar', env)
    expect(read.mime).toBe('image/png')
  })
})
