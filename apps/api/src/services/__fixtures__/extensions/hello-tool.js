/** 测试夹具：hello_tool 只读免确认；hello_write 没有 readOnly，默认走确认卡。复制进扫描目录才生效。 */
export default (pi) => {
  pi.registerTool({
    name: 'hello_tool',
    label: '打招呼',
    description: '{"tool":"hello_tool","args":{"name":"称呼"}} 说一声 hi（只读演示工具）',
    readOnly: true,
    parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'], additionalProperties: false },
    execute: (toolCallId, args) => ({ summary: '打了个招呼', result: { toolCallId, text: `hi ${args.name}` } }),
  })
  pi.registerTool({
    name: 'hello_write',
    description: '{"tool":"hello_write","args":{}} 演示写操作：默认要确认卡',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    execute: () => ({ summary: '写好了', result: { done: true } }),
  })
}
