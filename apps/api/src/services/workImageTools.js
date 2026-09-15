import { createHash } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import prisma from '../prisma/client.js'
import { HttpError } from '../utils/dbHelpers.js'
import { currentArtifact, artifactBuffer, stageGeneratedFiles } from './workArtifactService.js'
import { RUNNINGHUB_CREATE_URL, isRunningHubEnabled, prepareImageRequest, uploadRunningHubImage, submitRunningHubImage, queryRunningHubImage, downloadRunningHubImage } from './runningHubService.js'

const requireContext = context => {
  context.signal?.throwIfAborted()
  if (!context.workspace || !context.conversationId) throw new HttpError('请在工作会话使用图片工具', 400)
  if (!isRunningHubEnabled()) throw new HttpError('RunningHub 尚未配置，请管理员设置服务端 API Key 并启用', 400)
}

async function collectImage(actionId, taskId, context, wait = false) {
  const deadline = Date.now() + (wait ? 5 * 60 * 1000 : 0)
  let result
  do {
    // eslint-disable-next-line no-await-in-loop
    result = await queryRunningHubImage(taskId, context)
    if (!['QUEUED', 'RUNNING'].includes(result.status) || Date.now() >= deadline) break
    // eslint-disable-next-line no-await-in-loop
    await delay(5000, undefined, { signal: context.signal })
  } while (Date.now() < deadline)
  const metadata = { actionId, taskId, status: result.status, usage: result.usage }
  if (result.status !== 'SUCCESS') return { ok: result.status !== 'FAILED',
    summary: result.status === 'FAILED' ? '云端生图失败，请核对任务账单' : '云端仍在处理，任务编号已保存',
    result: { ...metadata, note: '使用 get_generated_image 查询此 actionId，不要重复提交生图。费用以 RunningHub 账单为准。' } }
  const buffer = await downloadRunningHubImage(result.url, context)
  const artifacts = stageGeneratedFiles(context.workspace, [{ name: `Amie-${taskId}.png`, base64: buffer.toString('base64') }])
  return { summary: '图片已生成并准备交付', artifacts, result: { ...metadata, artifacts, note: 'AI 生成结果；参考编辑可能改变局部细节，请查看图片核对。usage 仅含供应商返回值，未返回的费用未知。' } }
}

export const WORK_IMAGE_TOOLS = {
  generate_image: {
    description: '{"tool":"generate_image","args":{"workflow":"text-to-image|reference-edit","prompt":"完整生图或编辑要求，最多1200字","imageId":"仅编辑时必填，会话 PNG/JPG 文件 id","seed":20260915}} 使用 RunningHub 开源模型生图。文字生图为 1024 方图；编辑使用单张参考图。必须在后台任务中运行，用户确认提示词、所选图片和付费说明后才发送。每个任务只申请一次生图。返回图片文件才算生成完成；不支持视频、3D 或精确局部遮罩编辑。',
    run: async (userId, args, context) => {
      requireContext(context)
      if (!context.requestMediaAction) throw new HttpError('生图需要逐次确认，请使用工作模式的后台执行提交此需求', 400)
      const { definition, payload, imageId } = prepareImageRequest(args)
      const image = imageId ? await currentArtifact(userId, imageId, context) : null
      if (image && !['png', 'jpg'].includes(image.format)) throw new HttpError('参考图必须是当前会话的 PNG/JPG 文件', 400)
      const buffer = image ? artifactBuffer(image) : null
      const request = { url: RUNNINGHUB_CREATE_URL, method: 'POST', contentType: 'application/json',
        purpose: `RunningHub · ${definition.key === 'reference-edit' ? '参考图编辑（Plus）' : '文字生图（Standard）'} · 付费生成 1 张图片`,
        body: JSON.stringify({ workflow: definition.name, prompt: args.prompt.trim(), seed: payload.nodeInfoList.find(item => item.fieldName === 'seed').fieldValue,
          ...(image ? { reference: { id: image.id, name: `${image.title}.${image.format}`, sha256: createHash('sha256').update(buffer).digest('hex') } } : { width: 1024, height: 1024 }),
          billing: '确认后将提示词及所选参考图发送给 RunningHub，按 API 实际用量计费。无预先固定报价或金额硬上限；此前网页 RH 币消耗不是 API 报价。取消本地任务不保证云端停止或退款。' }, null, 2) }
      const grant = await context.requestMediaAction(request)
      let begun = false
      let taskId
      try {
        context.signal?.throwIfAborted()
        await grant.begin(request)
        begun = true
        if (image) {
          const fileName = await uploadRunningHubImage(buffer, image.format, context)
          payload.nodeInfoList.push({ ...definition.inputs.image, fieldValue: fileName })
        }
        taskId = await submitRunningHubImage(payload, context)
        await grant.complete(200, taskId)
      } catch (error) {
        if (begun) await grant.uncertain().catch(() => {})
        throw error
      }
      // Persist the provider ID before polling or downloading; a reconnect only queries this task.
      return collectImage(grant.id, taskId, context, true)
    },
  },
  get_generated_image: {
    volatile: true,
    description: '{"tool":"get_generated_image","args":{"actionId":"可选，生图确认记录 id；省略查询本会话最近一次"}} 查询已经提交的 RunningHub 生图，不会重新提交生成任务；完成后将图片作为会话文件交付。服务中断后也使用此工具找回，不能填写任意云端任务编号。',
    run: async (userId, { actionId }, context) => {
      requireContext(context)
      if (actionId !== undefined && (typeof actionId !== 'string' || !actionId || actionId.length > 100)) throw new HttpError('确认记录 id 无效', 400)
      const action = await prisma.workAction.findFirst({ where: { ...(actionId ? { id: actionId } : {}), provider: 'runninghub',
        providerTaskId: { not: null }, task: { userId, conversationId: context.conversationId } }, orderBy: { createdAt: 'desc' } })
      context.signal?.throwIfAborted()
      if (!action) throw new HttpError('当前会话尚无已保存编号的生图任务；结果不明时请先核对 RunningHub 账单', 404)
      return collectImage(action.id, action.providerTaskId, context)
    },
  },
}
