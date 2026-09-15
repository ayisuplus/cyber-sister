import { beforeEach, describe, expect, it, vi } from 'vitest'
const db = vi.hoisted(() => ({ findMany: vi.fn(), findFirst: vi.fn(), createMany: vi.fn() }))
const runtime = vi.hoisted(() => ({ runWorkPython: vi.fn() }))
vi.mock('../prisma/client.js', () => ({ default: { workArtifact: db } }))
vi.mock('./workExecutionService.js', () => runtime)
import { stageArtifact, listWorkArtifacts, readWorkArtifact, commitWorkArtifacts, prepareWorkAttachments, artifactBuffer, WORK_ARTIFACT_TOOLS } from './workArtifactService.js'

const input = { title: '本周计划', format: 'md', content: '# 本周\n- 写作\n' }
describe('工作交付文件边界', () => {
  beforeEach(() => vi.resetAllMocks())
  it('仅暂存于所属回合，返回不含正文的 metadata，不在工具阶段写库', () => {
    const workspace = { artifacts: [] }
    const metadata = stageArtifact(workspace, input)
    expect(metadata).toMatchObject({ title: input.title, format: 'md', sizeBytes: Buffer.byteLength(input.content) })
    expect(metadata).not.toHaveProperty('content')
    expect(workspace.artifacts).toEqual([{ ...metadata, content: input.content }])
    expect(db.createMany).not.toHaveBeenCalled()
  })
  it.each([
    { title: '../跨路径' }, { title: 'abc\nInjected' }, { title: '' }, { format: '__proto__' },
    { format: 'exe' }, { content: '' }, { content: '字'.repeat(70000) }, { format: 'json', content: '{broken}' },
  ])('拒绝无效标题、格式、正文与超限文件 %#', (invalid) => {
    expect(() => stageArtifact({ artifacts: [] }, { ...input, ...invalid })).toThrow()
  })
  it('每轮最多 8 个文件，取消后不能再暂存', () => {
    const controller = new AbortController()
    const workspace = { artifacts: [], signal: controller.signal }
    for (let i = 0; i < 8; i += 1) stageArtifact(workspace, input)
    expect(() => stageArtifact(workspace, input)).toThrow('最多')
    controller.abort()
    expect(() => stageArtifact(workspace, input)).toThrow(expect.objectContaining({ name: 'AbortError' }))
  })
  it('读取与列举绑定用户和会话，跨用户文件统一 404', async () => {
    db.findMany.mockResolvedValue([])
    db.findFirst.mockResolvedValue(null)
    await listWorkArtifacts('u1', 'c1')
    expect(db.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'u1', conversationId: 'c1' }, take: 50 }))
    await expect(readWorkArtifact('u2', 'foreign', { conversationId: 'c2' })).rejects.toMatchObject({ statusCode: 404 })
    expect(db.findFirst).toHaveBeenCalledWith({ where: { userId: 'u2', id: 'foreign', conversationId: 'c2' } })
  })
  it('取消中的读取不返回迟到内容，也不进行文件提交', async () => {
    const controller = new AbortController()
    db.findFirst.mockImplementation(async () => { controller.abort(); return { content: 'late' } })
    await expect(readWorkArtifact('u1', 'a1', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    await expect(commitWorkArtifacts({ workArtifact: db }, { artifacts: [input], signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(db.createMany).not.toHaveBeenCalled()
  })
  it('长文件分块读取，临时文件在完成前可用于后续工具但没有虚构落库', async () => {
    const context = { conversationId: 'c1', workspace: { artifacts: [] } }
    const created = WORK_ARTIFACT_TOOLS.create_artifact.run('u1', { ...input, content: 'a'.repeat(15000) }, context)
    const first = await WORK_ARTIFACT_TOOLS.read_artifact.run('u1', { id: created.artifact.id }, context)
    const next = await WORK_ARTIFACT_TOOLS.read_artifact.run('u1', { id: created.artifact.id, offset: 12000 }, context)
    expect(first.result.content).toHaveLength(12000)
    expect(first.result.nextOffset).toBe(12000)
    expect(next.result.content).toHaveLength(3000)
    expect(next.result.nextOffset).toBe(null)
    expect(db.findFirst).not.toHaveBeenCalled()
  })
  it('任务计划不能有多项同时进行，忽略额外字段', () => {
    const context = { conversationId: 'c1', workspace: { artifacts: [] } }
    const run = WORK_ARTIFACT_TOOLS.update_plan.run
    expect(() => run('u1', { steps: [{ title: 'A', status: 'in_progress' }, { title: 'B', status: 'in_progress' }] }, context)).toThrow()
    const plan = run('u1', { steps: [{ title: 'A', status: 'pending', secrets: 'discarded' }] }, context)
    expect(plan.plan).toEqual([{ title: 'A', status: 'pending' }])
  })
})

describe('工作文件输入与执行输出', () => {
  const run = (result = {}) => ({ exitCode: 0, stdout: '42', stderr: '', timedOut: false, files: [], ...result })
  const file = (name, content) => ({ name, base64: Buffer.from(content).toString('base64') })
  const context = () => ({ conversationId: 'c1', workspace: { artifacts: [], attachments: [] } })
  beforeEach(() => vi.resetAllMocks())

  it('上传的 UTF-8/BOM 字节原样往返，只给模型目录和显式读取的内容', async () => {
    const bytes = Buffer.from('\ufeff项目,数量\r\nA,20\r\n')
    const attachments = prepareWorkAttachments([{ originalname: '我的表.csv', buffer: bytes }])
    expect(artifactBuffer(attachments[0])).toEqual(bytes)
    const ctx = context()
    ctx.workspace.attachments = attachments
    const result = await WORK_ARTIFACT_TOOLS.read_artifact.run('u1', { id: attachments[0].id }, ctx)
    expect(result.result).toMatchObject({ content: bytes.toString(), origin: 'uploaded', untrusted: true })
    expect(db.findFirst).not.toHaveBeenCalled()
    expect(db.createMany).not.toHaveBeenCalled()
  })

  it('任何对话都能在本地附文件；网页版拒绝，另拒绝路径、超量、非法编码和伪造文档类型', () => {
    const upload = { originalname: 'input.txt', buffer: Buffer.from('data') }
    expect(prepareWorkAttachments([upload])).toHaveLength(1)
    expect(prepareWorkAttachments()).toEqual([])
    vi.stubEnv('APP_DISTRIBUTION', 'web')
    expect(() => prepareWorkAttachments([upload])).toThrow('本地客户端')
    expect(prepareWorkAttachments([])).toEqual([])
    vi.unstubAllEnvs()
    expect(() => prepareWorkAttachments(Array(4).fill(upload))).toThrow('3')
    expect(() => prepareWorkAttachments([{ ...upload, originalname: '../x.txt' }])).toThrow()
    expect(() => prepareWorkAttachments([{ ...upload, originalname: 'fake.pdf' }])).toThrow('扩展名')
    expect(() => prepareWorkAttachments([{ ...upload, buffer: Buffer.from([0xff]) }])).toThrow('UTF-8')
    expect(() => prepareWorkAttachments([{ ...upload, buffer: Buffer.alloc(5 * 1024 * 1024 + 1) }])).toThrow('5 MB')
  })

  it('代码只能读取当前会话拥有的文件，不把无关文件送入容器', async () => {
    db.findFirst.mockResolvedValue(null)
    await expect(WORK_ARTIFACT_TOOLS.execute_python.run('u2', { code: 'print(1)', inputs: ['foreign'] }, context())).rejects.toMatchObject({ statusCode: 404 })
    expect(db.findFirst).toHaveBeenCalledWith({ where: { userId: 'u2', id: 'foreign', conversationId: 'c1' } })
    expect(runtime.runWorkPython).not.toHaveBeenCalled()
    const ctx = context()
    ctx.workspace.attachments = prepareWorkAttachments([{ originalname: 'allowed.csv', buffer: Buffer.from('a,b') }])
    runtime.runWorkPython.mockResolvedValue(run())
    await WORK_ARTIFACT_TOOLS.execute_python.run('u1', { code: 'print(1)' }, ctx)
    expect(runtime.runWorkPython).toHaveBeenCalledWith('u1', { code: 'print(1)', files: [] }, ctx)
  })

  it('先验证整批输出，任何不合法文件都不能留下部分交付', async () => {
    const ctx = context()
    runtime.runWorkPython.mockResolvedValue(run({ files: [file('valid.csv', 'value\n42'), file('../escape.txt', 'bad')] }))
    await expect(WORK_ARTIFACT_TOOLS.execute_python.run('u1', { code: 'print(1)' }, ctx)).rejects.toMatchObject({ statusCode: 400 })
    expect(ctx.workspace.artifacts).toEqual([])
    expect(db.createMany).not.toHaveBeenCalled()
  })

  it('成功返回可下载文件目录，失败的退出码保留错误且不能报成功', async () => {
    const ctx = context()
    runtime.runWorkPython.mockResolvedValueOnce(run({ files: [file('result.csv', 'value\n42')] }))
    const success = await WORK_ARTIFACT_TOOLS.execute_python.run('u1', { code: 'print(1)' }, ctx)
    expect(success).toMatchObject({ ok: true, artifacts: [{ title: 'result', format: 'csv' }] })
    expect(success.result.files[0]).not.toHaveProperty('base64')
    runtime.runWorkPython.mockResolvedValueOnce(run({ exitCode: 1, stdout: '', stderr: 'SyntaxError' }))
    const failure = await WORK_ARTIFACT_TOOLS.execute_python.run('u1', { code: 'invalid' }, ctx)
    expect(failure).toMatchObject({ ok: false, result: { exitCode: 1, stderr: 'SyntaxError' } })
    expect(ctx.workspace.artifacts).toHaveLength(1)
  })

  it('取消后不接收迟到的执行输出', async () => {
    const controller = new AbortController()
    const ctx = { ...context(), signal: controller.signal }
    runtime.runWorkPython.mockImplementation(async () => { controller.abort(); return run({ files: [file('late.txt', 'late')] }) })
    await expect(WORK_ARTIFACT_TOOLS.execute_python.run('u1', { code: 'print(1)' }, ctx)).rejects.toMatchObject({ name: 'AbortError' })
    expect(ctx.workspace.artifacts).toEqual([])
  })
})
