import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../services/localModelService', () => ({
  localModelService: {
    getStatus: vi.fn(),
    getConfig: vi.fn(),
    detect: vi.fn(),
    test: vi.fn(),
    update: vi.fn(),
  },
}))

import { localModelService } from '../services/localModelService'
import LocalModelPage from './LocalModelPage'

const renderPage = () => render(<MemoryRouter><LocalModelPage /></MemoryRouter>)

describe('LocalModelPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localModelService.getStatus.mockResolvedValue({
      mode: 'local_first',
      local: { configured: false, state: 'not_configured' },
      externalFallback: { configured: true, consent: false, version: 'qwen-fallback-v1' },
    })
    localModelService.getConfig.mockResolvedValue({
      enabled: false,
      baseUrl: null,
      model: null,
      revision: 0,
      lastVerifiedAt: null,
      apiKeyConfigured: false,
    })
  })

  it('discovers llama.cpp on the deployment host and fills the connection fields', async () => {
    const user = userEvent.setup()
    localModelService.detect.mockResolvedValue({
      preset: 'host',
      baseUrl: 'http://host.docker.internal:8080/v1',
      models: ['friend-8b', 'friend-14b'],
      model: 'friend-8b',
      state: 'ready',
      apiKeyConfigured: false,
    })
    renderPage()

    expect(await screen.findByText('尚未连接')).toBeInTheDocument()
    expect(screen.getByText(/部署服务器，不是你当前使用的手机/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '自动发现并填写' }))

    expect(localModelService.detect).toHaveBeenCalledWith('host')
    expect(screen.getByLabelText('llama.cpp 地址')).toHaveValue('http://host.docker.internal:8080/v1')
    expect(screen.getByRole('combobox', { name: '模型' })).toHaveValue('friend-8b')
    expect(screen.getByText('已发现 llama.cpp，并自动填写连接信息')).toBeInTheDocument()
  })

  it('shows ordinary users a read-only status after the admin endpoint returns 403', async () => {
    localModelService.getStatus.mockResolvedValue({
      mode: 'local_first',
      local: { configured: true, state: 'ready' },
      externalFallback: { configured: false, consent: null, version: 'qwen-fallback-v1' },
    })
    localModelService.getConfig.mockRejectedValue({ response: { status: 403 } })
    renderPage()

    expect(await screen.findByRole('heading', { name: '只读状态' })).toBeInTheDocument()
    expect(screen.getByText(/只有安装管理员可以修改/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '自动发现并填写' })).not.toBeInTheDocument()
  })

  it('treats a cold-starting llama.cpp as loading instead of a failed discovery', async () => {
    const user = userEvent.setup()
    localModelService.detect.mockResolvedValue({
      preset: 'host',
      baseUrl: 'http://host.docker.internal:8080/v1',
      models: [],
      model: null,
      state: 'loading',
      apiKeyConfigured: false,
    })
    renderPage()

    await user.click(await screen.findByRole('button', { name: '自动发现并填写' }))

    expect(screen.getByLabelText('llama.cpp 地址')).toHaveValue('http://host.docker.internal:8080/v1')
    expect(screen.getByText('已发现 llama.cpp，模型仍在加载，请稍后重新检测')).toBeInTheDocument()
  })

  const arrangeConfiguredForm = () => {
    localModelService.getConfig.mockResolvedValue({
      enabled: true,
      baseUrl: 'http://host.docker.internal:8080/v1',
      model: 'friend-8b',
      revision: 1,
      lastVerifiedAt: null,
      apiKeyConfigured: false,
    })
  }

  it('re-reads the real status after saving instead of assuming ready', async () => {
    const user = userEvent.setup()
    arrangeConfiguredForm()
    // 保存响应不带运行状态 → 重新拉取，此时模型仍在加载
    localModelService.update.mockResolvedValue({
      enabled: true,
      baseUrl: 'http://host.docker.internal:8080/v1',
      model: 'friend-8b',
      revision: 2,
      lastVerifiedAt: '2026-08-30T00:00:00.000Z',
      apiKeyConfigured: false,
    })
    localModelService.getStatus
      .mockResolvedValueOnce({
        mode: 'local_first',
        local: { configured: true, state: 'ready' },
        externalFallback: { configured: true, consent: false, version: 'qwen-fallback-v1' },
      })
      .mockResolvedValueOnce({
        mode: 'local_first',
        local: { configured: true, state: 'loading' },
        externalFallback: { configured: true, consent: false, version: 'qwen-fallback-v1' },
      })
    renderPage()

    await user.click(await screen.findByRole('button', { name: /保存并生效/ }))

    expect(localModelService.update).toHaveBeenCalledWith({
      enabled: true,
      baseUrl: 'http://host.docker.internal:8080/v1',
      model: 'friend-8b',
    })
    expect(localModelService.getStatus).toHaveBeenCalledTimes(2)
    expect(await screen.findByText('模型加载中')).toBeInTheDocument()
    expect(screen.getByText('本地模型配置已保存并生效')).toBeInTheDocument()
  })

  it('trusts an explicit state in the save response without a redundant refetch', async () => {
    const user = userEvent.setup()
    arrangeConfiguredForm()
    localModelService.update.mockResolvedValue({
      enabled: true,
      baseUrl: 'http://host.docker.internal:8080/v1',
      model: 'friend-8b',
      revision: 2,
      lastVerifiedAt: '2026-08-30T00:00:00.000Z',
      apiKeyConfigured: false,
      state: 'loading',
    })
    renderPage()

    await user.click(await screen.findByRole('button', { name: /保存并生效/ }))

    expect(localModelService.getStatus).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('模型加载中')).toBeInTheDocument()
  })
})
