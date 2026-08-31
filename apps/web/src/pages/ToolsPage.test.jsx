import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import ToolsPage from './ToolsPage'

describe('ToolsPage', () => {
  it('exposes implemented capabilities as links with honest privacy notes', () => {
    render(<MemoryRouter><ToolsPage /></MemoryRouter>)

    expect(screen.getByRole('link', { name: /妆教/ })).toHaveAttribute('href', '/makeup/')
    expect(screen.getByRole('link', { name: /虚拟试衣间/ })).toHaveAttribute('href', '/tools/virtual-fitting')
    expect(screen.getByRole('link', { name: /虚拟化妆间/ })).toHaveAttribute('href', '/tools/virtual-makeup')
    expect(screen.getByRole('link', { name: /美颜相机/ })).toHaveAttribute('href', '/tools/beauty-camera')
    expect(screen.queryByText('规划中')).not.toBeInTheDocument()
    expect(screen.getAllByText('可使用')).toHaveLength(4)
    expect(screen.getAllByText('照片不出浏览器 · 生图接入中')).toHaveLength(2)
    expect(screen.getByText('全在本机处理')).toBeInTheDocument()
  })
  it('links every sister toolbox entry to its SPA route', () => {
    render(<MemoryRouter><ToolsPage /></MemoryRouter>)

    expect(screen.getByRole('heading', { name: '姐妹工具箱' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /大姨妈记录/ })).toHaveAttribute('href', '/tools/period')
    expect(screen.getByRole('link', { name: /倒数日/ })).toHaveAttribute('href', '/tools/countdown')
    expect(screen.getByRole('link', { name: /待办清单/ })).toHaveAttribute('href', '/tools/todo')
    expect(screen.getByRole('link', { name: /提醒设置/ })).toHaveAttribute('href', '/settings')
  })
})
