import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../services/modelStatusService', () => ({ modelStatusService: { getStatus: vi.fn() } }))
vi.mock('../../services/modelProviderService', () => ({
  modelProviderService: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    reorder: vi.fn(),
    remove: vi.fn(),
    test: vi.fn(),
  },
}))
import { modelStatusService } from '../../services/modelStatusService'
import { modelProviderService } from '../../services/modelProviderService'
import ModelProviderSettings from './ModelProviderSettings'

const jia = { id: 'p-1', name: '甲家', baseUrl: 'https://api.jia.example/v1', model: 'jia-chat', scenes: ['chat'], priority: 1, enabled: true, hasKey: true }
const yi = { id: 'p-2', name: '乙家', baseUrl: 'https://api.yi.example/v1', model: 'yi-chat', scenes: ['chat', 'explain'], priority: 2, enabled: false, hasKey: false }

let providers

beforeEach(() => {
  vi.clearAllMocks()
  providers = [jia, yi]
  modelStatusService.getStatus.mockResolvedValue({ isInstanceAdmin: true })
  modelProviderService.list.mockImplementation(async () => providers)
  modelProviderService.update.mockImplementation(async (id, fields) => ({ provider: { ...providers.find(provider => provider.id === id), ...fields } }))
})

describe('ModelProviderSettings', () => {
  it('普通用户的设置页里完全没有这张卡片，也不会去请求管理接口', async () => {
    modelStatusService.getStatus.mockResolvedValue({ isInstanceAdmin: false })
    const { container } = render(<ModelProviderSettings />)

    await waitFor(() => expect(modelStatusService.getStatus).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByRole('heading', { name: '模型供应商' })).not.toBeInTheDocument()
    expect(modelProviderService.list).not.toHaveBeenCalled()
  })

  it('拿不到管理员身份时也安静地不出现，不额外报错', async () => {
    modelStatusService.getStatus.mockRejectedValue(new Error('offline'))
    const { container } = render(<ModelProviderSettings />)

    await waitFor(() => expect(modelStatusService.getStatus).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('管理员看得见列表：顺序、用途、密钥只显示「已保存 / 没有密钥」', async () => {
    render(<ModelProviderSettings />)

    expect(await screen.findByText('甲家')).toBeInTheDocument()
    expect(screen.getByText('乙家')).toBeInTheDocument()
    expect(screen.getByText(/第 1 位 · 聊天 · 密钥已保存/)).toBeInTheDocument()
    expect(screen.getByText(/第 2 位 · 聊天、记忆与短评 · 没有密钥/)).toBeInTheDocument()
    // 试一下会花钱，界面上写清楚
    expect(screen.getByText(/真的发一次最小请求/)).toBeInTheDocument()
    // 顺序里没有「上移第一家」「下移最后一家」这种做不到的动作
    expect(screen.getByRole('button', { name: '上移：甲家' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '下移：乙家' })).toBeDisabled()
  })

  it('新增：密钥只写不显示，保存后表单收起、列表刷新', async () => {
    const user = userEvent.setup()
    modelProviderService.create.mockResolvedValue({ provider: { id: 'p-3' } })
    render(<ModelProviderSettings />)
    await screen.findByText('甲家')

    await user.click(screen.getByRole('button', { name: '新增供应商' }))
    const form = screen.getByRole('form', { name: '新增供应商' })
    await user.type(within(form).getByLabelText('显示名'), '丙家')
    await user.type(within(form).getByLabelText(/接口地址/), 'https://api.bing.example/v1')
    await user.type(within(form).getByLabelText('模型名'), 'bing-chat')
    const keyField = within(form).getByLabelText('密钥')
    expect(keyField).toHaveAttribute('type', 'password')
    await user.type(keyField, 'sk-brand-new-value')
    await user.click(within(form).getByRole('button', { name: '保存' }))

    await waitFor(() => expect(modelProviderService.create).toHaveBeenCalledWith({
      name: '丙家',
      baseUrl: 'https://api.bing.example/v1',
      model: 'bing-chat',
      scenes: ['chat'],
      apiKey: 'sk-brand-new-value',
    }))
    await waitFor(() => expect(screen.queryByRole('form')).not.toBeInTheDocument())
    expect(screen.getByRole('status')).toHaveTextContent('保存好了')
    expect(modelProviderService.list).toHaveBeenCalledTimes(2)
  })

  it('编辑：留空就是不换密钥，接口地址与模型名按填的改', async () => {
    const user = userEvent.setup()
    render(<ModelProviderSettings />)
    await screen.findByText('甲家')

    await user.click(screen.getByRole('button', { name: '编辑：甲家' }))
    const form = screen.getByRole('form', { name: '编辑供应商' })
    expect(within(form).getByLabelText('显示名')).toHaveValue('甲家')
    expect(within(form).getByLabelText('密钥')).toHaveValue('')
    await user.clear(within(form).getByLabelText('模型名'))
    await user.type(within(form).getByLabelText('模型名'), 'jia-chat-v2')
    await user.click(within(form).getByRole('button', { name: '保存' }))

    await waitFor(() => expect(modelProviderService.update).toHaveBeenCalledWith('p-1', {
      name: '甲家',
      baseUrl: 'https://api.jia.example/v1',
      model: 'jia-chat-v2',
      scenes: ['chat'],
    }))
  })

  it('启停、排序、删除都带上这个人选的一条', async () => {
    const user = userEvent.setup()
    render(<ModelProviderSettings />)
    await screen.findByText('甲家')

    await user.click(screen.getByRole('switch', { name: '启用：甲家' }))
    await waitFor(() => expect(modelProviderService.update).toHaveBeenCalledWith('p-1', { enabled: false }))
    expect(screen.getByRole('status')).toHaveTextContent('已经停用「甲家」')

    modelProviderService.reorder.mockResolvedValue({ providers: [] })
    await user.click(screen.getByRole('button', { name: '下移：甲家' }))
    await waitFor(() => expect(modelProviderService.reorder).toHaveBeenCalledWith(['p-2', 'p-1']))

    await user.click(screen.getByRole('button', { name: '删除：乙家' }))
    expect(modelProviderService.remove).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: '确认删除：乙家' }))
    await waitFor(() => expect(modelProviderService.remove).toHaveBeenCalledWith('p-2'))
  })

  it('试一下：通了给出模型与用时，不通如实说原因', async () => {
    const user = userEvent.setup()
    render(<ModelProviderSettings />)
    await screen.findByText('甲家')

    modelProviderService.test.mockResolvedValueOnce({ ok: true, latencyMs: 210, model: 'jia-chat', reply: '好' })
    await user.click(screen.getByRole('button', { name: '试一下：甲家' }))
    await waitFor(() => expect(modelProviderService.test).toHaveBeenCalledWith('p-1'))
    expect(await screen.findByText(/「甲家」通了：jia-chat，用时 210 毫秒/)).toBeInTheDocument()

    modelProviderService.test.mockRejectedValueOnce({ response: { data: { error: '接口返回 401，请核对地址、模型名与密钥' } } })
    await user.click(screen.getByRole('button', { name: '试一下：甲家' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('接口返回 401，请核对地址、模型名与密钥')
  })

  it('写成功但网关没能重装时，把服务端那句 warning 摆出来，而不是只报一句成功', async () => {
    const user = userEvent.setup()
    const warning = '改动已经保存，但网关没能重装：密钥解不开（主密钥换过或被改动），请重新保存一次密钥。先修好它，再点一次「刷新列表」。'
    modelProviderService.update.mockResolvedValueOnce({ provider: { ...jia, enabled: false }, warning })
    render(<ModelProviderSettings />)
    await screen.findByText('甲家')

    await user.click(screen.getByRole('switch', { name: '启用：甲家' }))
    await waitFor(() => expect(modelProviderService.update).toHaveBeenCalledWith('p-1', { enabled: false }))
    expect(await screen.findByRole('status')).toHaveTextContent('网关没能重装')
    expect(screen.getByRole('status')).not.toHaveTextContent('已经停用')
  })

  it('保存失败时把服务器给的原因照实显示，并保留填过的内容', async () => {
    const user = userEvent.setup()
    modelProviderService.create.mockRejectedValueOnce({ response: { data: { error: '接口地址不能指向本机或内网' } } })
    render(<ModelProviderSettings />)
    await screen.findByText('甲家')

    await user.click(screen.getByRole('button', { name: '新增供应商' }))
    const form = screen.getByRole('form', { name: '新增供应商' })
    await user.type(within(form).getByLabelText('显示名'), '丙家')
    await user.type(within(form).getByLabelText(/接口地址/), 'https://127.0.0.1/v1')
    await user.type(within(form).getByLabelText('模型名'), 'bing-chat')
    await user.click(within(form).getByRole('button', { name: '保存' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('接口地址不能指向本机或内网')
    expect(within(form).getByLabelText('显示名')).toHaveValue('丙家')
    expect(within(form).getByLabelText(/接口地址/)).toHaveValue('https://127.0.0.1/v1')
  })
})
