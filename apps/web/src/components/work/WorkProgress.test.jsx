import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import WorkProgress from './WorkProgress'

describe('工作任务步骤', () => {
  it('显示正在执行的工具及最近计划，不把待处理写成完成', () => {
    render(<WorkProgress progress={[
      { tool: 'update_plan', status: 'completed', plan: [{ title: '整理数据', status: 'completed' }, { title: '核对结果', status: 'in_progress' }] },
      { tool: 'calc_convert', status: 'running' },
    ]} />)
    expect(screen.getByRole('status')).toHaveTextContent('计算并核对')
    expect(screen.getByRole('list', { name: '任务步骤' })).toHaveTextContent('进行中核对结果')
  })
  it('重新打开会话后从持久化的工具记录恢复最后计划', () => {
    render(<WorkProgress toolRuns={[
      { plan: [{ title: '旧步骤', status: 'pending' }, { title: '旧收尾', status: 'pending' }] },
      { plan: [{ title: '整理资料', status: 'completed' }, { title: '交付报告', status: 'completed' }] },
    ]} />)
    expect(screen.queryByText('旧步骤')).not.toBeInTheDocument()
    expect(screen.getByRole('list')).toHaveTextContent('已完成交付报告')
  })
  it('只有一步的计划不值得一张清单', () => {
    const { container } = render(<WorkProgress toolRuns={[{ plan: [{ title: '交付报告', status: 'completed' }] }]} />)
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
    expect(container).toBeEmptyDOMElement()
  })
})
