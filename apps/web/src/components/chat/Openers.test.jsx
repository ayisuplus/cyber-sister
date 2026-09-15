import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../services/careService', () => ({ careService: { list: vi.fn(), dismiss: vi.fn() } }))

import { careService } from '../../services/careService'
import Openers from './Openers'

const renderOpeners = (props = {}) => render(
  <MemoryRouter>
    <Openers onSend={vi.fn()} onDraft={vi.fn()} {...props} />
  </MemoryRouter>,
)
const topicButtons = () => within(screen.getByRole('group', { name: '开场话题' })).getAllByRole('button')
const draftButtons = () => topicButtons().filter(button => button.title === '填进输入框，改好再发')

describe('Openers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    careService.list.mockResolvedValue({ touchpoints: [] })
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

  it('lets her care cards take up to two of the four slots', async () => {
    careService.list.mockResolvedValue({
      touchpoints: [
        { key: 'a', kind: 'mood', title: '这几天心情有点低', body: '想聊聊吗？', reason: '最近的日记' },
        { key: 'b', kind: 'period', title: '经期快到了', body: '记得备好用品。', reason: '经期记录推算' },
        { key: 'c', kind: 'birthday', title: '今天是你生日', body: '生日快乐。', reason: '资料里的生日' },
      ],
    })
    renderOpeners({ withCare: true })

    expect(await screen.findByText('这几天心情有点低')).toBeInTheDocument()
    expect(screen.getByText('经期快到了')).toBeInTheDocument()
    expect(screen.queryByText('今天是你生日')).not.toBeInTheDocument()
    expect(topicButtons()).toHaveLength(2)
  })
})
