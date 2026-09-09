import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../services/derivedService', () => ({
  derivedService: {
    list: vi.fn(),
    analyze: vi.fn(),
    promote: vi.fn(),
    resolve: vi.fn(),
    rebuild: vi.fn(),
    dismiss: vi.fn(),
    clear: vi.fn(),
    listEdges: vi.fn(),
    promoteEdge: vi.fn(),
    dismissEdge: vi.fn(),
  },
}))

import { derivedService } from '../services/derivedService'
import WorkspacePage from './WorkspacePage'

const renderPage = () => render(<MemoryRouter><WorkspacePage /></MemoryRouter>)

const INSIGHTS = [
  {
    id: 'i1',
    kind: 'pattern',
    content: '她习惯深夜学习',
    confidence: 'medium',
    evidence: '["最近都聊到凌晨","她说晚上效率高"]',
    status: 'active',
    createdAt: '2026-09-07T10:00:00.000Z',
  },
  {
    id: 'i2',
    kind: 'hypothesis',
    content: '她可能在准备考试',
    confidence: 'low',
    evidence: null,
    status: 'active',
    createdAt: '2026-09-07T09:00:00.000Z',
  },
]

const EDGES = [
  {
    id: 'e1',
    relation: 'similar',
    confidence: 'high',
    status: 'derived',
    evidence: ['都提到火锅'],
    from: { id: 'm1', content: '喜欢火锅' },
    to: { id: 'm2', content: '每周五吃火锅' },
    createdAt: '2026-09-09T00:00:00.000Z',
  },
  {
    id: 'e2',
    relation: 'contradicts',
    confidence: 'low',
    status: 'canonical',
    evidence: [],
    from: { id: 'm3', content: '想独居' },
    to: { id: 'm4', content: '想合住' },
    createdAt: '2026-09-08T00:00:00.000Z',
  },
  {
    id: 'e3',
    relation: 'related',
    confidence: 'medium',
    status: 'dismissed',
    evidence: [],
    from: { id: 'm5', content: '已忽略的甲' },
    to: { id: 'm6', content: '已忽略的乙' },
    createdAt: '2026-09-07T00:00:00.000Z',
  },
]

describe('WorkspacePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    derivedService.list.mockResolvedValue({ insights: INSIGHTS })
    derivedService.analyze.mockResolvedValue({ created: 2, skipped: 0 })
    derivedService.promote.mockResolvedValue({ memory: { id: 'm1' }, insight: { id: 'i1', status: 'promoted' } })
    derivedService.dismiss.mockResolvedValue({ success: true })
    derivedService.clear.mockResolvedValue({ cleared: 2 })
    derivedService.resolve.mockResolvedValue({ memory: { id: 'm2' }, insight: { id: 'i3', status: 'resolved' } })
    derivedService.rebuild.mockResolvedValue({ cleared: 2, created: 1, skipped: 0 })
    derivedService.listEdges.mockResolvedValue({ edges: EDGES })
    derivedService.promoteEdge.mockResolvedValue({ edge: { ...EDGES[0], status: 'canonical' } })
    derivedService.dismissEdge.mockResolvedValue({ success: true })
  })

  it('renders active insights with kind badge, confidence and expandable evidence', async () => {
    const user = userEvent.setup()

    renderPage()

    expect(await screen.findByText('她习惯深夜学习')).toBeInTheDocument()
    expect(screen.getByText('模式')).toBeInTheDocument()
    expect(screen.getByText('推测')).toBeInTheDocument()
    expect(screen.getByText('把握中等')).toBeInTheDocument()
    expect(screen.getByText('把握较低')).toBeInTheDocument()
    expect(screen.getByText('她可能在准备考试')).toBeInTheDocument()

    await user.click(screen.getByText('看看依据'))
    expect(screen.getByText('「最近都聊到凌晨」')).toBeInTheDocument()
  })

  it('promotes an insight through the edit form with chosen type, importance and tags', async () => {
    const user = userEvent.setup()

    renderPage()
    const card = (await screen.findByText('她习惯深夜学习')).closest('article')
    await user.click(within(card).getByRole('button', { name: '这条算数' }))

    await user.selectOptions(screen.getByLabelText('类型'), 'episodic')
    const importance = screen.getByLabelText('重要度（1–10）')
    await user.clear(importance)
    await user.type(importance, '8')
    await user.type(screen.getByLabelText('标签（逗号分隔）'), '学习，作息')
    await user.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(derivedService.promote).toHaveBeenCalledWith('i1', {
      type: 'episodic',
      importance: 8,
      tags: ['学习', '作息'],
    }))
    expect(await within(card).findByText('已记入记忆')).toBeInTheDocument()
  })

  it('dismisses an insight and removes the card', async () => {
    const user = userEvent.setup()

    renderPage()
    expect(await screen.findByText('她可能在准备考试')).toBeInTheDocument()
    const card = screen.getByText('她可能在准备考试').closest('article')
    await user.click(within(card).getByRole('button', { name: '不算' }))

    await waitFor(() => expect(derivedService.dismiss).toHaveBeenCalledWith('i2'))
    await waitFor(() => expect(screen.queryByText('她可能在准备考试')).not.toBeInTheDocument())
    expect(screen.getByText('她习惯深夜学习')).toBeInTheDocument()
  })

  it('clears the workspace after confirmation and shows the empty state', async () => {
    const user = userEvent.setup()
    derivedService.list
      .mockResolvedValueOnce({ insights: INSIGHTS })
      .mockResolvedValue({ insights: [] })

    renderPage()
    await screen.findByText('她习惯深夜学习')
    await user.click(screen.getByRole('button', { name: '清空工作台' }))
    await user.click(screen.getByRole('button', { name: '确认清空' }))

    await waitFor(() => expect(derivedService.clear).toHaveBeenCalledOnce())
    expect(await screen.findByText('已清空 2 条')).toBeInTheDocument()
    expect(screen.getByText('工作台还是空的。多聊几句，或点上面让她现在整理一下。')).toBeInTheDocument()
  })

  it('shows the created count after a manual analysis', async () => {
    const user = userEvent.setup()

    renderPage()
    await screen.findByText('她习惯深夜学习')
    await user.click(screen.getByRole('button', { name: '让她现在整理一下' }))

    expect(await screen.findByText('新增了 2 条')).toBeInTheDocument()
    expect(derivedService.analyze).toHaveBeenCalledOnce()
  })

  it('maps consent and availability failures to inline guidance', async () => {
    const user = userEvent.setup()
    derivedService.analyze.mockRejectedValue({ response: { data: { code: 'CLOUD_NOT_CONSENTED' } } })

    renderPage()
    await screen.findByText('她习惯深夜学习')
    await user.click(screen.getByRole('button', { name: '让她现在整理一下' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('需要先在「我的 → 云端模型」同意')

    derivedService.analyze.mockRejectedValue({ response: { data: { code: 'LLM_UNAVAILABLE' } } })
    await user.click(screen.getByRole('button', { name: '让她现在整理一下' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('云端模型暂时不可用')
  })

  it('shows the empty state copy when the workspace has no insights', async () => {
    derivedService.list.mockResolvedValue({ insights: [] })

    renderPage()

    expect(await screen.findByText('工作台还是空的。多聊几句，或点上面让她现在整理一下。')).toBeInTheDocument()
  })

  it('shows a retryable error when loading fails', async () => {
    const user = userEvent.setup()
    derivedService.list.mockRejectedValueOnce(new Error('offline'))

    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent('加载失败，请检查网络后重试')
    await user.click(screen.getByRole('button', { name: '重试' }))
    expect(derivedService.list).toHaveBeenCalledTimes(2)
    expect(await screen.findByText('她习惯深夜学习')).toBeInTheDocument()
  })

  it('switches status tabs and queries the selected status', async () => {
    const user = userEvent.setup()
    derivedService.list.mockResolvedValue({ insights: [] })

    renderPage()
    await screen.findByText('工作台还是空的。多聊几句，或点上面让她现在整理一下。')
    await user.click(screen.getByRole('button', { name: '已厘清' }))

    await waitFor(() => expect(derivedService.list).toHaveBeenCalledWith('resolved'))
    expect(await screen.findByText('这一类还是空的。')).toBeInTheDocument()
  })

  it('switches to 关系 tab, queries listEdges(all) and renders edge cards with relation labels', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('她习惯深夜学习')

    await user.click(screen.getByRole('button', { name: '关系' }))

    await waitFor(() => expect(derivedService.listEdges).toHaveBeenCalledWith('all'))
    expect(await screen.findByText('喜欢火锅 —相似→ 每周五吃火锅')).toBeInTheDocument()
    expect(screen.getByText('想独居 —冲突→ 想合住')).toBeInTheDocument()
    expect(screen.getByText('把握较高')).toBeInTheDocument()
    // derived 边有「不算」「确认关系」两颗按钮；canonical 边只读
    expect(screen.getByRole('button', { name: '不算' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '确认关系' })).toBeInTheDocument()
    expect(screen.getByText('已定为关系')).toBeInTheDocument()
    // dismissed 边不渲染
    expect(screen.queryByText(/已忽略的甲/)).not.toBeInTheDocument()

    await user.click(screen.getByText('看看依据'))
    expect(screen.getByText('「都提到火锅」')).toBeInTheDocument()
  })

  it('confirms an edge in place to read-only 已定为关系', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('她习惯深夜学习')
    await user.click(screen.getByRole('button', { name: '关系' }))
    await screen.findByText('喜欢火锅 —相似→ 每周五吃火锅')

    await user.click(screen.getByRole('button', { name: '确认关系' }))

    expect(derivedService.promoteEdge).toHaveBeenCalledWith('e1')
    await waitFor(() => expect(screen.getAllByText('已定为关系')).toHaveLength(2))
    expect(screen.queryByRole('button', { name: '确认关系' })).not.toBeInTheDocument()
  })

  it('dismisses an edge and removes the card', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('她习惯深夜学习')
    await user.click(screen.getByRole('button', { name: '关系' }))
    await screen.findByText('喜欢火锅 —相似→ 每周五吃火锅')

    await user.click(screen.getByRole('button', { name: '不算' }))

    expect(derivedService.dismissEdge).toHaveBeenCalledWith('e1')
    await waitFor(() => expect(screen.queryByText('喜欢火锅 —相似→ 每周五吃火锅')).not.toBeInTheDocument())
  })

  it('shows the edges empty state copy', async () => {
    const user = userEvent.setup()
    derivedService.listEdges.mockResolvedValue({ edges: [] })
    renderPage()
    await screen.findByText('她习惯深夜学习')

    await user.click(screen.getByRole('button', { name: '关系' }))

    expect(await screen.findByText('还没有她发现的关系，多点上面让她整理')).toBeInTheDocument()
  })

  it('shows 厘清一下 only on conflict cards, prefills content and saves the resolution', async () => {
    const user = userEvent.setup()
    derivedService.list.mockResolvedValue({
      insights: [
        ...INSIGHTS,
        {
          id: 'i3',
          kind: 'conflict',
          content: '她既想独居又想合住',
          confidence: 'high',
          evidence: null,
          status: 'active',
          createdAt: '2026-09-07T08:00:00.000Z',
        },
      ],
    })

    renderPage()
    const conflictCard = (await screen.findByText('她既想独居又想合住')).closest('article')
    const patternCard = screen.getByText('她习惯深夜学习').closest('article')
    expect(within(conflictCard).getByRole('button', { name: '厘清一下' })).toBeInTheDocument()
    expect(within(patternCard).queryByRole('button', { name: '厘清一下' })).not.toBeInTheDocument()

    await user.click(within(conflictCard).getByRole('button', { name: '厘清一下' }))
    const draft = screen.getByLabelText('定稿文案')
    expect(draft).toHaveValue('她既想独居又想合住')
    await user.clear(draft)
    await user.type(draft, '她想要的是独立书房')
    await user.selectOptions(screen.getByLabelText('类型'), 'episodic')
    await user.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(derivedService.resolve).toHaveBeenCalledWith('i3', {
      content: '她想要的是独立书房',
      type: 'episodic',
      importance: 5,
      tags: [],
    }))
    expect(await within(conflictCard).findByText('已厘清并记入记忆')).toBeInTheDocument()
  })

  it('rebuilds the workspace after confirmation, shows counts and reloads the tab', async () => {
    const user = userEvent.setup()

    renderPage()
    await screen.findByText('她习惯深夜学习')
    await user.click(screen.getByRole('button', { name: '重建工作台' }))
    await user.click(screen.getByRole('button', { name: '确认重建' }))

    await waitFor(() => expect(derivedService.rebuild).toHaveBeenCalledOnce())
    expect(await screen.findByText('已重建：清掉 2 条，新增 1 条')).toBeInTheDocument()
    expect(derivedService.list).toHaveBeenLastCalledWith('active')
  })

  it('maps rebuild consent failure to inline guidance without clearing rows', async () => {
    const user = userEvent.setup()
    derivedService.rebuild.mockRejectedValue({ response: { data: { code: 'CLOUD_NOT_CONSENTED' } } })

    renderPage()
    await screen.findByText('她习惯深夜学习')
    await user.click(screen.getByRole('button', { name: '重建工作台' }))
    await user.click(screen.getByRole('button', { name: '确认重建' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('需要先在「我的 → 云端模型」同意')
  })

  it('shows the stored resolution without action buttons on resolved cards', async () => {
    const user = userEvent.setup()
    derivedService.list.mockImplementation((status) => Promise.resolve({
      insights: status === 'resolved'
        ? [{
            id: 'i3',
            kind: 'conflict',
            content: '她既想独居又想合住',
            confidence: 'high',
            evidence: null,
            status: 'resolved',
            resolution: '她想要的是独立书房',
            createdAt: '2026-09-07T08:00:00.000Z',
          }]
        : [],
    }))

    renderPage()
    await screen.findByText('工作台还是空的。多聊几句，或点上面让她现在整理一下。')
    await user.click(screen.getByRole('button', { name: '已厘清' }))

    const card = (await screen.findByText('她既想独居又想合住')).closest('article')
    expect(within(card).getByText('她想要的是独立书房')).toBeInTheDocument()
    expect(within(card).queryByRole('button')).not.toBeInTheDocument()
  })
})
