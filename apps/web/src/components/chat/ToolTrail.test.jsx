import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import ToolTrail from './ToolTrail'

it('不把协议纠正显示成用户交办失败的事情', () => {
  const { container } = render(<ToolTrail runs={[{ tool: '__malformed__', ok: false, summary: '格式纠正' }]} />)
  expect(container).toBeEmptyDOMElement()
})

it('内部纠正不影响真实工具结果，真实失败仍然可见', () => {
  render(<ToolTrail runs={[
    { tool: '__malformed__', ok: false, summary: '格式纠正' },
    { tool: 'calc_convert', ok: true, summary: '算好了' },
    { tool: 'web_search', ok: false, summary: '搜索失败' },
  ]} />)
  expect(screen.getByText('办了 2 件事，1 件没办成')).toBeInTheDocument()
  expect(screen.getByLabelText('执行失败：搜索失败')).toBeInTheDocument()
  expect(screen.queryByText('格式纠正')).not.toBeInTheDocument()
})
