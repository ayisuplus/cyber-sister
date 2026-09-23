/** 测试夹具：tool_call 抛错应 fail-safe 阻断；input/tool_result 抛错只跳过自己。复制进扫描目录才生效。 */
export default (pi) => {
  pi.on('tool_call', () => {
    throw new Error('tool_call 夹具故意抛错')
  })
  pi.on('input', () => {
    throw new Error('input 夹具故意抛错')
  })
  pi.on('tool_result', () => {
    throw new Error('tool_result 夹具故意抛错')
  })
}
