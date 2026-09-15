import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  previewImport: vi.fn(),
  applyImport: vi.fn(),
}))

vi.mock('../../services/userService', () => ({
  migrationService: {
    previewImport: mocks.previewImport,
    applyImport: mocks.applyImport,
  },
}))

import ImportMigration from './ImportMigration'

const PREVIEW = {
  format: 'cyber-sister-export',
  persona: { id: 'toxic', ok: true },
  memoryCandidates: [
    { type: 'semantic', content: '喜欢吃火锅', importance: 8, tags: [] },
    { type: 'episodic', content: '上周和老板吵架了', importance: 6, tags: [] },
  ],
  memoriesSkipped: 1,
  notes: ['对话等数据段不导入（v1 边界）。'],
}

describe('ImportMigration', () => {
  beforeEach(() => vi.clearAllMocks())

  it('只接受导出包：不再提供粘贴外部人设文本（角色扮演）的入口', () => {
    render(<ImportMigration />)

    expect(screen.getByLabelText('选择导出包文件')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '粘贴人设文本' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('角色名')).not.toBeInTheDocument()
  })

  it('导出包路径：上传 JSON 预览后逐条勾选记忆，应用只提交勾选项', async () => {
    const user = userEvent.setup()
    mocks.previewImport.mockResolvedValue(PREVIEW)
    mocks.applyImport.mockResolvedValue({ personaApplied: true, memoriesApplied: 1, memoriesSkipped: 1 })
    render(<ImportMigration />)

    const bundle = { version: 1, product: 'Amie cyber-sister' }
    const file = new File([JSON.stringify(bundle)], 'export.json', { type: 'application/json' })
    await user.upload(screen.getByLabelText('选择导出包文件'), file)
    await user.click(await screen.findByRole('button', { name: '解析预览' }))

    expect(mocks.previewImport).toHaveBeenCalledWith(bundle)
    expect(await screen.findByText(/说话方式 toxic：可导入/)).toBeInTheDocument()
    expect(screen.getByText(/1 条重复或非法候选已自动跳过/)).toBeInTheDocument()

    // 只保留第二条记忆
    await user.click(screen.getByRole('checkbox', { name: /喜欢吃火锅/ }))
    await user.click(screen.getByRole('button', { name: '确认导入' }))

    expect(mocks.applyImport).toHaveBeenCalledWith({
      memories: [{ type: 'episodic', content: '上周和老板吵架了', importance: 6, tags: [] }],
      persona: 'toxic',
    })
    expect(await screen.findByText(/已导入说话方式、1 条记忆/)).toBeInTheDocument()
  })

  it('无效 JSON 文件给出明确提示，不发起预览', async () => {
    const user = userEvent.setup()
    render(<ImportMigration />)

    const bad = new File(['not-json{'], 'bad.json', { type: 'application/json' })
    await user.upload(screen.getByLabelText('选择导出包文件'), bad)

    expect(await screen.findByRole('alert')).toHaveTextContent('这个文件不是有效的 JSON')
    expect(mocks.previewImport).not.toHaveBeenCalled()
  })

  it('即使预览里仍带着旧角色值，确认导入也绝不提交角色', async () => {
    const user = userEvent.setup()
    mocks.previewImport.mockResolvedValue({ ...PREVIEW, role: { name: '同桌的你', setting: '爱吐槽', ok: true } })
    mocks.applyImport.mockResolvedValue({ personaApplied: true, memoriesApplied: 2, memoriesSkipped: 0 })
    render(<ImportMigration />)

    const bundle = { version: 1, product: 'Amie cyber-sister' }
    await user.upload(screen.getByLabelText('选择导出包文件'), new File([JSON.stringify(bundle)], 'export.json', { type: 'application/json' }))
    await user.click(await screen.findByRole('button', { name: '解析预览' }))
    await user.click(await screen.findByRole('button', { name: '确认导入' }))

    const applied = mocks.applyImport.mock.calls[0][0]
    expect(applied.role).toBeUndefined()
    expect(applied.persona).toBe('toxic')
    expect(screen.queryByText(/同桌的你/)).not.toBeInTheDocument()
  })

  it('预览接口失败时展示服务端错误文案', async () => {
    const user = userEvent.setup()
    mocks.previewImport.mockRejectedValue({ response: { data: { error: '无法识别的导入格式：只支持 Amie 导出包（JSON）' } } })
    render(<ImportMigration />)

    const bundle = { hello: 'world' }
    await user.upload(screen.getByLabelText('选择导出包文件'), new File([JSON.stringify(bundle)], 'x.json', { type: 'application/json' }))
    await user.click(await screen.findByRole('button', { name: '解析预览' }))

    expect(await screen.findByText(/无法识别的导入格式/)).toBeInTheDocument()
  })

  it('勾选记忆时的结果文案包含应用与跳过计数', async () => {
    const user = userEvent.setup()
    mocks.previewImport.mockResolvedValue(PREVIEW)
    mocks.applyImport.mockResolvedValue({ personaApplied: false, memoriesApplied: 2, memoriesSkipped: 3 })
    render(<ImportMigration />)

    const bundle = { version: 1, product: 'Amie cyber-sister' }
    await user.upload(screen.getByLabelText('选择导出包文件'), new File([JSON.stringify(bundle)], 'export.json', { type: 'application/json' }))
    await user.click(await screen.findByRole('button', { name: '解析预览' }))
    await user.click(await screen.findByRole('button', { name: '确认导入' }))

    await waitFor(() => expect(screen.getByText(/已导入2 条记忆；3 条重复或非法已跳过/)).toBeInTheDocument())
  })
})

describe('v2 stable memory imports', () => {
  it('selects stable references, disables conflicting records, and requires both endpoints for relationships', async () => {
    const user = userEvent.setup()
    const bundle = { version: 2, product: 'Amie cyber-sister', memoryBundle: { version: 2, memories: [], edges: [] } }
    mocks.previewImport.mockResolvedValue({
      format: 'cyber-sister-export-v2',
      memoryEpoch: 12,
      memoryCandidates: [
        { id: 'portable-a', revision: 2, content: '记忆甲', state: 'new' },
        { id: 'portable-b', revision: 1, content: '记忆乙', state: 'duplicate' },
        { id: 'portable-c', revision: 3, content: '记忆丙', state: 'conflict' },
      ],
      edges: [{ id: 'edge-ab', from: 'portable-a', to: 'portable-b', relation: 'similar', status: 'canonical' }],
      role: null, persona: null, notes: [],
    })
    mocks.applyImport.mockResolvedValue({ memoriesApplied: 1, memoriesSkipped: 1, edgesApplied: 1 })
    render(<ImportMigration />)
    await user.upload(screen.getByLabelText('选择导出包文件'), new File([JSON.stringify(bundle)], 'memories-v2.json', { type: 'application/json' }))
    await user.click(await screen.findByRole('button', { name: '解析预览' }))
    const conflicting = await screen.findByRole('checkbox', { name: /记忆丙/ })
    expect(conflicting).toBeDisabled()
    expect(conflicting).not.toBeChecked()
    const edge = screen.getByRole('checkbox', { name: '记忆甲 · 相似 · 记忆乙' })
    expect(edge).not.toBeChecked()
    await user.click(edge)
    await user.click(screen.getByRole('checkbox', { name: /记忆乙 · 第/ }))
    expect(edge).toBeDisabled()
    await user.click(screen.getByRole('checkbox', { name: /记忆乙 · 第/ }))
    await user.click(screen.getByRole('button', { name: '确认导入' }))
    expect(mocks.applyImport).toHaveBeenCalledWith({
      memoryBundle: bundle.memoryBundle, selectedIds: ['portable-a', 'portable-b'], selectedEdgeIds: ['edge-ab'],
      expectedMemoryEpoch: 12,
    })
    expect(await screen.findByText(/1 条关系/)).toBeInTheDocument()
  })
})
