import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const llm = vi.hoisted(() => ({ generateExplanationWithModel: vi.fn() }))
const fsWrites = vi.hoisted(() => ({
  writeFileSync: vi.fn(),
  createWriteStream: vi.fn(),
  writeFile: vi.fn(),
}))

vi.mock('./llmService.js', () => ({
  generateExplanationWithModel: llm.generateExplanationWithModel,
  redactSensitiveText: (value) => value,
}))
vi.mock('../utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))
// 照片绝不落盘：拦截 fs 写入口，断言零调用
vi.mock('node:fs', () => ({
  default: {},
  writeFileSync: fsWrites.writeFileSync,
  createWriteStream: fsWrites.createWriteStream,
}))
vi.mock('node:fs/promises', () => ({
  default: {},
  writeFile: fsWrites.writeFile,
}))

import {
  buildPromptForItem,
  getImageGenStatus,
  requestGeneration,
  IMAGE_GEN_NOT_CONFIGURED,
  IMAGE_GEN_NOT_IMPLEMENTED,
  IMAGE_GEN_UNAVAILABLE,
} from './imageGenService.js'

const COMFY_ENV = {
  IMAGE_GEN_BASE_URL: 'http://127.0.0.1:8188',
  IMAGE_GEN_MODEL: 'epicrealism-inpaint',
}

const KOLORS_ENV = {
  IMAGE_GEN_BASE_URL: 'http://127.0.0.1:8188',
  IMAGE_GEN_MODEL: 'kolors-vton',
}

const EXTERNAL_ENV = {
  IMAGE_GEN_PROVIDER: 'external',
  IMAGE_GEN_BASE_URL: 'https://image-gen.internal',
  IMAGE_GEN_MODEL: 'model-x',
  IMAGE_GEN_API_KEY_FILE: '/run/secrets/image_gen_key',
}

const OUTPUT_BYTES = new Uint8Array([137, 80, 78, 71]).buffer

// 按 URL 路由的假 ComfyUI：upload → prompt → history → view 四件套
function stubComfyFetch({ online = true, samNode = true, kolorsNode = false, historyEntry, uploadOk = true } = {}) {
  const state = { uploadForm: null, workflow: null }
  const fetchMock = vi.fn((url, options = {}) => {
    const target = String(url)
    if (!online) return Promise.reject(new TypeError('fetch failed'))
    if (target.includes('/system_stats')) return Promise.resolve({ ok: true })
    if (target.includes('/object_info/KolorsVirtualTryOn')) return Promise.resolve({ ok: kolorsNode })
    if (target.includes('/object_info/SAM3_Detect')) return Promise.resolve({ ok: samNode })
    if (target.includes('/upload/image')) {
      state.uploadForm = options.body
      return Promise.resolve({ ok: uploadOk, json: () => Promise.resolve({ name: 'uploaded.png', subfolder: '', type: 'input' }) })
    }
    if (target.includes('/prompt')) {
      state.workflow = JSON.parse(options.body).prompt
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ prompt_id: 'p-1' }) })
    }
    if (target.includes('/history/')) {
      const entry = historyEntry === undefined
        ? {
            'p-1': {
              status: { completed: true, status_str: 'success' },
              outputs: { save: { images: [{ filename: 'out.png', subfolder: '', type: 'output' }] } },
            },
          }
        : historyEntry
      return Promise.resolve({ ok: true, json: () => Promise.resolve(entry) })
    }
    if (target.includes('/view?')) {
      return Promise.resolve({
        ok: true,
        headers: new Headers({ 'content-type': 'image/png' }),
        arrayBuffer: () => Promise.resolve(OUTPUT_BYTES),
      })
    }
    return Promise.reject(new Error(`unexpected fetch: ${target}`))
  })
  vi.stubGlobal('fetch', fetchMock)
  return { fetchMock, state }
}

const PHOTO = {
  photoBuffer: Buffer.from('fake-photo-bytes'),
  photoName: '自拍.png',
  photoMime: 'image/png',
}

async function expectHttpError(promise, statusCode, code) {
  const error = await promise.catch((caught) => caught)
  expect(error).toBeInstanceOf(Error)
  expect(error.statusCode).toBe(statusCode)
  if (code) expect(error.code).toBe(code)
  return error
}

beforeEach(() => {
  vi.clearAllMocks()
  llm.generateExplanationWithModel.mockResolvedValue({ content: 'peach eye shadow, glossy lips, photorealistic' })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('getImageGenStatus', () => {
  it('comfy 默认：BASE_URL/MODEL 未配置 → configured=false, NOT_CONFIGURED', async () => {
    const { fetchMock } = stubComfyFetch()
    expect(await getImageGenStatus({})).toEqual({
      available: false,
      configured: false,
      provider: 'comfy',
      reason: IMAGE_GEN_NOT_CONFIGURED,
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('comfy：MODEL 取值非法视为未配置', async () => {
    expect(await getImageGenStatus({ IMAGE_GEN_BASE_URL: 'http://127.0.0.1:8188', IMAGE_GEN_MODEL: 'nope' })).toEqual({
      available: false,
      configured: false,
      provider: 'comfy',
      reason: IMAGE_GEN_NOT_CONFIGURED,
    })
  })

  it('comfy：配置齐且 ComfyUI 在线 → available=true, reason=null', async () => {
    stubComfyFetch()
    expect(await getImageGenStatus(COMFY_ENV)).toEqual({
      available: true,
      configured: true,
      provider: 'comfy',
      reason: null,
    })
  })

  it('comfy：配置齐但 ComfyUI 离线 → available=false, IMAGE_GEN_UNAVAILABLE', async () => {
    stubComfyFetch({ online: false })
    expect(await getImageGenStatus(COMFY_ENV)).toEqual({
      available: false,
      configured: true,
      provider: 'comfy',
      reason: IMAGE_GEN_UNAVAILABLE,
    })
  })

  it('comfy + kolors-vton：缺 KolorsVirtualTryOn 节点 → IMAGE_GEN_UNAVAILABLE', async () => {
    stubComfyFetch({ kolorsNode: false })
    expect(await getImageGenStatus(KOLORS_ENV)).toEqual({
      available: false,
      configured: true,
      provider: 'comfy',
      reason: IMAGE_GEN_UNAVAILABLE,
    })
  })

  it('external：保留旧行为——三件套配齐也恒不可用（NOT_IMPLEMENTED）', async () => {
    expect(await getImageGenStatus(EXTERNAL_ENV)).toEqual({
      available: false,
      configured: true,
      provider: 'external',
      reason: IMAGE_GEN_NOT_IMPLEMENTED,
    })
    expect(await getImageGenStatus({ IMAGE_GEN_PROVIDER: 'external' })).toEqual({
      available: false,
      configured: false,
      provider: 'external',
      reason: IMAGE_GEN_NOT_CONFIGURED,
    })
  })
})

describe('buildPromptForItem', () => {
  it('默认走主模型改写，返回英文提示词', async () => {
    const prompt = await buildPromptForItem('makeup', 'peach-date', '甜一点', 'req-1')
    expect(prompt).toBe('peach eye shadow, glossy lips, photorealistic')
    const instruction = llm.generateExplanationWithModel.mock.calls[0][0]
    expect(instruction).toContain('蜜桃约会妆')
    expect(instruction).toContain('甜一点')
    expect(instruction).toContain('不要输出任何人脸身份改写指令')
  })

  it('主模型失败 → 目录描述直拼的确定性回退', async () => {
    llm.generateExplanationWithModel.mockRejectedValue(new Error('llm down'))
    const prompt = await buildPromptForItem('fitting', 'khaki-trench')
    expect(prompt).toBe('经典双排扣，春秋的主力外套。, soft natural look, photorealistic, preserve face identity, same pose, same background')
  })

  it('未知 itemId → 400', async () => {
    await expectHttpError(buildPromptForItem('makeup', 'not-a-look'), 400)
  })
})

describe('requestGeneration', () => {
  it('未配置 / external / 缺照片 / kolors 留缝：分别在进入 ComfyUI 前拒绝', async () => {
    const { fetchMock } = stubComfyFetch()

    await expectHttpError(requestGeneration({ scene: 'makeup', itemId: 'peach-date', ...PHOTO }, 'req', { env: {} }), 503, IMAGE_GEN_NOT_CONFIGURED)
    await expectHttpError(requestGeneration({ scene: 'makeup', itemId: 'peach-date', ...PHOTO }, 'req', { env: EXTERNAL_ENV }), 503, IMAGE_GEN_NOT_CONFIGURED)
    const noPhoto = await expectHttpError(
      requestGeneration({ scene: 'makeup', itemId: 'peach-date' }, 'req', { env: COMFY_ENV }),
      400,
    )
    expect(noPhoto.message).toBe('请先上传照片')
    await expectHttpError(requestGeneration({ scene: 'fitting', itemId: 'khaki-trench', ...PHOTO }, 'req', { env: KOLORS_ENV }), 503, IMAGE_GEN_UNAVAILABLE)
    await expectHttpError(requestGeneration({ scene: 'makeup', itemId: 'not-a-look', ...PHOTO }, 'req', { env: COMFY_ENV }), 400)

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('成功路径：upload → prompt → history → view，返回 data URL，照片不落盘', async () => {
    const { state } = stubComfyFetch()

    const result = await requestGeneration(
      { scene: 'makeup', itemId: 'peach-date', note: '甜一点', ...PHOTO },
      'req-1',
      { env: COMFY_ENV },
    )

    expect(result.scene).toBe('makeup')
    expect(result.itemId).toBe('peach-date')
    expect(result.provider).toBe('comfy')
    expect(result.imageDataUrl).toMatch(/^data:image\/png;base64,/)

    // 提示词来自主模型改写
    expect(state.workflow.positive.inputs.text).toBe('peach eye shadow, glossy lips, photorealistic')
    // SAM3 可用 → 蒙版 inpaint 路径，化妆去噪 0.45
    expect(state.workflow.mask.class_type).toBe('SAM3_Detect')
    expect(state.workflow.mask.inputs.conditioning).toEqual(['samText', 0])
    expect(state.workflow.encode.class_type).toBe('VAEEncodeForInpaint')
    expect(state.workflow.sample.inputs.denoise).toBe(0.8)
    // 照片经 FormData 只发往本机 ComfyUI
    expect(state.uploadForm.get('image')).toBeTruthy()
    // 不落盘
    expect(fsWrites.writeFileSync).not.toHaveBeenCalled()
    expect(fsWrites.createWriteStream).not.toHaveBeenCalled()
    expect(fsWrites.writeFile).not.toHaveBeenCalled()
  })

  it('主模型失败时提示词退化为目录描述模板，流程仍走通', async () => {
    llm.generateExplanationWithModel.mockRejectedValue(new Error('llm down'))
    const { state } = stubComfyFetch()

    const result = await requestGeneration(
      { scene: 'fitting', itemId: 'khaki-trench', ...PHOTO },
      'req-2',
      { env: COMFY_ENV },
    )

    expect(result.imageDataUrl).toMatch(/^data:image\/png;base64,/)
    expect(state.workflow.positive.inputs.text).toBe(
      '经典双排扣，春秋的主力外套。, soft natural look, photorealistic, preserve face identity, same pose, same background',
    )
    // 试衣蒙版文本与去噪强度
    expect(state.workflow.samText.inputs.text).toBe('shirt clothing upper body')
    expect(state.workflow.sample.inputs.denoise).toBe(0.75)
  })

  it('SAM3 节点缺失 → 退化为全图 i2i（无蒙版，去噪更低）', async () => {
    const { state } = stubComfyFetch({ samNode: false })

    await requestGeneration({ scene: 'makeup', itemId: 'peach-date', ...PHOTO }, 'req-3', { env: COMFY_ENV })

    expect(state.workflow.mask).toBeUndefined()
    expect(state.workflow.encode.class_type).toBe('VAEEncode')
    expect(state.workflow.sample.inputs.denoise).toBe(0.35)
  })

  it('上传失败 / 执行报错 / 超时：统一 503 IMAGE_GEN_UNAVAILABLE', async () => {
    stubComfyFetch({ uploadOk: false })
    await expectHttpError(
      requestGeneration({ scene: 'makeup', itemId: 'peach-date', ...PHOTO }, 'req', { env: COMFY_ENV }),
      503,
      IMAGE_GEN_UNAVAILABLE,
    )

    stubComfyFetch({ historyEntry: { 'p-1': { status: { status_str: 'error' } } } })
    await expectHttpError(
      requestGeneration({ scene: 'makeup', itemId: 'peach-date', ...PHOTO }, 'req', { env: COMFY_ENV }),
      503,
      IMAGE_GEN_UNAVAILABLE,
    )

    stubComfyFetch({ historyEntry: {} })
    const timeoutError = await expectHttpError(
      requestGeneration({ scene: 'makeup', itemId: 'peach-date', ...PHOTO }, 'req', { env: COMFY_ENV, timeoutMs: 30, pollIntervalMs: 1 }),
      503,
      IMAGE_GEN_UNAVAILABLE,
    )
    expect(timeoutError.message).toBe('本地生图超时，请重试')
  })

  it('ComfyUI 中途离线 → 503 IMAGE_GEN_UNAVAILABLE', async () => {
    stubComfyFetch({ online: false })
    await expectHttpError(
      requestGeneration({ scene: 'makeup', itemId: 'peach-date', ...PHOTO }, 'req', { env: COMFY_ENV }),
      503,
      IMAGE_GEN_UNAVAILABLE,
    )
  })
})
