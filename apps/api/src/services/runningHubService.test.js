import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { prepareImageRequest, uploadRunningHubImage, submitRunningHubImage, queryRunningHubImage, downloadRunningHubImage } from './runningHubService.js'

const taskId = '2099741730948743170'
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=', 'base64')
const json = value => new globalThis.Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })
const context = () => ({ signal: new AbortController().signal, authorizeExternal: vi.fn().mockResolvedValue(true) })
beforeEach(() => {
  vi.stubEnv('RUNNINGHUB_ENABLED', 'true'); vi.stubEnv('RUNNINGHUB_API_KEY', 'synthetic-runninghub-key')
  vi.stubGlobal('fetch', vi.fn())
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('RunningHub workflow API', () => {
  it('uses verified string IDs and typed field mappings, not model supplied workflow URLs or steps', () => {
    const { payload } = prepareImageRequest({ workflow: 'text-to-image', prompt: '测试插画', seed: 7, workflowId: 'evil', steps: 1000 })
    expect(payload).toEqual({ workflowId: '2099692630371299330', addMetadata: true, nodeInfoList: [
      { nodeId: '5', fieldName: 'text', fieldValue: '测试插画' }, { nodeId: '8', fieldName: 'seed', fieldValue: 7 },
      { nodeId: '7', fieldName: 'width', fieldValue: 1024 }, { nodeId: '7', fieldName: 'height', fieldValue: 1024 },
    ] })
    expect(prepareImageRequest({ workflow: 'reference-edit', prompt: '暖色口红', imageId: 'owned', seed: 3 }).payload)
      .toMatchObject({ workflowId: '2099730232960970754', instanceType: 'plus', nodeInfoList: [{ nodeId: '8', fieldName: 'prompt', fieldValue: '暖色口红' }, { nodeId: '13', fieldName: 'seed', fieldValue: 3 }] })
  })
  it.each([
    { workflow: 'unknown', prompt: 'x' }, { workflow: 'reference-edit', prompt: 'x' },
    { workflow: 'text-to-image', prompt: 'x', imageId: 'x' }, { workflow: 'text-to-image', prompt: 'x', seed: -1 },
    { workflow: 'text-to-image', prompt: 'x'.repeat(1201) },
  ])('rejects invalid generation inputs before any network call: %j', args => {
    expect(() => prepareImageRequest(args)).toThrow(); expect(fetch).not.toHaveBeenCalled()
  })
  it('uploads a selected binary as multipart with a neutral filename', async () => {
    fetch.mockResolvedValue(json({ code: 0, data: { fileName: 'input/reference.png' } }))
    expect(await uploadRunningHubImage(png, 'png', context())).toBe('input/reference.png')
    const [url, options] = fetch.mock.calls[0]
    expect(url).toBe('https://www.runninghub.cn/task/openapi/upload')
    expect(options.body.get('file').name).toBe('reference.png')
    expect(options.body.get('fileType')).toBe('input')
    expect(Buffer.from(await options.body.get('file').arrayBuffer())).toEqual(png)
    expect(options.redirect).toBe('error')
  })
  it('returns a string provider ID without exposing raw responses', async () => {
    fetch.mockResolvedValue(json({ code: 0, data: { taskId, taskStatus: 'QUEUED', netWssUrl: 'secret' } }))
    expect(await submitRunningHubImage(prepareImageRequest({ workflow: 'text-to-image', prompt: 'x' }).payload, context())).toBe(taskId)
    expect(JSON.parse(fetch.mock.calls[0][1].body).workflowId).toBe('2099692630371299330')
  })
  it('does not retry an uncertain charged submission or leak provider error bodies', async () => {
    fetch.mockRejectedValue(new Error('synthetic-runninghub-key secret gateway response'))
    await expect(submitRunningHubImage({}, context())).rejects.toThrow('不要重复生图')
    expect(fetch).toHaveBeenCalledTimes(1)
    fetch.mockResolvedValue(json({ code: 1, msg: 'synthetic-runninghub-key' }))
    await expect(submitRunningHubImage({}, context())).rejects.toThrow('不要重复提交')
  })
  it('rejects imprecise numeric task IDs and mismatched query IDs', async () => {
    fetch.mockResolvedValue(json({ code: 0, data: { taskId: Number(taskId) } }))
    await expect(submitRunningHubImage({}, context())).rejects.toThrow('有效云端任务编号')
    fetch.mockResolvedValue(json({ taskId: '1', status: 'SUCCESS' }))
    await expect(queryRunningHubImage(taskId, context())).rejects.toThrow('状态无法核实')
  })
  it('keeps pending, failed, missing costs and real zero distinct', async () => {
    fetch.mockResolvedValue(json({ taskId, status: 'RUNNING', usage: { consumeMoney: 0, thirdPartyConsumeMoney: '0.2', secret: 'hidden' } }))
    expect(await queryRunningHubImage(taskId, context())).toEqual({ status: 'RUNNING', usage: { consumeMoney: '0', thirdPartyConsumeMoney: '0.2' } })
    fetch.mockResolvedValue(json({ taskId, status: 'FAILED', errorMessage: 'secret' }))
    expect(await queryRunningHubImage(taskId, context())).toEqual({ status: 'FAILED', usage: {} })
  })
  it('checks consent and cancellation before every external request', async () => {
    const c = context(); c.authorizeExternal.mockResolvedValue(false)
    await expect(queryRunningHubImage(taskId, c)).rejects.toThrow('同意云端处理')
    const controller = new AbortController(); controller.abort()
    await expect(submitRunningHubImage({}, { ...context(), signal: controller.signal })).rejects.toThrow()
    expect(fetch).not.toHaveBeenCalled()
  })
  it.each(['http://rh-images.xiaoyaoyou.com/a.png', 'https://127.0.0.1/a.png', 'https://rh-images.xiaoyaoyou.com.evil.test/a.png', 'https://user:pass@rh-images.xiaoyaoyou.com/a.png'])('blocks untrusted output URL %s', async url => {
    await expect(downloadRunningHubImage(url, context())).rejects.toThrow('存储域名')
    expect(fetch).not.toHaveBeenCalled()
  })
  it('downloads a bounded PNG without sending API credentials to the CDN', async () => {
    fetch.mockResolvedValue(new globalThis.Response(png))
    expect(await downloadRunningHubImage('https://rh-images.xiaoyaoyou.com/a.png', context())).toEqual(png)
    expect(fetch.mock.calls[0][1]).not.toHaveProperty('headers')
    expect(fetch.mock.calls[0][1].redirect).toBe('error')
    fetch.mockResolvedValue(new globalThis.Response('fake png'))
    await expect(downloadRunningHubImage('https://rh-images.xiaoyaoyou.com/a.png', context())).rejects.toThrow('有效 PNG')
    fetch.mockResolvedValue(new globalThis.Response(png, { headers: { 'content-length': String(6 * 1024 * 1024) } }))
    await expect(downloadRunningHubImage('https://rh-images.xiaoyaoyou.com/a.png', context())).rejects.toThrow('大小限制')
  })
})
