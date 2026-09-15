import { describe, expect, it, vi } from 'vitest'

const execute = vi.hoisted(() => vi.fn())
const runtime = vi.hoisted(() => ({ local: true }))
vi.mock('./agentService.js', () => ({
  buildToolSystemPrompt: () => 'tools', buildNativeTools: () => [], executeToolCallOnce: execute,
}))
vi.mock('../config/distribution.js', () => ({ isLocalWorkRuntime: () => runtime.local }))
import { createAgentTurn, runAgentLoop } from './agentTurn.js'

async function* events(list) { yield* list }
async function collect(stream) { const result = []; for await (const item of stream) result.push(item); return result }
const fallback = () => ({ content: 'fallback', source: 'local_template' })
const call = { type: 'toolcall', name: 'add_task', args: { content: 'test' } }

describe('统一 agent loop 的终态与协议', () => {
  it('本地运行时一个回合最多连续 12 次有效工具，发送进度且上下文绑定会话；模型场景恒为 chat', async () => {
    execute.mockClear()
    execute.mockResolvedValue({ tool: 'calc_convert', ok: true, summary: 'result', feedback: 'result' })
    const turn = createAgentTurn({ userId: 'u', conversationId: 'c' })
    expect(turn).toMatchObject({ scene: 'chat', agent: true })
    expect(turn.extraSystem.at(-1)).toEqual({ role: 'system', content: 'tools' })
    const generate = vi.fn(() => events([call]))
    const result = await collect(runAgentLoop({ turn, generate, fallback }))
    expect(generate).toHaveBeenCalledTimes(13)
    expect(execute).toHaveBeenCalledTimes(12)
    expect(execute.mock.calls[0][3]).toMatchObject({ conversationId: 'c', workspace: { artifacts: [] } })
    expect(result.filter((event) => event.type === 'tool_progress')).toHaveLength(24)
    expect(result.at(-1).toolRuns).toHaveLength(12)
  })
  it('连续两次失败触发收尾，停止无限重试', async () => {
    execute.mockClear()
    execute.mockResolvedValue({ tool: 'read_artifact', ok: false, summary: 'not found', feedback: 'failed' })
    const turn = createAgentTurn({ userId: 'u', conversationId: 'c' })
    const result = await collect(runAgentLoop({ turn, generate: () => events([call]), fallback }))
    expect(execute).toHaveBeenCalledTimes(2)
    expect(result.at(-1).type).toBe('done')
  })
  it('进度事件发出后取消，不再调用工具', async () => {
    execute.mockClear()
    const controller = new AbortController()
    const turn = createAgentTurn({ userId: 'u', conversationId: 'c', signal: controller.signal })
    const stream = runAgentLoop({ turn, generate: () => events([call]), fallback, signal: controller.signal })
    expect((await stream.next()).value).toMatchObject({ type: 'tool_progress', status: 'running' })
    controller.abort()
    expect((await stream.next()).done).toBe(true)
    expect(execute).not.toHaveBeenCalled()
  })
  it.each(['toolcall', 'done'])('%s 适配得到相同的串行工具反馈，达到上限后强制收尾', async (type) => {
    execute.mockResolvedValue({ tool: 'add_task', ok: true, summary: 'saved', feedback: 'result' })
    const turn = createAgentTurn({ userId: 'one' })
    const generate = vi.fn(() => events([type === 'toolcall' ? call : { type, content: JSON.stringify({ tool: call.name, args: call.args }) }]))
    const result = await collect(runAgentLoop({ turn, generate, fallback }))
    expect(generate).toHaveBeenCalledTimes(13)
    expect(turn.toolRuns).toHaveLength(12)
    expect(turn.history.slice(0, 2)).toEqual([
      { role: 'assistant', content: JSON.stringify({ tool: call.name, args: call.args }) }, { role: 'user', content: 'result' },
    ])
    expect(result.filter((item) => item.type !== 'tool_progress').map((item) => item.type)).toEqual(['replace', 'done'])
    expect(result.at(-1).content).toBe('fallback')
  })

  it('网页版没有工具进度，也不按工作预算放大上下文', async () => {
    runtime.local = false
    try {
      const turn = createAgentTurn({ userId: 'web' })
      expect(turn).toMatchObject({ scene: 'chat', agent: false })
      const result = await collect(runAgentLoop({ turn, generate: () => events([{ type: 'done', content: 'hi' }]), fallback }))
      expect(result.map((item) => item.type)).toEqual(['done'])
    } finally {
      runtime.local = true
    }
  })

  it('error 后面的工具与 done 均丢弃', async () => {
    const turn = createAgentTurn({ userId: 'one' })
    const spy = vi.spyOn(turn, 'execute')
    expect(await collect(runAgentLoop({ turn, generate: () => events([{ type: 'error', reason: 'STREAM_FAILED' }, call, { type: 'done', content: 'late' }]), fallback })))
      .toEqual([{ type: 'error', reason: 'STREAM_FAILED' }])
    expect(spy).not.toHaveBeenCalled()
  })

  it('静默结束不制造成功完成事件', async () => {
    const turn = createAgentTurn({ userId: 'one' })
    expect(await collect(runAgentLoop({ turn, generate: () => events([{ type: 'sentence', text: 'partial' }]), fallback })))
      .toEqual([{ type: 'sentence', text: 'partial' }])
  })

  it('生成中取消不执行迟到工具，已取消时也不调用生成器', async () => {
    const controller = new AbortController()
    const turn = createAgentTurn({ userId: 'one', signal: controller.signal })
    const spy = vi.spyOn(turn, 'execute')
    const generate = vi.fn(async function* () { controller.abort(); yield call })
    expect(await collect(runAgentLoop({ turn, generate, fallback, signal: controller.signal }))).toEqual([])
    expect(spy).not.toHaveBeenCalled()
    generate.mockClear()
    await collect(runAgentLoop({ turn, generate, fallback, signal: controller.signal }))
    expect(generate).not.toHaveBeenCalled()
  })

  it('取消中的工具结果不会追加历史或污染另一个请求实例', async () => {
    const controller = new AbortController()
    const history = [{ role: 'user', content: 'hello' }]
    const turn = createAgentTurn({ userId: 'one', history, signal: controller.signal })
    const other = createAgentTurn({ userId: 'two', history })
    execute.mockImplementationOnce(async () => { controller.abort(); return { ok: true } })
    await expect(turn.execute(call, 'tool')).rejects.toMatchObject({ name: 'AbortError' })
    expect(turn.history).toEqual(history)
    expect(other.toolRuns).toEqual([])
  })

  it('交付完成事件前等待浏览器关闭，保证消息事务发生在清理后', async () => {
    const turn = createAgentTurn({ userId: 'one' })
    let release
    turn.close = vi.fn(() => new Promise(resolve => { release = resolve }))
    const stream = runAgentLoop({ turn, generate: () => events([{ type: 'done', content: 'result' }]), fallback })
    const delivered = vi.fn()
    const next = stream.next().then(result => { delivered(result); return result })
    await vi.waitFor(() => expect(turn.close).toHaveBeenCalledOnce())
    expect(delivered).not.toHaveBeenCalled()
    release()
    expect((await next).value.type).toBe('done')
    await stream.return()
    expect(turn.close).toHaveBeenCalledOnce()
  })

  it('浏览器关闭失败不能发出 done；生成异常和调用方退出也关闭会话', async () => {
    const turn = createAgentTurn({ userId: 'one' })
    turn.close = vi.fn().mockRejectedValueOnce(new Error('cleanup failed')).mockResolvedValue(undefined)
    await expect(collect(runAgentLoop({ turn, generate: () => events([{ type: 'done', content: 'result' }]), fallback }))).rejects.toThrow('cleanup failed')
    await expect(collect(runAgentLoop({ turn, generate: () => { throw new Error('model failed') }, fallback }))).rejects.toThrow('model failed')
    const stream = runAgentLoop({ turn, generate: () => events([{ type: 'sentence', text: 'partial' }]), fallback })
    await stream.next()
    await stream.return()
    expect(turn.close).toHaveBeenCalledTimes(3)
  })
})
