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

    // 化妆间（本机处理 + 自定义预设）与 3D 衣柜（外部图生 3D）为当前可用能力
    expect(screen.getByRole('link', { name: /化妆间/ })).toHaveAttribute('href', '/tools/makeup-room')
    expect(screen.getByRole('link', { name: /3D 衣柜/ })).toHaveAttribute('href', '/tools/wardrobe')
    expect(screen.queryByRole('link', { name: /虚拟试衣间/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /虚拟化妆间/ })).not.toBeInTheDocument()
    expect(screen.queryByText('规划中')).not.toBeInTheDocument()
    expect(screen.getAllByText('可使用')).toHaveLength(2)
    expect(screen.getByText('照片全在本机处理')).toBeInTheDocument()
  })
  it('links every sister toolbox entry to its SPA route', () => {
    render(<MemoryRouter><ToolsPage /></MemoryRouter>)

    expect(screen.getByRole('heading', { name: '姐妹工具箱' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /大姨妈记录/ })).toHaveAttribute('href', '/tools/period')
    expect(screen.getByRole('link', { name: /倒数日/ })).toHaveAttribute('href', '/tools/countdown')
    expect(screen.getByRole('link', { name: /日程/ })).toHaveAttribute('href', '/tools/todo')
    expect(screen.getByRole('link', { name: /日记/ })).toHaveAttribute('href', '/tools/diary')
    expect(screen.getByRole('link', { name: /手帐打卡/ })).toHaveAttribute('href', '/tools/handbook')
    expect(screen.getByRole('link', { name: /提醒设置/ })).toHaveAttribute('href', '/settings')
  })
})
