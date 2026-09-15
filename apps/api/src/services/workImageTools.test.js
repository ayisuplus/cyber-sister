import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('../prisma/client.js', () => ({ default: { workAction: { findFirst: vi.fn() }, workArtifact: { findFirst: vi.fn() } } }))
vi.mock('./runningHubService.js', async original => ({ ...await original(), uploadRunningHubImage: vi.fn(), submitRunningHubImage: vi.fn(), queryRunningHubImage: vi.fn(), downloadRunningHubImage: vi.fn() }))
import prisma from '../prisma/client.js'
import { WORK_IMAGE_TOOLS } from './workImageTools.js'
import { buildNativeTools, buildToolSystemPrompt } from './agentService.js'
import { uploadRunningHubImage, submitRunningHubImage, queryRunningHubImage, downloadRunningHubImage } from './runningHubService.js'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=', 'base64')
const taskId = '2099741730948743170'
const args = { workflow: 'text-to-image', prompt: '明亮的插画', seed: 42 }
let context, grant
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv('RUNNINGHUB_ENABLED', 'true'); vi.stubEnv('RUNNINGHUB_API_KEY', 'synthetic-key'); vi.stubEnv('WORK_NATIVE_TOOLS', 'true')
  grant = { id: 'action1', begin: vi.fn(), complete: vi.fn(), uncertain: vi.fn().mockResolvedValue(undefined) }
  const signal = new AbortController().signal
  context = { conversationId: 'c1', signal, workspace: { signal, artifacts: [], attachments: [] }, authorizeExternal: vi.fn().mockResolvedValue(true), requestMediaAction: vi.fn().mockResolvedValue(grant) }
  submitRunningHubImage.mockResolvedValue(taskId)
  queryRunningHubImage.mockResolvedValue({ status: 'SUCCESS', usage: {}, url: 'https://rh-images.xiaoyaoyou.com/result.png' })
  downloadRunningHubImage.mockResolvedValue(png)
})
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })

describe('Agent image tools', () => {
  it('exposes real native schemas only in enabled work mode', () => {
    expect(buildNativeTools('work').find(tool => tool.function.name === 'generate_image').function.parameters.required).toEqual(['workflow', 'prompt'])
    expect(buildNativeTools('chat')).toEqual([])
    vi.stubEnv('RUNNINGHUB_API_KEY', '')
    expect(buildNativeTools('work').some(tool => tool.function.name === 'generate_image')).toBe(false)
    expect(buildToolSystemPrompt('work')).toContain('尚未配置启用')
  })
  it('requires background approval and saves the ID before any result query or file staging', async () => {
    await expect(WORK_IMAGE_TOOLS.generate_image.run('u1', args, { ...context, requestMediaAction: null })).rejects.toThrow('后台执行')
    expect(submitRunningHubImage).not.toHaveBeenCalled()
    grant.complete.mockImplementation(async (status, id) => { expect(status).toBe(200); expect(id).toBe(taskId); expect(queryRunningHubImage).not.toHaveBeenCalled() })
    const result = await WORK_IMAGE_TOOLS.generate_image.run('u1', args, context)
    expect(result.result.status).toBe('SUCCESS'); expect(result.artifacts).toHaveLength(1)
    expect(context.workspace.artifacts[0]).toMatchObject({ format: 'png', origin: 'generated', encoding: 'base64', content: png.toString('base64') })
    const request = context.requestMediaAction.mock.calls[0][0]
    expect(request.body).toContain('API 实际用量计费'); expect(request.body).not.toContain('synthetic-key')
    expect(grant.begin).toHaveBeenCalledWith(request)
  })
  it('uploads only the selected owned attachment after approval, then maps it to node 4', async () => {
    context.workspace.attachments.push({ id: 'img1', title: '参考', format: 'png', encoding: 'base64', content: png.toString('base64') })
    uploadRunningHubImage.mockResolvedValue('uploaded.png')
    grant.begin.mockImplementation(() => { expect(uploadRunningHubImage).not.toHaveBeenCalled() })
    await WORK_IMAGE_TOOLS.generate_image.run('u1', { ...args, workflow: 'reference-edit', imageId: 'img1' }, context)
    expect(JSON.parse(context.requestMediaAction.mock.calls[0][0].body).reference).toMatchObject({ id: 'img1', name: '参考.png', sha256: expect.stringMatching(/^[a-f0-9]{64}$/) })
    expect(submitRunningHubImage.mock.calls[0][0].nodeInfoList).toContainEqual({ nodeId: '4', fieldName: 'image', fieldValue: 'uploaded.png' })
  })
  it('never uploads a file belonging to another conversation or user', async () => {
    prisma.workArtifact.findFirst.mockResolvedValue(null)
    await expect(WORK_IMAGE_TOOLS.generate_image.run('u1', { ...args, workflow: 'reference-edit', imageId: 'foreign' }, context)).rejects.toThrow('文件不存在')
    expect(prisma.workArtifact.findFirst).toHaveBeenCalledWith({ where: { id: 'foreign', userId: 'u1', conversationId: 'c1' } })
    expect(context.requestMediaAction).not.toHaveBeenCalled(); expect(uploadRunningHubImage).not.toHaveBeenCalled()
  })
  it('a rejected confirmation cannot upload or submit', async () => {
    context.requestMediaAction.mockRejectedValue(new Error('declined'))
    await expect(WORK_IMAGE_TOOLS.generate_image.run('u1', args, context)).rejects.toThrow('declined')
    expect(submitRunningHubImage).not.toHaveBeenCalled(); expect(uploadRunningHubImage).not.toHaveBeenCalled()
  })
  it('uncertain submission is marked once and never retried or staged', async () => {
    submitRunningHubImage.mockRejectedValue(new Error('unknown'))
    await expect(WORK_IMAGE_TOOLS.generate_image.run('u1', args, context)).rejects.toThrow('unknown')
    expect(submitRunningHubImage).toHaveBeenCalledTimes(1); expect(grant.uncertain).toHaveBeenCalledOnce()
    expect(grant.complete).not.toHaveBeenCalled(); expect(context.workspace.artifacts).toEqual([])
  })
  it('recovers owned provider IDs and never resubmits after a download failure', async () => {
    prisma.workAction.findFirst.mockResolvedValue({ id: 'action1', providerTaskId: taskId })
    downloadRunningHubImage.mockRejectedValueOnce(new Error('download failed'))
    await expect(WORK_IMAGE_TOOLS.get_generated_image.run('u1', {}, context)).rejects.toThrow('download failed')
    expect(context.workspace.artifacts).toEqual([])
    const result = await WORK_IMAGE_TOOLS.get_generated_image.run('u1', {}, context)
    expect(result.artifacts).toHaveLength(1)
    expect(prisma.workAction.findFirst.mock.calls[0][0].where.task).toEqual({ userId: 'u1', conversationId: 'c1' })
    expect(submitRunningHubImage).not.toHaveBeenCalled(); expect(context.requestMediaAction).not.toHaveBeenCalled()
  })
  it('does not misrepresent queued or failed tasks as generated images', async () => {
    prisma.workAction.findFirst.mockResolvedValue({ id: 'action1', providerTaskId: taskId })
    queryRunningHubImage.mockResolvedValue({ status: 'QUEUED', usage: {} })
    expect((await WORK_IMAGE_TOOLS.get_generated_image.run('u1', {}, context)).result.status).toBe('QUEUED')
    queryRunningHubImage.mockResolvedValue({ status: 'FAILED', usage: {} })
    expect((await WORK_IMAGE_TOOLS.get_generated_image.run('u1', {}, context)).ok).toBe(false)
    expect(context.workspace.artifacts).toEqual([]); expect(downloadRunningHubImage).not.toHaveBeenCalled()
  })
  it('cancellation during result download prevents late artifact writes', async () => {
    const controller = new AbortController(); context.signal = controller.signal; context.workspace.signal = controller.signal
    prisma.workAction.findFirst.mockResolvedValue({ id: 'action1', providerTaskId: taskId })
    downloadRunningHubImage.mockImplementation(async () => { controller.abort(); return png })
    await expect(WORK_IMAGE_TOOLS.get_generated_image.run('u1', {}, context)).rejects.toThrow()
    expect(context.workspace.artifacts).toEqual([])
  })
})
