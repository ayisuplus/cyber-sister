import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../services/memoryService', () => ({ memoryService: { listInferences: vi.fn(), vetoInference: vi.fn() } }))

import { memoryService } from '../../services/memoryService'
import HerGuesses from './HerGuesses'

const GUESSES = [
  { id: 'r1', kind: 'relation', content: '「喜欢火锅」与「每周五吃火锅」说的可能是一回事', because: ['喜欢火锅'] },
  { id: 'f1', kind: 'followup', content: '答辩怎么样了？', because: ['周三要答辩了'], dueOn: '2026-09-24' },
]

beforeEach(() => {
  vi.clearAllMocks()
  memoryService.listInferences.mockResolvedValue(GUESSES)
  memoryService.vetoInference.mockResolvedValue({ success: true })
})

describe('「她猜的」', () => {
  it('列出她自己整理的，标明没经你确认，带上依据原话', async () => {
    render(<HerGuesses />)

    expect(await screen.findByRole('heading', { name: '她猜的' })).toBeInTheDocument()
    expect(screen.getByText(/没经你确认，不算她记得的你/)).toBeInTheDocument()
    expect(screen.getByText('她觉得这两条有关')).toBeInTheDocument()
    expect(screen.getByText('她惦记着，9月24日问一句')).toBeInTheDocument()
    expect(screen.getByText('依据：「周三要答辩了」')).toBeInTheDocument()
  })

  it('删掉一条：她不会再这样猜，这一条从列表里拿掉', async () => {
    const user = userEvent.setup()
    render(<HerGuesses />)

    await user.click(await screen.findByRole('button', { name: /删掉她的这个猜测：答辩怎么样了/ }))

    expect(memoryService.vetoInference).toHaveBeenCalledWith('f1')
    expect(await screen.findByRole('status')).toHaveTextContent('删掉了，她不会再这样猜')
    expect(screen.queryByText('答辩怎么样了？')).not.toBeInTheDocument()
  })

  it('没有、或者取不到，就整段不出现', async () => {
    memoryService.listInferences.mockResolvedValue([])
    const { container, rerender } = render(<HerGuesses />)
    await waitFor(() => expect(memoryService.listInferences).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()

    memoryService.listInferences.mockRejectedValue(new Error('offline'))
    rerender(<HerGuesses refreshKey={1} />)
    await waitFor(() => expect(memoryService.listInferences).toHaveBeenCalledTimes(2))
    expect(container).toBeEmptyDOMElement()
  })

  it('你改过或删过记忆（refreshKey 变了）就重新读：靠旧说法的猜测可能已经作废', async () => {
    const { rerender } = render(<HerGuesses refreshKey={0} />)
    await screen.findByText('答辩怎么样了？')

    memoryService.listInferences.mockResolvedValue([GUESSES[1]])
    rerender(<HerGuesses refreshKey={1} />)

    await waitFor(() => expect(screen.queryByText(/说的可能是一回事/)).not.toBeInTheDocument())
  })
})
