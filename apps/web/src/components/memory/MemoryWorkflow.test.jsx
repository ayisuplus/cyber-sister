import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../services/memoryService', () => ({
  memoryService: Object.fromEntries(['listPage', 'create', 'update', 'remove', 'setPinned'].map((name) => [name, vi.fn()])),
}))
vi.mock('../../services/letterService', () => ({
  letterService: Object.fromEntries(['generate', 'list', 'get', 'read', 'decide'].map((name) => [name, vi.fn()])),
}))
vi.mock('../../services/userService', () => ({ profileService: { get: vi.fn(), update: vi.fn() } }))
// 「她」页面里的说话方式与节奏面板各有测试；这里只看来信建议与最小记忆列表
vi.mock('../chat/CompanionStatePanel', () => ({ default: () => null }))
vi.mock('../services/authService', () => ({ authService: { updatePersona: vi.fn() } }))

import { memoryService } from '../../services/memoryService'
import { letterService } from '../../services/letterService'
import { profileService } from '../../services/userService'
import { useAuthStore } from '../../stores/authStore'
import HerPage from '../../pages/HerPage'

const EDIT_SUGGESTION = {
  kind: 'edit_memory', title: '把这条改准确', memoryId: 'm1', memoryRevision: 2,
  quote: '喜欢桂花味', suggestText: '喜欢桂花味的拿铁', chatText: '就按你信里说的改吧', decided: null,
}
const REMOVE_SUGGESTION = { ...EDIT_SUGGESTION, kind: 'delete_memory', title: '忘掉这条', suggestText: '', chatText: null }
const PLAN_SUGGESTION = {
  kind: 'plan', title: '把复诊安排上', memoryId: null, memoryRevision: null, quote: null,
  suggestText: '去复诊', instruction: null, planDate: null, chatText: '帮我把复诊安排上', decided: null,
}

const LETTER = {
  id: 'l1', periodStart: '2026-09-09T00:00:00.000Z',
  content: '见信好。\n\n最近做完了不少事。',
  suggestions: [EDIT_SUGGESTION, PLAN_SUGGESTION, REMOVE_SUGGESTION],
}

// 「带去对话」的落点：把路由状态里的草稿亮出来，好断言交接通道
function ChatProbe() {
  const location = useLocation()
  return <p>草稿：{location.state?.compose ?? '（空）'}</p>
}

const renderPage = () => render(
  <MemoryRouter initialEntries={['/her']}>
    <Routes>
      <Route path="/her" element={<HerPage />} />
      <Route path="/chat" element={<ChatProbe />} />
    </Routes>
  </MemoryRouter>,
)

beforeEach(() => {
  vi.resetAllMocks()
  useAuthStore.setState({ token: 't', isLoggedIn: true, user: { id: 'u1', persona: 'gentle' } })
  profileService.get.mockResolvedValue({ letterFreqDays: 3 })
  profileService.update.mockImplementation(async (payload) => payload)
  letterService.generate.mockResolvedValue({ letter: LETTER, created: false, reason: 'not_due' })
  letterService.list.mockResolvedValue([LETTER])
  letterService.read.mockResolvedValue({ success: true })
  letterService.decide.mockImplementation(async (id, index, { decision }) => ({
    letter: {
      ...LETTER,
      suggestions: LETTER.suggestions.map((item, i) => (i === index ? { ...item, decided: decision === 'accept' ? 'accepted' : 'dismissed' } : item)),
    },
  }))
  memoryService.listPage.mockResolvedValue({ data: [], total: 0 })
})

describe('来信建议的三个一键动作', () => {
  it('她页显示最新来信的正文与每条建议的三个动作，并记下读过', async () => {
    renderPage()

    expect(await screen.findByText('见信好。')).toBeInTheDocument()
    expect(screen.getByText('最近做完了不少事。')).toBeInTheDocument()
    for (const title of ['把这条改准确', '把复诊安排上', '忘掉这条']) {
      const section = screen.getByRole('region', { name: title })
      for (const action of ['同意采纳', '带去对话', '不用']) {
        expect(within(section).getByRole('button', { name: action })).toBeInTheDocument()
      }
    }
    expect(letterService.read).toHaveBeenCalledWith('l1')
  })

  it('「带去对话」把引导句带去 /chat 的输入框（一次性路由状态）', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('见信好。')

    await user.click(within(screen.getByRole('region', { name: '把这条改准确' })).getByRole('button', { name: '带去对话' }))

    expect(await screen.findByText('草稿：就按你信里说的改吧')).toBeInTheDocument()
    expect(letterService.decide).not.toHaveBeenCalled()
  })

  it('「同意采纳」走 decide（accept），条目变成「已采纳」', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('见信好。')

    await user.click(within(screen.getByRole('region', { name: '把这条改准确' })).getByRole('button', { name: '同意采纳' }))

    expect(letterService.decide).toHaveBeenCalledWith('l1', 0, { decision: 'accept' })
    expect(await within(screen.getByRole('region', { name: '把这条改准确' })).findByText('已采纳')).toBeInTheDocument()
  })

  it('「不用」走 decide（dismiss），条目变成「没采纳」，不碰记忆与安排', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('见信好。')

    await user.click(within(screen.getByRole('region', { name: '把复诊安排上' })).getByRole('button', { name: '不用' }))

    expect(letterService.decide).toHaveBeenCalledWith('l1', 1, { decision: 'dismiss' })
    expect(await within(screen.getByRole('region', { name: '把复诊安排上' })).findByText('没采纳')).toBeInTheDocument()
    expect(memoryService.update).not.toHaveBeenCalled()
  })

  it('删除类建议先问一句再采纳', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('见信好。')

    await user.click(within(screen.getByRole('region', { name: '忘掉这条' })).getByRole('button', { name: '同意采纳' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText('删掉后不再出现在她记得的你里。')).toBeInTheDocument()
    expect(letterService.decide).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole('button', { name: '删掉' }))
    expect(letterService.decide).toHaveBeenCalledWith('l1', 2, { decision: 'accept' })
    expect(await within(screen.getByRole('region', { name: '忘掉这条' })).findByText('已采纳')).toBeInTheDocument()
  })

  it('处理失败行内报错，可以重试', async () => {
    const user = userEvent.setup()
    letterService.decide.mockRejectedValueOnce({ response: { status: 409, data: { error: '这条建议已经处理过了' } } })
    renderPage()
    await screen.findByText('见信好。')

    await user.click(within(screen.getByRole('region', { name: '把这条改准确' })).getByRole('button', { name: '同意采纳' }))
    expect(await screen.findByText('这条建议已经处理过了')).toBeInTheDocument()
    expect(screen.queryByText('已采纳')).not.toBeInTheDocument()

    await user.click(within(screen.getByRole('region', { name: '把这条改准确' })).getByRole('button', { name: '同意采纳' }))
    expect(await screen.findByText('已采纳')).toBeInTheDocument()
  })
})

describe('最小记忆列表', () => {
  it('没有搜索、清空与「她是怎么记住的」，只有放在心上、改一改、删除', async () => {
    memoryService.listPage.mockResolvedValue({
      data: [{ id: 'm1', revision: 1, content: '喜欢桂花味', importance: 5, tags: [], pinned: false }],
      total: 1,
    })
    renderPage()

    const card = within((await screen.findByText('喜欢桂花味')).closest('article'))
    expect(card.getByRole('button', { name: '放在心上' })).toBeInTheDocument()
    expect(card.getByRole('button', { name: '改一改' })).toBeInTheDocument()
    expect(card.getByRole('button', { name: /删除这条记忆/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '她是怎么记住的' })).not.toBeInTheDocument()
    expect(screen.queryByRole('searchbox', { name: '搜索记忆' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '清空' })).not.toBeInTheDocument()
  })
})
