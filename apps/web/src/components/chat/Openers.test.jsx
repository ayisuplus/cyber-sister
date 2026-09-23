import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../services/openerService', () => ({ openerService: { listOpeners: vi.fn() } }))

import Openers from './Openers'
import { openerService } from '../../services/openerService'

const renderOpeners = (props = {}) => render(
  <MemoryRouter>
    <Openers onSend={vi.fn()} onDraft={vi.fn()} {...props} />
  </MemoryRouter>,
)
const topicButtons = () => within(screen.getByRole('group', { name: '开场话题' })).getAllByRole('button')
const draftButtons = () => topicButtons().filter(button => button.title === '填进输入框，改好再发')

// 接口给的三条：她惦记的事、在读的书、最近的手记（手记只作草稿）
const CANDIDATES = [
  { id: 'followup:f1', label: '惦记的：周三答辩', text: '答辩怎么样了？', why: '你之前说过这件事' },
  { id: 'book:b1', label: '《活着》', text: '我在读《活着》，想跟你聊聊这本书', why: '你正在读这本' },
  { id: 'note:n1', label: '上次记的那句', text: '上次我记下的那句我还想着：有庆死了，我哭了好久', draft: true, why: '你最近写下的一行' },
]

describe('Openers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // 默认：候选永远不来——静态池就是这一屏本身
    openerService.listOpeners.mockReturnValue(new Promise(() => {}))
  })

  it('shows four openers: two casual topics and two editable sensitive topics', () => {
    renderOpeners()

    expect(topicButtons()).toHaveLength(4)
    expect(screen.getByRole('button', { name: '今天心情不好' })).toBeInTheDocument()
    expect(draftButtons()).toHaveLength(2)
  })

  it('sends casual topics directly but only drafts sensitive ones', async () => {
    const user = userEvent.setup()
    const onSend = vi.fn()
    const onDraft = vi.fn()
    renderOpeners({ onSend, onDraft })

    await user.click(screen.getByRole('button', { name: '推荐个电影' }))
    expect(onSend).toHaveBeenCalledWith('推荐个电影')

    await user.click(draftButtons()[0])
    expect(onDraft).toHaveBeenCalledTimes(1)
    expect(onSend).toHaveBeenCalledTimes(1)
  })

  it('disables only the sensitive openers while the user already has a draft', () => {
    renderOpeners({ draftLocked: true })

    for (const button of draftButtons()) expect(button).toBeDisabled()
    expect(screen.getByRole('button', { name: '今天心情不好' })).toBeEnabled()
  })

  it('only offers topics: her own messages live in the conversation, not here', () => {
    renderOpeners()

    expect(topicButtons()).toHaveLength(4)
    expect(screen.queryByLabelText('她来想你')).not.toBeInTheDocument()
  })

  it('候选到之前先摆静态池，到了以后候选在前、静态池补足到四条', async () => {
    openerService.listOpeners.mockResolvedValue(CANDIDATES)
    renderOpeners()

    expect(topicButtons()).toHaveLength(4)
    expect(screen.getByRole('button', { name: '推荐个电影' })).toBeInTheDocument()

    expect(await screen.findByRole('button', { name: /惦记的：周三答辩/ })).toBeInTheDocument()
    const labels = topicButtons().map(button => button.textContent)
    expect(labels).toHaveLength(4)
    expect(labels[0]).toContain('惦记的：周三答辩')
    expect(labels[1]).toContain('《活着》')
    expect(labels[2]).toContain('上次记的那句')
    // 第四条由本机静态池补足，多出来的旧话题让位
    expect(labels[3]).toContain('今天心情不好')
    expect(screen.queryByRole('button', { name: '推荐个电影' })).not.toBeInTheDocument()
  })

  it('每条候选都如实写出「为什么看到这条」', async () => {
    openerService.listOpeners.mockResolvedValue(CANDIDATES)
    renderOpeners()

    expect(await screen.findByRole('button', { name: /惦记的：周三答辩/ })).toHaveTextContent('你之前说过这件事')
    expect(screen.getByRole('button', { name: /《活着》/ })).toHaveTextContent('你正在读这本')
    expect(screen.getByRole('button', { name: /上次记的那句/ })).toHaveTextContent('你最近写下的一行')
  })

  it('接口失败时安静地留着静态池：没有错误提示，也不空着', async () => {
    openerService.listOpeners.mockRejectedValue(new Error('offline'))
    renderOpeners()

    await act(async () => {})
    expect(topicButtons()).toHaveLength(4)
    expect(screen.getByRole('button', { name: '今天心情不好' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '推荐个电影' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('手记那条只填进输入框，绝不自动发出去；输入框已有内容就置灰', async () => {
    const user = userEvent.setup()
    const onSend = vi.fn()
    const onDraft = vi.fn()
    openerService.listOpeners.mockResolvedValue(CANDIDATES)
    const { rerender } = renderOpeners({ onSend, onDraft })

    const note = await screen.findByRole('button', { name: /上次记的那句/ })
    await user.click(note)

    expect(onDraft).toHaveBeenCalledWith('上次我记下的那句我还想着：有庆死了，我哭了好久')
    expect(onSend).not.toHaveBeenCalled()

    rerender(
      <MemoryRouter>
        <Openers onSend={onSend} onDraft={onDraft} draftLocked />
      </MemoryRouter>,
    )
    expect(screen.getByRole('button', { name: /上次记的那句/ })).toBeDisabled()
    // 她惦记的事、在读的书都不是草稿，照样一点即发
    await user.click(screen.getByRole('button', { name: /惦记的：周三答辩/ }))
    expect(onSend).toHaveBeenCalledWith('答辩怎么样了？')
  })
})
