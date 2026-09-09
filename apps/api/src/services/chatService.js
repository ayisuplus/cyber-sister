/**
 * 对话服务：归属校验、外部回退授权、危机阻断和消息事务。
 */
import prisma from '../prisma/client.js'
import { findOwned, HttpError } from '../utils/dbHelpers.js'
import {
  generateResponse,
  generateResponseStream,
  generateLocalTemplateResponse,
  generateCompanionNote,
  retrieveRelevantMemories,
  MAX_MEMORY_CHARS,
  detectCrisis,
} from './llmService.js'
import { getCrisisIntervention } from './detection.js'
import {
  WORK_MODE_PREAMBLE,
  buildToolSystemPrompt,
  executeToolCallOnce as executeToolCall,
  parseCompleteToolCall,
} from './agentService.js'
import { createCrisisLog } from './crisisService.js'
import { maybeAutoAnalyze } from './derivedService.js'
import { embedQuery } from './embeddingService.js'
import { EXTERNAL_LLM_CONSENT_VERSION } from './userService.js'
import logger from '../utils/logger.js'
import { saveChatImage, deleteChatImages } from './chatImageService.js'

const MAX_HISTORY_MESSAGES = 19
// 记忆注入上限：按重要度/更新时间截断，避免全量载入撑爆上下文
const MAX_MEMORIES_FOR_PROMPT = 200
const DEFAULT_CONVERSATION_PAGE_SIZE = 20
const MAX_CONVERSATION_PAGE_SIZE = 50
const DEFAULT_MESSAGE_PAGE_SIZE = 50
const MAX_MESSAGE_PAGE_SIZE = 100

function normalizePagination(page, limit, defaultLimit, maxLimit) {
  const normalizedPage = Number.isInteger(page) && page > 0 ? page : 1
  const normalizedLimit = Number.isInteger(limit) && limit > 0
    ? Math.min(limit, maxLimit)
    : defaultLimit
  return { skip: (normalizedPage - 1) * normalizedLimit, take: normalizedLimit }
}

export async function listConversations(userId, { page, limit } = {}) {
  const { skip, take } = normalizePagination(
    page, limit, DEFAULT_CONVERSATION_PAGE_SIZE, MAX_CONVERSATION_PAGE_SIZE,
  )
  const conversations = await prisma.conversation.findMany({
    where: { userId },
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    skip,
    take,
    include: {
      messages: {
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 1,
      },
    },
  })
  // 纯图消息无文本：列表预览降级为占位符，避免空白一条
  for (const conversation of conversations) {
    const last = conversation.messages?.[0]
    if (last && !last.content && last.imageExt) last.content = '[图片]'
  }
  return conversations
}

export async function createConversation(userId, { title = 'Amie', mode = 'chat' } = {}) {
  if (!['chat', 'work'].includes(mode)) throw new HttpError('模式必须是 chat 或 work', 400)
  const conversation = await prisma.conversation.create({
    data: { userId, title, mode },
  })
  logger.info('新建会话', { conversationId: conversation.id, userId, mode })
  return conversation
}

export async function getConversation(conversationId, userId, { page, limit } = {}) {
  const messagePagination = normalizePagination(
    page, limit, DEFAULT_MESSAGE_PAGE_SIZE, MAX_MESSAGE_PAGE_SIZE,
  )
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, userId },
    include: {
      // 倒序取页：第 1 页永远是最新一批消息（前端不传分页参数时最新消息可见），
      // skip 继续向更早翻页；取回后恢复旧到新，响应形状不变
      messages: {
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...messagePagination,
      },
    },
  })
  if (!conversation) throw new HttpError('会话不存在', 404)
  conversation.messages.reverse()
  return conversation
}

export async function deleteConversation(conversationId, userId) {
  await findOwned('conversation', conversationId, userId, '会话')
  const imageMessages = await prisma.message.findMany({
    where: { conversationId, imageExt: { not: null } },
    select: { id: true },
  })
  await prisma.conversation.delete({ where: { id: conversationId } })
  // best-effort：落盘清理失败不阻塞删除
  await deleteChatImages(userId, imageMessages.map((m) => m.id))
    .catch((error) => logger.error('聊天图片清理失败', { error: error.message }))
  logger.info('删除会话', { conversationId, userId })
}

async function persistTurn(conversationId, userId, content, response, toolRuns = [], image = null) {
  const result = await prisma.$transaction(async (tx) => {
    const userMessage = await tx.message.create({
      data: { conversationId, role: 'user', content },
    })
    const aiMessage = await tx.message.create({
      data: {
        conversationId,
        role: 'assistant',
        content: response.content,
        emotion: response.emotion,
        source: response.source,
        // 有工具执行的轮次在消息上留下动作摘要（界面渲染动作标签）
        ...(toolRuns.length > 0 ? { toolRuns } : {}),
      },
    })
    await tx.conversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    })
    return { userMessage, aiMessage }
  })

  if (image) {
    try {
      const ext = await saveChatImage(userId, result.userMessage.id, image)
      await prisma.message.update({ where: { id: result.userMessage.id }, data: { imageExt: ext } })
      result.userMessage.imageExt = ext
    } catch (error) {
      // 写盘失败降级为纯文本消息，不丢已到手的 AI 回复
      logger.error('聊天图片落盘失败', { userId, messageId: result.userMessage.id, error: error.message })
    }
  }

  return result
}

async function persistBlockedCrisis(conversationId, userId, content, level) {
  const intervention = getCrisisIntervention(level)
  const result = await prisma.$transaction(async (tx) => {
    const userMessage = await tx.message.create({
      data: { conversationId, role: 'user', content },
    })
    await tx.message.create({
      data: {
        conversationId,
        role: 'assistant',
        content: intervention.message,
        emotion: 'concerned',
        source: 'local_template',
      },
    })
    await createCrisisLog(tx, { userId, level, handled: true })
    await tx.conversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    })
    return { userMessage }
  })

  return {
    status: 'blocked',
    userMessage: result.userMessage,
    intervention,
  }
}

/** 用户同意装配 + 历史/记忆查询，JSON 与流式路径共用同一套语义。 */
async function loadModelContext(conversationId, userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      persona: true,
      externalLlmConsent: true,
      externalLlmConsentVersion: true,
      roleName: true,
      roleSetting: true,
    },
  })
  if (!user) throw new HttpError('用户不存在', 404)

  const allowExternal = user.externalLlmConsent === true
    && user.externalLlmConsentVersion === EXTERNAL_LLM_CONSENT_VERSION
  const modelOptions = { allowExternal }
  if (allowExternal) {
    modelOptions.authorizeExternal = async () => {
      const currentConsent = await prisma.user.findUnique({
        where: { id: userId },
        select: { externalLlmConsent: true, externalLlmConsentVersion: true },
      })
      return currentConsent?.externalLlmConsent === true
        && currentConsent.externalLlmConsentVersion === EXTERNAL_LLM_CONSENT_VERSION
    }
  }

  // 数据库按倒序只取最近 19 条，之后恢复成旧到新；当前消息由 llmService 追加一次。
  const [descendingHistory, memories, derivedInsights, canonicalEdges] = await Promise.all([
    prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
      take: MAX_HISTORY_MESSAGES,
      select: { role: true, content: true },
    }),
    prisma.memory.findMany({
      where: {
        userId,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      orderBy: [{ importance: 'desc' }, { updatedAt: 'desc' }],
      take: MAX_MEMORIES_FOR_PROMPT,
      select: { id: true, content: true, type: true, importance: true, tags: true, embedding: true },
    }),
    prisma.derivedInsight.findMany({
      where: { userId, status: 'active' },
      orderBy: { createdAt: 'desc' },
      take: 3,
      select: { kind: true, content: true, confidence: true },
    }),
    prisma.memoryEdge.findMany({
      where: { userId, status: 'canonical' },
      select: { fromMemoryId: true, toMemoryId: true },
    }),
  ])

  // 一跳联想：canonical 边 join 上记忆内容；边引用已过期/未入选记忆即丢弃——只联想必填上下文内的内容
  const contentById = new Map(memories.map((memory) => [memory.id, memory.content]))
  const memoryEdges = []
  for (const edge of canonicalEdges) {
    const fromContent = contentById.get(edge.fromMemoryId)
    const toContent = contentById.get(edge.toMemoryId)
    if (fromContent === undefined || toContent === undefined) continue
    memoryEdges.push({ fromMemoryId: edge.fromMemoryId, toMemoryId: edge.toMemoryId, fromContent, toContent })
  }

  return { user, modelOptions, history: [...descendingHistory].reverse(), memories, derivedInsights, memoryEdges }
}

const STRATEGY_INSTRUCTION = '你是聊天回复的内部策略参谋。根据给出的环境信息与用户消息，先斟酌本轮的沟通策略。只输出策略要点，不超过 120 字：语气基调、共情与直接的取舍、是否追问、需要避开的边界。不要撰写回复本身，不要与用户对话。'

const timeOfDay = (hour) => (hour < 6 ? '凌晨' : hour < 12 ? '上午' : hour < 18 ? '下午' : '晚上')

/** 隐藏前置斟酌：产出本轮沟通策略 system 消息；任何失败静默降级为 null，绝不阻断聊天。 */
async function deliberateCommunicationStrategy(content, { mode, persona, memories }, modelOptions, requestId) {
  const relevant = retrieveRelevantMemories(content, memories, modelOptions.queryEmbedding).slice(0, 3)
  const memoryLines = relevant.map((m) => `- ${String(m.content).slice(0, MAX_MEMORY_CHARS)}`).join('\n')
  const envLines = [
    `环境：对话模式=${mode === 'work' ? '工作' : '聊天'}；陪伴人格=${persona}；当前时段=${timeOfDay(new Date().getHours())}`,
    ...(memoryLines ? [`相关记忆：\n${memoryLines}`] : []),
    `用户消息：${content}`,
  ]
  try {
    const strategy = await generateCompanionNote(
      { persona, instruction: STRATEGY_INSTRUCTION, userText: envLines.join('\n'), maxTokens: 200, temperature: 0.3, timeoutMs: 12000 },
      requestId,
      modelOptions,
    )
    logger.debug('沟通策略斟酌完成', { requestId, strategyChars: strategy.content.length })
    return { role: 'system', content: `本轮沟通的内部策略要点（供你把握语气与节奏，禁止在回复中提及或复述）：${strategy.content}` }
  } catch {
    return null
  }
}

/**
 * 发送消息。
 *
 * 正常模型回复成功前不写入当前消息，因此超时/供应商失败可以安全重试；
 * 危机分支例外，它必须先于同意检查并以单个事务留下完整干预记录。
 */
export async function sendMessage(conversationId, userId, rawContent, requestId, { image = null } = {}) {
  const conversation = await findOwned('conversation', conversationId, userId, '会话')
  const content = rawContent.trim()

  const crisisLevel = content ? detectCrisis(content) : null
  if (crisisLevel) {
    logger.warn('检测到危机内容', { userId, conversationId, crisisLevel })
    return persistBlockedCrisis(conversationId, userId, content, crisisLevel)
  }

  const { user, modelOptions, history, memories, derivedInsights, memoryEdges } = await loadModelContext(conversationId, userId)
  // 语义投影注入：查询向量失败返回 null 即回退关键词路径；两者经 ...modelOptions 零签名改动直达 generate
  modelOptions.queryEmbedding = await embedQuery(content, modelOptions.allowExternal)
  modelOptions.memoryEdges = memoryEdges

  const strategySystem = await deliberateCommunicationStrategy(
    content,
    { mode: conversation.mode || 'chat', persona: user.persona, memories },
    modelOptions,
    requestId,
  )

  const aiResponse = await runAgentTurns(content, user.persona, history, memories, requestId, modelOptions, userId, conversation.mode, rolePlaySystem(user, conversation.mode || 'chat'), strategySystem, derivedInsights, image)
  const { toolRuns: _toolRuns, ...responsePayload } = aiResponse
  const saved = await persistTurn(conversationId, userId, content, responsePayload, aiResponse.toolRuns, image)
  // 工作台自动分析：fire-and-forget，绝不阻塞或失败聊天
  void maybeAutoAnalyze(userId, requestId).catch((error) => logger.warn('工作台分析失败', { requestId, error: error.message }))

  logger.debug('消息发送成功', {
    requestId,
    conversationId,
    userId,
    source: responsePayload.source,
    provider: responsePayload.provider,
    model: responsePayload.model,
    toolRuns: aiResponse.toolRuns.length,
  })
  return { status: 'ok', ...saved, source: responsePayload.source }
}

const MAX_AGENT_TOOL_ROUNDS = 3

// 照片点评引导：发图轮注入，约束人格直接给具体可执行的穿搭/妆容/状态点评
const IMAGE_REVIEW_NUDGE = '用户这轮发来一张照片（她可能想听穿搭/妆容/状态的具体点评）。请直接看着照片给出具体、可执行的点评（颜色/版型/搭配/气色），保持你的人格语气，不要推托说看不见。'

/** 角色扮演设定：与人格叠加，仅聊天场景注入；工作模式、本地兜底模板与短评管线不带角色。 */
function rolePlaySystem(user, mode) {
  if (mode === 'work' || !user.roleName || !user.roleSetting) return null
  return {
    role: 'system',
    content: `角色扮演设定：用户希望你扮演「${user.roleName}」。设定：${user.roleSetting}。在人格语气与安全边界之内保持这个角色身份；被问到真实身份时仍坦承自己是 AI。`,
  }
}

/**
 * 智能体回路（参考 pi-agent-core 的 agent loop，按本产品安全模型收敛）：
 * 模型整段回复为注册工具 JSON 时执行之并把结果以 system 消息回喂，最多 3 轮；
 * 上限后追加一次强制文本轮，仍输出工具 JSON 则以本地模板兜底。
 * 返回 { ...generateResponse 结果, toolRuns }。
 */
async function runAgentTurns(content, persona, history, memories, requestId, modelOptions, userId, mode = 'chat', roleSystem = null, strategySystem = null, derivedInsights = [], image = null) {
  const toolRuns = []
  let toolRounds = 0
  const executedSignatures = new Set()
  const scene = mode === 'work' ? 'work' : 'chat'
  const toolPrompt = mode === 'work'
    ? `${WORK_MODE_PREAMBLE}\n${buildToolSystemPrompt('work')}`
    : buildToolSystemPrompt('chat')
  const extraSystem = [...(roleSystem ? [roleSystem] : []), ...(strategySystem ? [strategySystem] : []), { role: 'system', content: toolPrompt }]
  if (image) extraSystem.push({ role: 'system', content: IMAGE_REVIEW_NUDGE })
  let loopHistory = history
  let forcedFinal = false
  for (;;) {
    // 工具回路由串行轮次构成，每轮依赖上一轮执行结果。
    // eslint-disable-next-line no-await-in-loop
    const aiResponse = await generateResponse(
      content,
      persona,
      loopHistory,
      memories,
      requestId,
      { ...modelOptions, extraSystem, scene, derivedInsights, ...(image ? { image } : {}) },
    )
    const call = parseCompleteToolCall(aiResponse.content)
    if (!call) return { ...aiResponse, toolRuns }
    if (forcedFinal) {
      // 强制文本轮仍输出工具 JSON：不落工具、以本地模板兜底回复
      return { ...generateLocalTemplateResponse(content, persona, scene), toolRuns }
    }
    // eslint-disable-next-line no-await-in-loop
    const run = await executeToolCall(userId, call, executedSignatures, mode)
    toolRounds += 1
    if (!run.deduplicated) toolRuns.push({ tool: run.tool, ok: run.ok, summary: run.summary })
    loopHistory = [...loopHistory, { role: 'assistant', content: aiResponse.content }]
    extraSystem.push({ role: 'system', content: run.feedback })
    if (toolRounds >= MAX_AGENT_TOOL_ROUNDS) {
      extraSystem.push({ role: 'system', content: '工具调用已达上限，请直接用正常语气回复用户，不要再输出工具 JSON。' })
      forcedFinal = true
    }
  }
}

/**
 * 流式发送消息。
 *
 * 与 sendMessage 共用归属校验、危机阻断、同意装配和事务边界；
 * 区别是只有收到 done（完整成功且最终过滤通过）后才落库一组消息，
 * 断线/取消/中途 error 绝不写入当前消息。
 *
 * 产出事件：
 *   { type: 'blocked', status: 'blocked', userMessage, intervention }  危机阻断（已落库）
 *   { type: 'sentence', text } / { type: 'replace', content, source }  透传 llmService
 *   { type: 'done', status: 'ok', userMessage, aiMessage, source }     落库后的最终结果
 *   { type: 'error', reason }                                          固定错误码，不落库
 */
export async function* sendMessageStream(conversationId, userId, rawContent, requestId, { signal, image = null } = {}) {
  const conversation = await findOwned('conversation', conversationId, userId, '会话')
  const content = rawContent.trim()

  const crisisLevel = content ? detectCrisis(content) : null
  if (crisisLevel) {
    logger.warn('检测到危机内容', { userId, conversationId, crisisLevel })
    const blocked = await persistBlockedCrisis(conversationId, userId, content, crisisLevel)
    yield { type: 'blocked', ...blocked }
    return
  }

  const { user, modelOptions, history, memories, derivedInsights, memoryEdges } = await loadModelContext(conversationId, userId)
  modelOptions.queryEmbedding = await embedQuery(content, modelOptions.allowExternal)
  modelOptions.memoryEdges = memoryEdges
  const toolRuns = []
  let toolRounds = 0
  const executedSignatures = new Set()
  const mode = conversation.mode || 'chat'
  const strategySystem = await deliberateCommunicationStrategy(
    content,
    { mode, persona: user.persona, memories },
    modelOptions,
    requestId,
  )
  const scene = mode === 'work' ? 'work' : 'chat'
  const toolPrompt = mode === 'work'
    ? `${WORK_MODE_PREAMBLE}\n${buildToolSystemPrompt('work')}`
    : buildToolSystemPrompt('chat')
  const roleSystem = rolePlaySystem(user, mode)
  const extraSystem = [...(roleSystem ? [roleSystem] : []), ...(strategySystem ? [strategySystem] : []), { role: 'system', content: toolPrompt }]
  if (image) extraSystem.push({ role: 'system', content: IMAGE_REVIEW_NUDGE })
  let loopHistory = history
  let forcedFinal = false

  for (;;) {
    let toolcall = null
    let doneEvent = null
    // 单轮流式：sentence/replace/error 透传；toolcall/done 由回路接管
    // eslint-disable-next-line no-await-in-loop
    for await (const event of generateResponseStream(
      content,
      user.persona,
      loopHistory,
      memories,
      requestId,
      { ...modelOptions, signal, extraSystem, scene, derivedInsights, ...(image ? { image } : {}) },
    )) {
      if (event.type === 'toolcall') { toolcall = event; break }
      if (event.type === 'done') { doneEvent = event; break }
      yield event
    }

    if (doneEvent) {
      let finalEvent = doneEvent
      if (forcedFinal && parseCompleteToolCall(doneEvent.content)) {
        // 强制文本轮仍输出工具 JSON：替换为本地安全模板后落库
        const template = generateLocalTemplateResponse(content, user.persona, scene)
        yield { type: 'replace', content: template.content, source: template.source }
        finalEvent = { ...doneEvent, content: template.content, source: template.source }
      }
      // eslint-disable-next-line no-await-in-loop
      const saved = await persistTurn(conversationId, userId, content, finalEvent, toolRuns, image)
      // 工作台自动分析：fire-and-forget，绝不阻塞或失败聊天
      void maybeAutoAnalyze(userId, requestId).catch((error) => logger.warn('工作台分析失败', { requestId, error: error.message }))
      logger.debug('消息发送成功', {
        requestId,
        conversationId,
        userId,
        source: finalEvent.source,
        provider: finalEvent.provider,
        model: finalEvent.model,
        toolRuns: toolRuns.length,
      })
      yield { type: 'done', status: 'ok', ...saved, source: finalEvent.source }
      return
    }

    // 取消/安静结束/error 已透传：不落库，直接收尾
    if (!toolcall || forcedFinal) return

    // eslint-disable-next-line no-await-in-loop
    const run = await executeToolCall(userId, toolcall, executedSignatures, mode)
    toolRounds += 1
    if (!run.deduplicated) toolRuns.push({ tool: run.tool, ok: run.ok, summary: run.summary })
    loopHistory = [
      ...loopHistory,
      { role: 'assistant', content: JSON.stringify({ tool: toolcall.name, args: toolcall.args }) },
    ]
    extraSystem.push({ role: 'system', content: run.feedback })
    if (toolRounds >= MAX_AGENT_TOOL_ROUNDS) {
      extraSystem.push({ role: 'system', content: '工具调用已达上限，请直接用正常语气回复用户，不要再输出工具 JSON。' })
      forcedFinal = true
    }
  }
  // 流安静结束（取消）或 error：未收到 done，不落库。
}
