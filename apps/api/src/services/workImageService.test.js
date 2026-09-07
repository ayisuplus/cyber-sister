import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { generateWorkImage, readWorkImage, resolveWorkImagePath } from './workImageService.js'

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4])

const jsonResponse = (data, ok = true) => ({ ok, json: async () => data })
const pngResponse = (bytes) => ({
  ok: true,
  headers: { get: () => 'image/png' },
  arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
})

/** 按 URL 分发 ComfyUI 桩响应：system_stats → prompt → history → view。 */
function comfyStub(state = {}) {
  return vi.fn(async (url) => {
    if (url.endsWith('/system_stats')) return jsonResponse({})
    if (url.endsWith('/prompt')) return jsonResponse({ prompt_id: 'p1' })
    if (url.includes('/history/')) {
      return jsonResponse({
        p1: {
          status: { status_str: state.error ? 'error' : 'success', completed: !state.error },
          outputs: state.error ? {} : { 9: { images: [{ filename: 'out.png', type: 'output' }] } },
        },
      })
    }
    if (url.includes('/view?')) return pngResponse(PNG_BYTES)
    throw new Error(`unexpected url ${url}`)
  })
}

describe('workImageService.generateWorkImage', () => {
  let workImageDir
  let env

  beforeEach(async () => {
    vi.stubGlobal('fetch', comfyStub())
    workImageDir = await mkdtemp(join(tmpdir(), 'work-img-'))
    env = {
      IMAGE_GEN_BASE_URL: 'http://127.0.0.1:8188',
      WORK_IMAGE_DIR: workImageDir,
    }
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    await rm(workImageDir, { recursive: true, force: true })
  })

  it('描述为空或超长 → 400，不发起任何上游调用', async () => {
    await expect(generateWorkImage('u1', '   ', undefined, { env })).rejects.toMatchObject({ statusCode: 400, message: '画面描述无效' })
    await expect(generateWorkImage('u1', 'x'.repeat(501), undefined, { env })).rejects.toMatchObject({ statusCode: 400 })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('未配置 IMAGE_GEN_BASE_URL → 503 未配置', async () => {
    await expect(generateWorkImage('u1', 'a cat', undefined, { env: { WORK_IMAGE_DIR: workImageDir } }))
      .rejects.toMatchObject({ statusCode: 503, message: '生图能力未配置本机 ComfyUI 地址' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('ComfyUI 离线 → 503 暂不可用', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED') }))
    await expect(generateWorkImage('u1', 'a cat', undefined, { env }))
      .rejects.toMatchObject({ statusCode: 503 })
  })

  it('成功链路：提交工作流 → 轮询历史 → 取图落盘，imageId 可按用户读回', async () => {
    const { imageId } = await generateWorkImage('u1', 'a ginger cat on a desk', 'req-1', { env })

    expect(imageId).toMatch(/^[0-9a-f-]{36}\.png$/)
    // 工作流提交内容与默认 checkpoint
    const promptCall = fetch.mock.calls.find(([url]) => url.endsWith('/prompt'))
    const workflow = JSON.parse(promptCall[1].body).prompt
    expect(workflow['4'].inputs.ckpt_name).toBe('XL-epicrealismXL_vxviLastfameRealism.safetensors')
    expect(workflow['6'].inputs.text).toBe('a ginger cat on a desk')

    const roundtrip = await readWorkImage('u1', imageId, env)
    expect(Buffer.compare(roundtrip, PNG_BYTES)).toBe(0)
    // 其他用户读不到
    await expect(readWorkImage('u2', imageId, env)).rejects.toMatchObject({ statusCode: 404 })
  })

  it('ComfyUI 执行失败 → 503', async () => {
    vi.stubGlobal('fetch', comfyStub({ error: true }))
    await expect(generateWorkImage('u1', 'a cat', undefined, { env })).rejects.toMatchObject({ statusCode: 503 })
  })
})

describe('workImageService.resolveWorkImagePath', () => {
  it('非法文件名与路径穿越一律 null', () => {
    expect(resolveWorkImagePath('u1', 'not-a-png', process.env)).toBeNull()
    expect(resolveWorkImagePath('u1', '../secret.png', process.env)).toBeNull()
    expect(resolveWorkImagePath('u1', '0'.repeat(36) + '.png', process.env)).toBeNull()
    expect(resolveWorkImagePath('u1', 'a1b2c3d4-e5f6-4710-8899-aabbccddeeff.png', process.env)).not.toBeNull()
  })
})
