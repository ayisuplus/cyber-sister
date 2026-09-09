import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import logger from '../utils/logger.js'
import { saveChatImage, readChatImage, deleteChatImages } from './chatImageService.js'

const PNG = Buffer.from([0x89, 0x50, 1, 2, 3])

describe('chatImageService', () => {
  let root
  let env

  beforeEach(async () => {
    vi.clearAllMocks()
    root = await mkdtemp(join(tmpdir(), 'chat-images-'))
    env = { CHAT_IMAGE_DIR: root }
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('保存后可读回：扩展名落文件名、mime 正确、字节一致', async () => {
    const ext = await saveChatImage('u1', 'msg-1', { buffer: PNG, mime: 'image/png' }, env)
    expect(ext).toBe('.png')
    expect(await readFile(join(root, 'u1', 'msg-1.png'))).toEqual(PNG)

    const { buffer, mime } = await readChatImage('u1', 'msg-1', '.png', env)
    expect(buffer).toEqual(PNG)
    expect(mime).toBe('image/png')
  })

  it('恶意 userId 净化为安全目录段，不发生路径穿越', async () => {
    const ext = await saveChatImage('../../evil', 'msg-2', { buffer: PNG, mime: 'image/jpeg' }, env)
    expect(ext).toBe('.jpg')
    const sanitized = join(root, '______evil', 'msg-2.jpg')
    expect(await readFile(sanitized)).toEqual(PNG)
    // 根目录之外不产生任何文件
    expect(await readdir(root)).toEqual(['______evil'])
  })

  it('不支持的 mime → 400', async () => {
    await expect(saveChatImage('u1', 'msg-3', { buffer: PNG, mime: 'image/gif' }, env))
      .rejects.toMatchObject({ statusCode: 400 })
    expect(await readdir(root)).toEqual([])
  })

  it('读不存在的图片 → 404', async () => {
    await expect(readChatImage('u1', 'nope', '.jpg', env))
      .rejects.toMatchObject({ statusCode: 404 })
  })

  it('deleteChatImages 幂等：清掉存在的扩展名，缺失静默带过并记日志', async () => {
    await saveChatImage('u1', 'msg-4', { buffer: PNG, mime: 'image/webp' }, env)
    await deleteChatImages('u1', ['msg-4', 'msg-missing'], env)
    expect(await readdir(join(root, 'u1'))).toEqual([])
    expect(logger.info).toHaveBeenCalledWith('聊天图片清理', { userId: 'u1', count: 2 })
    // 再删一次也不炸
    await deleteChatImages('u1', ['msg-4'], env)
  })
})
