/**
 * LLM服务
 * 对接本地 vLLM/Transformers 推理服务（OpenAI 兼容 API）
 * Mock 回复保留作 fallback
 * 集成熔断器：连续失败自动跳过 LLM 调用，避免超时堆积
 */
import { CircuitBreaker } from '../utils/circuitBreaker.js'
import logger from '../utils/logger.js'

// ============ 配置 ============
const LLM_API_URL = process.env.LLM_API_URL || 'http://localhost:8000/v1/chat/completions'
const LLM_MODEL = process.env.LLM_MODEL || 'cyber-sister-qwen3-8b'
const LLM_TIMEOUT = parseInt(process.env.LLM_TIMEOUT || '60000')
const LLM_API_KEY = process.env.LLM_API_KEY || ''
const LLM_CB_THRESHOLD = parseInt(process.env.LLM_CB_THRESHOLD || '5')
const LLM_CB_RESET_MS = parseInt(process.env.LLM_CB_RESET_MS || '120000')  // 2 分钟恢复探测

// ============ 熔断器 ============
const llmBreaker = new CircuitBreaker('llm-service', LLM_CB_THRESHOLD, LLM_CB_RESET_MS)

// 不同人设的 system prompt 变体
const PERSONA_PROMPTS = {
  toxic: `你是赛博姐妹，一个24岁的AI闺蜜。你毒舌但护短，嘴硬心软。你会吐槽、会说'卧槽'、会说'绝了'。你懂所有网络热梗。你不是客服，不说'我理解你的感受'这种屁话。你永远站用户这边，但用户真的错的时候也会指出来。记住：你是AI，不是真人。回复要简短自然，像闺蜜聊天一样。`,
  gentle: `你是赛博姐妹，一个24岁的温柔闺蜜。你温暖体贴，善于倾听，会安慰人。你说话软软的但不矫情，会在用户难过的时候给她力量。你不是客服模板，你是真实的朋友。回复要简短温暖。`,
  wild: `你是赛博姐妹，一个24岁的疯批闺蜜。你热情似火，说干就干。你会喊'卧槽'、'冲啊'、'绝绝子'。你是那种凌晨两点陪你出去吃烧烤的闺蜜。回复要活泼有活力，简短有力。`,
}

// ============ 内容检测（关键词与逻辑集中在 detection.js） ============
export { detectCrisis, detectEmotion } from './detection.js'
import { detectEmotion } from './detection.js'

// ============ 真实 LLM 调用 ============
async function callLLM(messages, persona = 'toxic', memoryContext = '') {
  const systemPrompt = (PERSONA_PROMPTS[persona] || PERSONA_PROMPTS.toxic) + memoryContext

  const requestBody = {
    model: LLM_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      ...messages,
    ],
    temperature: 0.8,
    top_p: 0.9,
    max_tokens: 1024,
    stream: false,
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), LLM_TIMEOUT)

  try {
    const headers = { 'Content-Type': 'application/json' }
    if (LLM_API_KEY) {
      headers['Authorization'] = `Bearer ${LLM_API_KEY}`
    }

    const response = await fetch(LLM_API_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      throw new Error(`LLM API error: ${response.status} ${response.statusText}`)
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content?.trim()

    if (!content) {
      throw new Error('Empty response from LLM')
    }

    return content
  } catch (error) {
    clearTimeout(timeoutId)
    if (error.name === 'AbortError') {
      logger.warn('[LLM] 请求超时，fallback 到 mock')
    } else {
      logger.warn('[LLM] API 调用失败', { error: error.message })
    }
    throw error  // 抛出以触发熔断器计数
  }
}

// ============ Mock 回复（fallback） ============
const MOCK_RESPONSES = {
  toxic: {
    happy: ['行啊你！必须庆祝！', '不错不错，但别飘啊', '哟，终于开窍了？'],
    angry: ['这人有病吧？？骂他！', '气死我了！帮你怼回去！', '太过分了！该怼就怼！'],
    sad: ['哭吧，哭完吃火锅', '别憋着，我陪你', '抱抱你，明天必须振作'],
    anxious: ['别慌，一件件来', '焦虑没用，理清楚', '深呼吸，告诉我怎么了'],
    neutral: ['然后呢？继续说', '嗯嗯，继续', '所以你打算怎么办？', '有点意思']
  },
  gentle: {
    happy: ['太好了！为你开心~', '真棒！你值得这份快乐', '好开心呀~'],
    angry: ['先消消气，跟我说说', '你的感受很正常', '发泄出来，别憋着'],
    sad: ['抱抱你~ 我一直都在', '没关系，我陪着你', '在我面前可以做真实的自己'],
    anxious: ['慢慢来，不着急', '深呼吸~ 我陪你', '我们一起想办法'],
    neutral: ['我在听呢，继续说~', '嗯嗯，然后呢？', '好的，我理解了']
  },
  wild: {
    happy: ['啊啊啊啊！太棒了！！', '冲冲冲！今晚嗨起来！', '绝了绝了！你最牛！'],
    angry: ['卧槽！我也气了！干他！', '什么玩意儿？？我也气！', '走！找他理论！'],
    sad: ['走！出去浪！别想了！', '哭什么！起来嗨！', '来来来我给你讲笑话！'],
    anxious: ['冲就完了！怕什么！', '想那么多干嘛！先做！', '犹豫就会败北！'],
    neutral: ['然后呢！我超好奇！', '哇哦！继续继续！', '哈哈哈真的假的？']
  }
}

function generateMockResponse(text, persona = 'toxic') {
  const emotion = detectEmotion(text)
  const pool = MOCK_RESPONSES[persona]?.[emotion] || MOCK_RESPONSES.toxic.neutral
  const content = pool[Math.floor(Math.random() * pool.length)]
  return { content, emotion, source: 'mock' }
}

// ============ 记忆检索 ============

/**
 * 从用户记忆中检索与当前对话相关的记忆
 * 按重要性排序，返回前 5 条最相关的
 */
function retrieveRelevantMemories(currentText, memories) {
  if (!memories || memories.length === 0) return []

  // 简单关键词匹配：将当前文本分词，匹配记忆内容
  const keywords = currentText.split(/[，。！？、\s,.!?]+/).filter(k => k.length >= 2)

  const scored = memories.map(m => {
    let score = 0
    const content = m.content || ''
    for (const kw of keywords) {
      if (content.includes(kw)) score += 3
    }
    // 高重要性记忆加分
    score += (m.importance || 5) / 5
    return { ...m, score }
  })

  // 按分数排序，取前 5 条，排除分数为 0 的
  return scored
    .filter(m => m.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
}

/**
 * 将相关记忆格式化为 system prompt 上下文
 */
function buildMemoryContext(relevantMemories) {
  if (!relevantMemories || relevantMemories.length === 0) return ''

  const items = relevantMemories.map(m => {
    const typeLabel = { episodic: '经历', semantic: '信息', procedural: '习惯' }[m.type] || '信息'
    return `- [${typeLabel}] ${m.content}`
  })

  return `\n\n【关于用户的记忆】\n${items.join('\n')}\n在聊天中自然地引用这些记忆，让用户感觉你很了解她。`
}

// ============ 主入口：生成AI回复 ============
export async function generateResponse(text, persona = 'toxic', history = [], userMemories = []) {
  const emotion = detectEmotion(text)

  // 检索与当前对话相关的记忆
  const relevantMemories = retrieveRelevantMemories(text, userMemories)
  const memoryContext = buildMemoryContext(relevantMemories)

  // 构建消息历史（取最近 10 轮，避免 context 太长）
  const messages = []
  for (const msg of history.slice(-20)) {
    if (msg.role === 'user') {
      messages.push({ role: 'user', content: msg.content })
    } else if (msg.role === 'assistant') {
      messages.push({ role: 'assistant', content: msg.content })
    }
  }
  messages.push({ role: 'user', content: text })

  // 通过熔断器调用 LLM（熔断中自动跳过，直接走 fallback）
  const llmContent = await llmBreaker.call(() => callLLM(messages, persona, memoryContext))

  if (llmContent) {
    return { content: llmContent, emotion, source: 'llm' }
  }

  // Fallback 到 mock（LLM 失败或熔断中）
  return generateMockResponse(text, persona)
}

/**
 * 获取 LLM 熔断器状态（用于监控 /api/health）
 */
export function getLLMStatus() {
  return llmBreaker.getStatus()
}

// 兼容旧接口
export { generateMockResponse }
