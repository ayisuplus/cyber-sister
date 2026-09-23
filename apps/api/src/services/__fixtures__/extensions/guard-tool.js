/** 测试夹具：tool_call 守卫——拦下 delete_diary，其余放行。复制进扫描目录才生效。 */
export default (pi) => {
  pi.on('tool_call', (event) => {
    if (event.toolName === 'delete_diary') return { block: true, reason: '演示守卫拦下了删手记' }
    return undefined
  })
}
