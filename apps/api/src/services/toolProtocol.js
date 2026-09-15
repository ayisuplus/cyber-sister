/**
 * 纯工具协议：只识别模型输出，不依赖工具目录、数据库或外部服务。
 * 注册与模式校验由执行层负责，未知工具名也交给执行层反馈。
 */
const TOOLCALL_PARSE_CAP = 4096
export const MAX_TOOL_REPLY_CHARS = 256000
const FC_OPEN_TAG = '<dots_function_call>'
const FC_CLOSE_TAG = '</dots_function_call>'

/** 字符串感知的括号配平：返回首个完整 JSON 对象的结束索引（不含），未配平返回 -1。 */
function balancedJsonEnd(text) {
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) return i
      if (depth < 0) return -1
    }
  }
  return -1
}

/**
 * 解析 dots 的另一种原生工具变体（非 JSON）：
 * <tool_call><function name="web_search"><parameter name="query">…</parameter></function>
 * 流式下只有看到 </function> 才判定为完整调用，此前保持待定（超上限按自然语言放行）。
 */
function classifyNativeXmlToolCall(text) {
  const fnMatch = text.match(/<function\s+name="([^"]+)">/)
  if (!fnMatch || !text.includes('</function>')) {
    return text.length >= MAX_TOOL_REPLY_CHARS ? 'natural' : 'pending'
  }
  const args = {}
  const paramRe = /<parameter\s+name="([^"]+)">([\s\S]*?)<\/parameter>/g
  let m
  while ((m = paramRe.exec(text)) !== null) args[m[1]] = m[2]
  // 未注册的名字也照常返回，executeToolCall 会回喂"未知工具"引导改写
  return { name: fnMatch[1], args }
}

/**
 * 流式前缀分类：判定累计文本是工具调用还是自然语言。
 * 返回 'natural' | 'pending' | { name, args }。
 * 协议要求工具回复以 { 开头且整段为单个 JSON 对象，因此首个非空白字符即可分流。
 */
export function classifyToolPrefix(text) {
  let trimmed = text.replace(/^\s+/, '')
  // 空白-only 分片（推理模型常见：先吐换行/空格）必须保持待定，否则会误判自然语言放行工具 JSON
  if (!trimmed) return 'pending'
  // dots 原生工具标记（JSON 包装与 XML 变体）的半截前缀一律待定，等后续分片分流，
  // 否则首字符 < 会被误判自然语言、把整段协议文本泄漏给用户。代码块围栏同理。
  if (FC_OPEN_TAG.startsWith(trimmed) || '<tool_call>'.startsWith(trimmed) || '```'.startsWith(trimmed)) return 'pending'
  if (trimmed.startsWith('```')) {
    // 模型偶发把工具调用包进 ```json 代码块：剥掉开围栏行后递归判定内部内容
    const nl = trimmed.indexOf('\n')
    if (nl === -1) return trimmed.length >= TOOLCALL_PARSE_CAP ? 'natural' : 'pending'
    const inner = trimmed.slice(nl + 1).replace(/^\s+/, '')
    if (!inner) return 'pending'
    return classifyToolPrefix(inner)
  }
  if (trimmed.startsWith(FC_OPEN_TAG)) {
    // <dots_function_call> 包装：剥掉标签再按内部内容判定（内部可能是 JSON 或 XML 变体）
    const closeIdx = trimmed.indexOf(FC_CLOSE_TAG)
    trimmed = (closeIdx === -1 ? trimmed.slice(FC_OPEN_TAG.length) : trimmed.slice(FC_OPEN_TAG.length, closeIdx)).replace(/^\s+/, '')
    if (!trimmed) return closeIdx === -1 ? 'pending' : 'natural'
    if (trimmed.startsWith('<')) return classifyNativeXmlToolCall(trimmed)
  } else if (trimmed.startsWith('<tool_call')) {
    return classifyNativeXmlToolCall(trimmed)
  }
  if (!trimmed.startsWith('{')) return 'natural'
  const end = balancedJsonEnd(trimmed)
  if (end === -1) {
    const cap = /^\{\s*"/.test(trimmed) ? MAX_TOOL_REPLY_CHARS : TOOLCALL_PARSE_CAP
    return trimmed.length >= cap ? 'natural' : 'pending'
  }
  try {
    const parsed = JSON.parse(trimmed.slice(0, end + 1))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return 'natural'
    if (typeof parsed.tool === 'string') {
      // 带 tool 字段但名字未注册：也按工具调用处理，executeToolCall 会回喂"未知工具"引导模型改写
      const args = parsed.args && typeof parsed.args === 'object' && !Array.isArray(parsed.args) ? parsed.args : {}
      return { name: parsed.tool, args }
    }
    // 设计权衡：助手整段输出一个纯 JSON 对象（如 {"query":"..."}）几乎必然是畸形的工具调用，
    // 直接放行会把内部协议泄漏给用户。
    // 宽容纠正：对象恰好只有一个字符串 query 键时，显然是忘了 wrapper 的搜索意图，
    // 直接纠正为 web_search（模型先验发作时的自愈路径）；
    // 其余形状统一拦截为 __malformed__，executeToolCall 回喂"未知工具，请直接回复用户"，
    // 模型下一轮会改写成自然语言。副作用：用户真想要一段 JSON 示例时会被多绕一轮，可接受。
    const keys = Object.keys(parsed)
    if (keys.length === 1 && typeof parsed.query === 'string' && parsed.query.trim()) {
      return { name: 'web_search', args: { query: parsed.query.trim() } }
    }
    return { name: '__malformed__', args: parsed }
  } catch {
    return /^\{\s*"tool"\s*:/.test(trimmed) && trimmed.length < MAX_TOOL_REPLY_CHARS ? 'pending' : 'natural'
  }
}

/** 完整回复解析：只接受一个完整调用，前缀分类结果本身不能授权执行。 */
export function parseCompleteToolCall(content) {
  if (typeof content !== 'string' || content.length > MAX_TOOL_REPLY_CHARS) return null
  let trimmed = content.trim()
  if (trimmed.startsWith('```')) {
    const fenced = trimmed.match(/^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/)
    if (!fenced) return null
    trimmed = fenced[1].trim()
  }
  if (trimmed.startsWith(FC_OPEN_TAG)) {
    trimmed = trimmed.slice(FC_OPEN_TAG.length).trim()
    if (trimmed.endsWith(FC_CLOSE_TAG)) trimmed = trimmed.slice(0, -FC_CLOSE_TAG.length).trim()
  }
  if (trimmed.startsWith('<tool_call>') || trimmed.startsWith('<function ')) {
    // 兼容已用供应商省略外层闭合标签/追加 </invoke> 的格式，正文必须完整匹配。
    const native = trimmed.match(/^(?:<tool_call>\s*)?<function\s+name="([^"]+)">((?:\s*<parameter\s+name="[^"]+">(?:(?!<\/parameter>)[\s\S])*<\/parameter>)*\s*)(?:<\/invoke>\s*)?<\/function>\s*(?:<\/tool_call>)?$/)
    if (!native) return null
    const args = Object.fromEntries([...native[2].matchAll(/<parameter\s+name="([^"]+)">([\s\S]*?)<\/parameter>/g)].map((match) => [match[1], match[2]]))
    return { name: native[1], args }
  }
  try {
    // JSON.parse 检查整段，拒绝“工具 JSON + 示例解释”和串接的第二个调用。
    if (!trimmed.startsWith('{')) return null
    JSON.parse(trimmed)
  } catch {
    return null
  }
  const verdict = classifyToolPrefix(trimmed)
  return verdict === 'natural' || verdict === 'pending' ? null : verdict
}

/** Invalid tool-shaped output is feedback for repair, never an executable call or a delivered answer. */
export function parseToolReply(content) {
  const complete = parseCompleteToolCall(content)
  if (complete) return complete
  if (typeof content !== 'string') return null
  const trimmed = content.trim()
  // A complete JSON example followed by explanation is ordinary text, never a tool invocation.
  if (trimmed.startsWith('{')) {
    const end = balancedJsonEnd(trimmed)
    if (end >= 0 && trimmed.slice(end + 1).trim()) {
      try { JSON.parse(trimmed.slice(0, end + 1)); return null } catch { /* Invalid envelope still needs repair. */ }
    }
  }
  if (/<dots_function_call>|<tool_call>/.test(content)
    || /^\s*(?:\{\s*"tool"\s*:|```(?:json)?\s*\n\s*\{\s*"tool"\s*:)/.test(content)) {
    return { name: '__malformed__', args: {} }
  }
  return null
}
