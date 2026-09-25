import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../services/letterService', () => ({ letterService: { decide: vi.fn() } }))

import { letterService } from '../../services/letterService'
import SuggestionActions from './SuggestionActions'

const PAIR = [{ id: 'a', revision: 2, content: '喜欢火锅' }, { id: 'b', revision: 1, content: '爱吃火锅' }]
const MERGE = { kind: 'merge_memories', title: '这两条是一回事', suggestText: '我喜欢吃火锅', inferenceIds: ['r1'], pair: PAIR, decided: null }
const CONFLICT = {
  kind: 'resolve_conflict', title: '这两条对不上', suggestText: '平时独居，周末和朋友合住', inferenceIds: ['r2'], decided: null,
  pair: [{ id: 'a', revision: 2, content: '想独居' }, { id: 'b', revision: 1, content: '想合住' }],
}
const PROMOTE = { kind: 'promote_inference', title: '记下来吧', quote: '又是凌晨三点还醒着', suggestText: '我一紧张就睡不着', inferenceIds: ['i1'], decided: null }

const decidedAs = (decision) => ({ letter: { suggestions: [{ decided: decision === 'accept' ? 'accepted' : 'dismissed' }] } })

beforeEach(() => {
  vi.clearAllMocks()
  letterService.decide.mockImplementation((_id, _index, { decision }) => Promise.resolve(decidedAs(decision)))
})

describe('来信里从她的整理来的建议（路线图 C23）', () => {
  it('合并两条：并列给你看两条和合成后的一句；删掉第二条之前先确认', async () => {
    const user = userEvent.setup()
    render(<SuggestionActions letterId="l1" index={0} item={MERGE} />)

    expect(screen.getByText('觉得这两条说的是一回事')).toBeInTheDocument()
    expect(screen.getByText('喜欢火锅')).toBeInTheDocument()
    expect(screen.getByText('爱吃火锅')).toBeInTheDocument()
    expect(screen.getByText('合成一句：我喜欢吃火锅')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '同意采纳' }))
    expect(letterService.decide).not.toHaveBeenCalled()
    const dialog = screen.getByRole('alertdialog')
    expect(dialog).toHaveTextContent('「爱吃火锅」删掉，找不回来')
    await user.click(within(dialog).getByRole('button', { name: '合成一条' }))

    expect(letterService.decide).toHaveBeenCalledWith('l1', 0, { decision: 'accept' })
    expect(await screen.findByText('已采纳')).toBeInTheDocument()
  })

  it('定夺矛盾：每条下面「留这条」，确认后带上留哪条；也可以改成她建议的说法', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<SuggestionActions letterId="l1" index={0} item={CONFLICT} />)

    expect(screen.queryByRole('button', { name: '同意采纳' })).not.toBeInTheDocument()
    expect(screen.getByText('她建议的说法：平时独居，周末和朋友合住')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '留这条：想合住' }))
    const dialog = screen.getByRole('alertdialog')
    expect(dialog).toHaveTextContent('留下「想合住」，「想独居」删掉')
    await user.click(within(dialog).getByRole('button', { name: '留这一条' }))
    expect(letterService.decide).toHaveBeenCalledWith('l1', 0, { decision: 'accept', keep: 'b' })
    unmount()

    render(<SuggestionActions letterId="l1" index={0} item={CONFLICT} />)
    await user.click(screen.getByRole('button', { name: '改成她说的' }))
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '就这样改' }))
    expect(letterService.decide).toHaveBeenLastCalledWith('l1', 0, { decision: 'accept', keep: 'edit' })
  })

  it('定夺矛盾：两条都对就「都对，不用改」', async () => {
    const user = userEvent.setup()
    render(<SuggestionActions letterId="l1" index={0} item={{ ...CONFLICT, suggestText: '' }} />)

    expect(screen.queryByRole('button', { name: '改成她说的' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '都对，不用改' }))

    expect(letterService.decide).toHaveBeenCalledWith('l1', 0, { decision: 'dismiss' })
    expect(await screen.findByText('没采纳')).toBeInTheDocument()
  })

  it('把她猜的记下来：写明她听你说过的原话和要记成的一句，同意就记', async () => {
    const user = userEvent.setup()
    render(<SuggestionActions letterId="l1" index={0} item={PROMOTE} />)

    expect(screen.getByText('想请你记下这一条')).toBeInTheDocument()
    expect(screen.getByText('她听你说过：「又是凌晨三点还醒着」')).toBeInTheDocument()
    expect(screen.getByText('记成：我一紧张就睡不着')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '同意采纳' }))

    expect(letterService.decide).toHaveBeenCalledWith('l1', 0, { decision: 'accept' })
  })

  it('依据已经变了（409）：如实说一声，按钮还在', async () => {
    const user = userEvent.setup()
    letterService.decide.mockRejectedValue({ response: { data: { error: '这条建议依据的记忆已经变了，先看看现在的样子再说' } } })
    render(<SuggestionActions letterId="l1" index={0} item={PROMOTE} />)

    await user.click(screen.getByRole('button', { name: '同意采纳' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('这条建议依据的记忆已经变了')
    expect(screen.getByRole('button', { name: '同意采纳' })).toBeEnabled()
  })
})
