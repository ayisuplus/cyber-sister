import { describe, expect, it } from 'vitest'
import { classifyToolPrefix, parseCompleteToolCall, parseToolReply } from './toolProtocol.js'

describe('classifyToolPrefix', () => {
  it('classifies plain text as natural immediately', () => {
    expect(classifyToolPrefix('我')).toBe('natural')
    expect(classifyToolPrefix('  你好呀')).toBe('natural')
    expect(classifyToolPrefix('')).toBe('pending')
    expect(classifyToolPrefix('  \n ')).toBe('pending')
  })
  it('stays pending while the JSON object is incomplete', () => {
    expect(classifyToolPrefix('  {"tool":"add_t')).toBe('pending')
    expect(classifyToolPrefix('{"tool":"add_task","args":{"content":"还没写完')).toBe('pending')
  })

  it('parses a complete registered tool call with string-aware brace balancing', () => {
    const text = '{"tool":"add_task","args":{"content":"带}括号的}待办"}}'
    expect(classifyToolPrefix(text)).toEqual({ name: 'add_task', args: { content: '带}括号的}待办' } })
  })

  it('intercepts bare or malformed tool-shaped JSON instead of leaking it', () => {
    // 纯对象（无 tool 字段）视为畸形工具调用，拦截后回喂引导改写
    expect(classifyToolPrefix('{"foo":1}')).toEqual({ name: '__malformed__', args: { foo: 1 } })
    // 恰好一个字符串 query 键时宽容纠正为 web_search
    expect(classifyToolPrefix('{"query":"今天天气"}')).toEqual({ name: 'web_search', args: { query: '今天天气' } })
    // 多键或 query 为空字符串时不纠正
    expect(classifyToolPrefix('{"query":"a","extra":1}')).toEqual({ name: '__malformed__', args: { query: 'a', extra: 1 } })
    expect(classifyToolPrefix('{"query":"  "}')).toEqual({ name: '__malformed__', args: { query: '  ' } })
    // 未注册的工具名按工具调用处理，交给 executeToolCall 的未知工具回喂
    expect(classifyToolPrefix('{"tool":"drop_database","args":{}}')).toEqual({ name: 'drop_database', args: {} })
    // tool 字段非字符串也归为畸形
    expect(classifyToolPrefix('{"tool":123}')).toEqual({ name: '__malformed__', args: { tool: 123 } })
  })

  it('unwraps dots native <dots_function_call> wrapper as a tool call', () => {
    expect(classifyToolPrefix('<dots_function_call>{"tool":"web_search","args":{"query":"天气"}}</dots_function_call>'))
      .toEqual({ name: 'web_search', args: { query: '天气' } })
    // 无闭合标签但 JSON 完整（流被截断）也能识别
    expect(classifyToolPrefix('<dots_function_call>{"tool":"list_todos"}'))
      .toEqual({ name: 'list_todos', args: {} })
    // 包装内的畸形 JSON 同样走拦截逻辑
    expect(classifyToolPrefix('<dots_function_call>{"query":"天气"}</dots_function_call>'))
      .toEqual({ name: 'web_search', args: { query: '天气' } })
  })

  it('stays pending while the <dots_function_call> tag itself is incomplete', () => {
    expect(classifyToolPrefix('<')).toBe('pending')
    expect(classifyToolPrefix('<dots_fun')).toBe('pending')
    expect(classifyToolPrefix('<dots_function_call>{"tool":"web_search"')).toBe('pending')
  })

  it('unwraps the native XML tool variant inside or without the dots wrapper', () => {
    const xml = '<tool_call>\n<function name="web_search">\n<parameter name="query">广州天气 2026年9月12日</parameter>\n</invoke>\n</function>'
    expect(classifyToolPrefix(`<dots_function_call>\n${xml}`))
      .toEqual({ name: 'web_search', args: { query: '广州天气 2026年9月12日' } })
    expect(classifyToolPrefix(xml)).toEqual({ name: 'web_search', args: { query: '广州天气 2026年9月12日' } })
    // 未注册名也返回调用，交给未知工具回喂
    expect(classifyToolPrefix('<tool_call><function name="hack"><parameter name="x">1</parameter></function>'))
      .toEqual({ name: 'hack', args: { x: '1' } })
  })

  it('stays pending while the native XML variant is incomplete', () => {
    expect(classifyToolPrefix('<tool_call>')).toBe('pending')
    expect(classifyToolPrefix('<tool_call><function name="web_search"><parameter name="query">广')).toBe('pending')
  })

  it('unwraps tool JSON inside a markdown code fence', () => {
    expect(classifyToolPrefix('```json\n{"tool": "web_search", "args": {"query": "广州今天天气"}}\n```'))
      .toEqual({ name: 'web_search', args: { query: '广州今天天气' } })
    expect(classifyToolPrefix('```\n{"tool":"list_todos"}')).toEqual({ name: 'list_todos', args: {} })
    // 围栏行不完整时保持待定
    expect(classifyToolPrefix('`')).toBe('pending')
    expect(classifyToolPrefix('``')).toBe('pending')
    expect(classifyToolPrefix('```jso')).toBe('pending')
  })

  it('defaults missing or non-object args to an empty object', () => {
    expect(classifyToolPrefix('{"tool":"list_todos"}')).toEqual({ name: 'list_todos', args: {} })
    expect(classifyToolPrefix('{"tool":"list_todos","args":[1]}')).toEqual({ name: 'list_todos', args: {} })
  })

  it('flushes oversized unbalanced prefixes as natural text', () => {
    expect(classifyToolPrefix(`{${'x'.repeat(4096)}`)).toBe('natural')
  })
})

describe('parseCompleteToolCall', () => {
  it('buffers code longer than the old 4K prefix cap and never executes malformed code JSON', () => {
    const code = 'print("synthetic")\n'.repeat(400)
    const reply = JSON.stringify({ tool: 'execute_python', args: { code } })
    for (const prefix of [reply.slice(0, 4200), reply.slice(0, -1)]) expect(classifyToolPrefix(prefix)).toBe('pending')
    expect(parseToolReply(reply)).toEqual({ name: 'execute_python', args: { code } })
    const malformed = '{"tool":"execute_python","args":{"code":"print("bad quotes")"}}'
    expect(classifyToolPrefix(malformed)).toBe('pending')
    expect(parseCompleteToolCall(malformed)).toBeNull()
    expect(parseToolReply(malformed)).toEqual({ name: '__malformed__', args: {} })
    expect(parseToolReply('{"tool":"execute_python","args":')).toEqual({ name: '__malformed__', args: {} })
  })
  it('returns the call when the whole reply is one tool JSON object', () => {
    expect(parseCompleteToolCall(' {"tool":"record_period","args":{"startDate":"2026-09-04"}} '))
      .toEqual({ name: 'record_period', args: { startDate: '2026-09-04' } })
  })

  it('returns null for natural language, malformed JSON and trailing garbage', () => {
    expect(parseCompleteToolCall('好的，已帮你记下')).toBeNull()
    expect(parseCompleteToolCall('{"tool":"add_task",')).toBeNull()
    expect(parseCompleteToolCall('{"tool":"delete_todo","args":{"id":"example"}} 这是示例，不要执行')).toBeNull()
    expect(parseCompleteToolCall('{"tool":"list_todos"}{"tool":"delete_todo"}')).toBeNull()
    expect(parseCompleteToolCall(123)).toBeNull()
  })

  it('shares supported wrappers with streaming while rejecting surrounding prose', () => {
    const json = '{"tool":"list_todos"}'
    const xml = '<tool_call><function name="web_search"><parameter name="query">天气</parameter></function></tool_call>'
    for (const content of [json, `<dots_function_call>${json}</dots_function_call>`, `\`\`\`json\n${json}\n\`\`\``]) {
      expect(parseCompleteToolCall(content)).toEqual({ name: 'list_todos', args: {} })
      expect(parseCompleteToolCall(`${content}\n只是示例`)).toBeNull()
    }
    expect(parseCompleteToolCall(xml)).toEqual({ name: 'web_search', args: { query: '天气' } })
    expect(parseCompleteToolCall(`<dots_function_call>${xml.replace('<tool_call>', '').replace('</tool_call>', '')}</dots_function_call>`))
      .toEqual({ name: 'web_search', args: { query: '天气' } })
    expect(parseCompleteToolCall(`${xml} 只是示例`)).toBeNull()
    expect(parseCompleteToolCall(xml + xml)).toBeNull()
  })
})

