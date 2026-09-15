import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const create = vi.hoisted(() => vi.fn())
vi.mock('./workBrowserService.js', () => ({ createWorkBrowser: create, isWorkBrowserEnabled: () => process.env.WORK_BROWSER_ENABLED === 'true' }))
import { WORK_BROWSER_TOOLS, closeWorkBrowser } from './workBrowserTools.js'
import { buildNativeTools, buildToolSystemPrompt, executeToolCallOnce } from './agentService.js'

const context = () => ({ conversationId: 'conversation-one', workspace: { artifacts: [] } })
const snapshot = { url: 'https://example.com/', title: 'Example Domain', content: 'Public content', controls: [], rejectedRequests: 0 }
let session
beforeEach(() => {
  vi.stubEnv('WORK_BROWSER_ENABLED', 'true')
  vi.stubEnv('WORK_NATIVE_TOOLS', 'true')
  session = { userId: 'user-one', signal: new AbortController().signal, command: vi.fn().mockResolvedValue(snapshot), close: vi.fn().mockResolvedValue(undefined) }
  create.mockResolvedValue(session)
})
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.clearAllMocks() })

describe('work browser tools', () => {
  it('catalogs expose browser tools only in enabled work mode, with native parameter schemas', () => {
    expect(buildNativeTools('work').filter(tool => tool.function.name.startsWith('browser_'))).toHaveLength(3)
    expect(buildToolSystemPrompt('work')).toContain('最近控件编号')
    expect(buildToolSystemPrompt('chat')).not.toContain('"tool":"browser_open"')
    vi.stubEnv('WORK_BROWSER_ENABLED', 'false')
    expect(buildNativeTools('work').some(tool => tool.function.name.startsWith('browser_'))).toBe(false)
  })

  it('an open page persists within one workspace and source metadata reflects actual returned URLs', async () => {
    const ctx = context()
    const result = await WORK_BROWSER_TOOLS.browser_open.run('user-one', { url: 'https://example.com/#section' }, ctx)
    await WORK_BROWSER_TOOLS.browser_snapshot.run('user-one', {}, ctx)
    expect(create).toHaveBeenCalledOnce()
    expect(session.command.mock.calls[0]).toEqual(['open', { url: 'https://example.com/#section' }])
    expect(result.sources).toEqual([{ title: snapshot.title, url: snapshot.url, fetchedAt: expect.any(String) }])
    expect(result.result.untrusted).toBe(true)
    await closeWorkBrowser(ctx.workspace)
    await closeWorkBrowser(ctx.workspace)
    expect(session.close).toHaveBeenCalledOnce()
  })

  it('fresh snapshots are not deduplicated into stale observations', async () => {
    const run = vi.spyOn(WORK_BROWSER_TOOLS.browser_snapshot, 'run').mockResolvedValue({ summary: 'new state', result: snapshot })
    const cache = new Map()
    await executeToolCallOnce('user-one', { name: 'browser_snapshot', args: {} }, cache, 'work')
    await executeToolCallOnce('user-one', { name: 'browser_snapshot', args: {} }, cache, 'work')
    expect(run).toHaveBeenCalledTimes(2)
    expect(cache.size).toBe(0)
  })

  it('restored tasks must reopen their page; another user cannot operate the workspace session', async () => {
    const ctx = context()
    await expect(WORK_BROWSER_TOOLS.browser_act.run('user-one', { action: 'click', ref: '1:1' }, ctx)).rejects.toMatchObject({ statusCode: 400 })
    ctx.workspace.browser = session
    await expect(WORK_BROWSER_TOOLS.browser_snapshot.run('foreign-user', {}, ctx)).rejects.toMatchObject({ statusCode: 404 })
    expect(session.command).not.toHaveBeenCalled()
  })

  it('screenshots use the same staged artifact limits and never put image bytes in model feedback', async () => {
    const ctx = context()
    ctx.workspace.browser = session
    const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1])
    session.command.mockResolvedValue({ ...snapshot, screenshot: bytes.toString('base64') })
    const result = await WORK_BROWSER_TOOLS.browser_snapshot.run('user-one', { screenshot: true }, ctx)
    expect(result.artifacts).toEqual([expect.objectContaining({ format: 'png', sizeBytes: bytes.length, origin: 'generated' })])
    expect(ctx.workspace.artifacts[0].content).toBe(bytes.toString('base64'))
    expect(result.result).not.toHaveProperty('screenshot')
    expect(JSON.stringify(result)).not.toContain(bytes.toString('base64'))
  })

  it('cancellation after a snapshot does not stage or expose late screenshot output', async () => {
    const ctx = context()
    const controller = new AbortController()
    ctx.signal = controller.signal
    ctx.workspace.browser = session
    session.command.mockImplementation(async () => { controller.abort(); return { ...snapshot, screenshot: 'late' } })
    await expect(WORK_BROWSER_TOOLS.browser_snapshot.run('user-one', { screenshot: true }, ctx)).rejects.toMatchObject({ name: 'AbortError' })
    expect(ctx.workspace.artifacts).toHaveLength(0)
  })
})
