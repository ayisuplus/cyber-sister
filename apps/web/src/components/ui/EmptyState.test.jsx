import { render, screen } from '@testing-library/react'
import { ListTodo } from 'lucide-react'
import { describe, expect, it } from 'vitest'
import EmptyState from './EmptyState'

describe('EmptyState', () => {
  it('renders the icon, title and optional description', () => {
    render(<EmptyState icon={ListTodo} title="暂无待办事项" description="点击下方按钮添加" />)

    expect(screen.getByText('暂无待办事项')).toBeInTheDocument()
    expect(screen.getByText('点击下方按钮添加')).toBeInTheDocument()
  })

  it('renders an optional action node and works without icon or description', () => {
    render(<EmptyState title="空空如也" action={<button type="button">去添加</button>} />)

    expect(screen.getByRole('button', { name: '去添加' })).toBeInTheDocument()
    expect(screen.getByText('空空如也')).toBeInTheDocument()
  })
})
