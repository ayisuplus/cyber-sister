import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import WorkDesktop from './WorkDesktop'

const renderDesktop = (props) => render(<MemoryRouter><WorkDesktop {...props} /></MemoryRouter>)

describe('WorkDesktop', () => {
  it('空态变体渲染全部功能入口，href 正确', () => {
    renderDesktop()

    expect(screen.getByRole('navigation', { name: '功能桌面' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /化妆间/ })).toHaveAttribute('href', '/tools/makeup-room')
    expect(screen.getByRole('link', { name: /3D 衣柜/ })).toHaveAttribute('href', '/tools/wardrobe')
    expect(screen.getByRole('link', { name: /日记/ })).toHaveAttribute('href', '/tools/diary')
    expect(screen.getByRole('link', { name: /大姨妈记录/ })).toHaveAttribute('href', '/tools/period')
    expect(screen.getByRole('link', { name: /她的工作台/ })).toHaveAttribute('href', '/tools/workspace')
  })

  it('onClose 变体：遮罩按钮与「关闭」按钮都触发 onClose', () => {
    const onClose = vi.fn()
    renderDesktop({ onClose })

    fireEvent.click(screen.getByRole('button', { name: '关闭功能桌面' }))
    expect(onClose).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: '关闭' }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
