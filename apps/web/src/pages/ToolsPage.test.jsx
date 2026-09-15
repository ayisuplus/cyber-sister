import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ToolsPage from './ToolsPage'

vi.mock('../services/careService', () => ({
  careService: { list: vi.fn(), dismiss: vi.fn() },
}))

import { careService } from '../services/careService'

describe('ToolsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    careService.list.mockResolvedValue({ touchpoints: [] })
    careService.dismiss.mockResolvedValue({ dismissed: true })
  })

  it('renders 她来想你 cards when touchpoints exist', async () => {
    careService.list.mockResolvedValue({
      touchpoints: [{
        key: 'countdown:c1:2026-09-09',
        kind: 'countdown',
        title: '「面试」还有 1 天',
        body: '时间刚刚好。',
        reason: '你在倒数日里记的日子',
        action: { to: '/tools/countdown', label: '看看倒数日' },
      }],
    })
    render(<MemoryRouter><ToolsPage /></MemoryRouter>)

    expect(await screen.findByText('她来想你')).toBeInTheDocument()
    expect(screen.getByText('「面试」还有 1 天')).toBeInTheDocument()
  })
  it('exposes implemented capabilities as links with honest privacy notes', () => {
    render(<MemoryRouter><ToolsPage /></MemoryRouter>)

    // 生成能力提供可操作的接口预览，并标明模拟状态。
    expect(screen.getByRole('link', { name: /化妆间/ })).toHaveAttribute('href', '/tools/makeup-room')
    expect(screen.getByRole('link', { name: /3D 衣柜/ })).toHaveAttribute('href', '/tools/wardrobe')
    expect(screen.queryByRole('link', { name: /虚拟试衣间/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /虚拟化妆间/ })).not.toBeInTheDocument()
    expect(screen.queryByText('规划中')).not.toBeInTheDocument()
    expect(screen.getAllByText('接口预览')).toHaveLength(2)
    expect(screen.getAllByText('云端接口 · 模拟')).toHaveLength(2)
  })
  it('links every sister toolbox entry to its SPA route, grouped by section', () => {
    render(<MemoryRouter><ToolsPage /></MemoryRouter>)

    // 分组标题
    for (const label of ['计划提醒', '生活陪伴', '她的内心']) {
      expect(screen.getByRole('heading', { name: label })).toBeInTheDocument()
    }
    expect(screen.queryByRole('heading', { name: '姐妹工具箱' })).not.toBeInTheDocument()

    // 计划提醒：合并入口 + 经期
    expect(screen.getByRole('link', { name: /日程与提醒/ })).toHaveAttribute('href', '/tools/planner')
    expect(screen.getByRole('link', { name: /大姨妈记录/ })).toHaveAttribute('href', '/tools/period')
    // 生活陪伴
    expect(screen.getByRole('link', { name: /日记/ })).toHaveAttribute('href', '/tools/diary')
    expect(screen.getByRole('link', { name: /手帐打卡/ })).toHaveAttribute('href', '/tools/handbook')
    expect(screen.getByRole('link', { name: /一起读书/ })).toHaveAttribute('href', '/tools/reading')
    expect(screen.getByRole('link', { name: /专注自习/ })).toHaveAttribute('href', '/tools/study')
    // 她的内心
    expect(screen.getByRole('link', { name: /她的工作台/ })).toHaveAttribute('href', '/tools/workspace')
    expect(screen.getByRole('link', { name: /她的信/ })).toHaveAttribute('href', '/tools/letters')
    // 已删除的入口不再出现
    expect(screen.queryByRole('link', { name: /提醒设置/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /自定义提醒/ })).not.toBeInTheDocument()
  })
})
