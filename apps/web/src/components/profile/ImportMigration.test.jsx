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
  role: { name: '同桌的你', setting: '爱吐槽', ok: true, error: null },
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

  it('人设文本路径：预览只产出角色候选，应用只提交角色', async () => {
    const user = userEvent.setup()
    mocks.previewImport.mockResolvedValue({
      format: 'persona-text',
      role: { name: '合租室友', setting: '爱做饭', ok: true, error: null },
      persona: null,
      memoryCandidates: [],
      memoriesSkipped: 0,
      notes: ['只导入角色扮演设定'],
    })
    mocks.applyImport.mockResolvedValue({ roleApplied: true, personaApplied: false, memoriesApplied: 0, memoriesSkipped: 0 })
    render(<ImportMigration />)

    await user.click(screen.getByRole('button', { name: '粘贴人设文本' }))
    await user.type(screen.getByLabelText('角色名'), '合租室友')
    await user.type(screen.getByLabelText('人设文本'), '爱做饭，经常喊我一起吃饭')
    await user.click(screen.getByRole('button', { name: '解析预览' }))

    expect(mocks.previewImport).toHaveBeenCalledWith({
      format: 'persona-text',
      roleName: '合租室友',
      roleSetting: '爱做饭，经常喊我一起吃饭',
    })
    expect(await screen.findByText(/角色扮演「合租室友」：可导入/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '确认导入' }))
    expect(mocks.applyImport).toHaveBeenCalledWith({
      memories: [],
      role: { name: '合租室友', setting: '爱做饭' },
    })
    expect(await screen.findByText(/已导入角色扮演/)).toBeInTheDocument()
  })

  it('导出包路径：上传 JSON 预览后逐条勾选记忆，应用只提交勾选项', async () => {
    const user = userEvent.setup()
    mocks.previewImport.mockResolvedValue(PREVIEW)
    mocks.applyImport.mockResolvedValue({ roleApplied: true, personaApplied: true, memoriesApplied: 1, memoriesSkipped: 1 })
    render(<ImportMigration />)

    const bundle = { version: 1, product: 'Amie cyber-sister' }
    const file = new File([JSON.stringify(bundle)], 'export.json', { type: 'application/json' })
    await user.upload(screen.getByLabelText('选择导出包文件'), file)
    await user.click(await screen.findByRole('button', { name: '解析预览' }))

    expect(mocks.previewImport).toHaveBeenCalledWith(bundle)
    expect(await screen.findByText(/角色扮演「同桌的你」：可导入/)).toBeInTheDocument()
    expect(screen.getByText(/1 条重复或非法候选已自动跳过/)).toBeInTheDocument()

    // 只保留第二条记忆
    await user.click(screen.getByRole('checkbox', { name: /喜欢吃火锅/ }))
    await user.click(screen.getByRole('button', { name: '确认导入' }))

    expect(mocks.applyImport).toHaveBeenCalledWith({
      memories: [{ type: 'episodic', content: '上周和老板吵架了', importance: 6, tags: [] }],
      role: { name: '同桌的你', setting: '爱吐槽' },
      persona: 'toxic',
    })
    expect(await screen.findByText(/已导入角色扮演、人格、1 条记忆/)).toBeInTheDocument()
  })

  it('无效 JSON 文件给出明确提示，不发起预览', async () => {
    const user = userEvent.setup()
    render(<ImportMigration />)

    const bad = new File(['not-json{'], 'bad.json', { type: 'application/json' })
    await user.upload(screen.getByLabelText('选择导出包文件'), bad)

    expect(await screen.findByRole('alert')).toHaveTextContent('这个文件不是有效的 JSON')
    expect(mocks.previewImport).not.toHaveBeenCalled()
  })

  it('角色命中恋人红线时如实展示原因，确认导入不含角色', async () => {
    const user = userEvent.setup()
    mocks.previewImport.mockResolvedValue({
      ...PREVIEW,
      role: { name: '我的女朋友', setting: '温柔', ok: false, error: '角色扮演不能设定为恋人或亲密关系——我是你姐妹，不是你对象' },
    })
    mocks.applyImport.mockResolvedValue({ roleApplied: false, personaApplied: true, memoriesApplied: 2, memoriesSkipped: 0 })
    render(<ImportMigration />)

    const bundle = { version: 1, product: 'Amie cyber-sister' }
    await user.upload(screen.getByLabelText('选择导出包文件'), new File([JSON.stringify(bundle)], 'export.json', { type: 'application/json' }))
    await user.click(await screen.findByRole('button', { name: '解析预览' }))

    expect(await screen.findByText(/我是你姐妹，不是你对象/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '确认导入' }))
    const applied = mocks.applyImport.mock.calls[0][0]
    expect(applied.role).toBeUndefined()
    expect(applied.persona).toBe('toxic')
  })

  it('预览接口失败时展示服务端错误文案', async () => {
    const user = userEvent.setup()
    mocks.previewImport.mockRejectedValue({ response: { data: { error: '无法识别的导入格式：支持Amie导出包（JSON）或 persona-text 人设文本' } } })
    render(<ImportMigration />)

    const bundle = { hello: 'world' }
    await user.upload(screen.getByLabelText('选择导出包文件'), new File([JSON.stringify(bundle)], 'x.json', { type: 'application/json' }))
    await user.click(await screen.findByRole('button', { name: '解析预览' }))

    expect(await screen.findByText(/无法识别的导入格式/)).toBeInTheDocument()
  })

  it('勾选记忆时的结果文案包含应用与跳过计数', async () => {
    const user = userEvent.setup()
    mocks.previewImport.mockResolvedValue(PREVIEW)
    mocks.applyImport.mockResolvedValue({ roleApplied: true, personaApplied: false, memoriesApplied: 2, memoriesSkipped: 3 })
    render(<ImportMigration />)

    const bundle = { version: 1, product: 'Amie cyber-sister' }
    await user.upload(screen.getByLabelText('选择导出包文件'), new File([JSON.stringify(bundle)], 'export.json', { type: 'application/json' }))
    await user.click(await screen.findByRole('button', { name: '解析预览' }))
    await user.click(await screen.findByRole('button', { name: '确认导入' }))

    await waitFor(() => expect(screen.getByText(/已导入角色扮演、2 条记忆；3 条重复或非法已跳过/)).toBeInTheDocument())
  })
})
