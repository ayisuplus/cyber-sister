import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import ToolsPage from './ToolsPage'

describe('ToolsPage', () => {
  it('exposes implemented capabilities as links with honest privacy notes', () => {
    render(<MemoryRouter><ToolsPage /></MemoryRouter>)

    // 云端切割后虚拟试衣/化妆间已下线，能力注册表只剩浏览器内处理的美颜相机
    expect(screen.getByRole('link', { name: /美颜相机/ })).toHaveAttribute('href', '/tools/beauty-camera')
    expect(screen.queryByRole('link', { name: /虚拟试衣间/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /虚拟化妆间/ })).not.toBeInTheDocument()
    expect(screen.queryByText('规划中')).not.toBeInTheDocument()
    expect(screen.getAllByText('可使用')).toHaveLength(1)
    expect(screen.getByText('全在本机处理')).toBeInTheDocument()
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
