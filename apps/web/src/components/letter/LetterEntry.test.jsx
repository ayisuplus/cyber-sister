import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '../../stores/authStore'
import LetterEntry from './LetterEntry'
import { letterDateLabel, sameDay } from './letterDate'

vi.mock('../../services/userService', () => ({
  userService: {
    fetchAssetUrl: vi.fn(),
  },
}))

import { userService } from '../../services/userService'

afterEach(() => {
  vi.clearAllMocks()
  useAuthStore.setState({ user: null })
})

describe('信纸上的一段', () => {
  it('她和你用两种墨色，页边落款与读屏都分得清', () => {
    const { container, rerender } = render(<LetterEntry message={{ role: 'assistant', content: '我在' }} />)
    expect(container.querySelector('article')).toHaveClass('letter-entry--her')
    expect(container.querySelector('.letter-who')).toHaveTextContent('她')
    expect(screen.getByText('她说：')).toHaveClass('sr-only')

    rerender(<LetterEntry message={{ role: 'user', content: '今天好累' }} />)
    expect(container.querySelector('article')).toHaveClass('letter-entry--you')
    expect(container.querySelector('.letter-who')).toHaveTextContent('你')
    expect(screen.getByText('你说：')).toHaveClass('sr-only')
    // 你写的字仍是一段保留换行的文字
    expect(screen.getByText('今天好累').closest('p')).toHaveClass('whitespace-pre-wrap')
  })

  it('只标例外：本地安全模板盖一枚小印章，普通云端回复不标', () => {
    const { rerender } = render(<LetterEntry message={{ role: 'assistant', content: '回复', source: 'local_template' }} />)
    expect(screen.getByText('本地安全模板')).toHaveClass('letter-stamp')

    rerender(<LetterEntry message={{ role: 'assistant', content: '回复', source: 'qwen' }} />)
    expect(screen.queryByText('云端模型')).not.toBeInTheDocument()
    expect(screen.queryByText('本地安全模板')).not.toBeInTheDocument()
  })

  it('换了一天才写日期；时间只写在最后一段', () => {
    const { container, rerender } = render(<LetterEntry message={{ role: 'user', content: '晚安', createdAt: '2026-09-22T21:30:00' }} showDate />)
    expect(container.querySelector('.letter-date')).toHaveTextContent('9月22日 · 夜')
    expect(container.querySelector('.letter-time')).toBeNull()

    rerender(<LetterEntry message={{ role: 'user', content: '晚安', createdAt: '2026-09-22T21:30:00' }} isLast />)
    expect(container.querySelector('.letter-date')).toBeNull()
    expect(screen.getByText(/\d{2}:\d{2}/)).toHaveClass('letter-time')
  })

  it('她办的事：一件是一行，几件收成一行摘要，读屏标签照旧', () => {
    const { rerender } = render(<LetterEntry message={{ role: 'assistant', content: '好了', toolRuns: [{ tool: 'add_task', ok: true, summary: '已安排「周六复诊」' }] }} />)
    expect(screen.getByLabelText('已执行：已安排「周六复诊」')).toBeInTheDocument()

    rerender(<LetterEntry message={{ role: 'assistant', content: '好了', toolRuns: [{ tool: 'a', ok: true, summary: '一' }, { tool: 'b', ok: false, summary: '二' }] }} />)
    expect(screen.getByText('办了 2 件事，1 件没办成')).toBeInTheDocument()
    expect(screen.getByLabelText('执行失败：二')).toBeInTheDocument()

    rerender(<LetterEntry message={{ role: 'assistant', content: '好', toolRuns: [{ tool: 'a', ok: true, dismissed: true, summary: '你没让做' }] }} />)
    expect(screen.getByText('你没让做', { selector: 'summary' })).toBeInTheDocument()
    expect(screen.getByLabelText('未执行：你没让做')).toBeInTheDocument()

    rerender(<LetterEntry message={{ role: 'assistant', content: '好', toolRuns: [{ tool: 'a', ok: false, summary: '这个动作被拦下了' }] }} />)
    expect(screen.getByText('1 件事没办成')).toBeInTheDocument()
    expect(screen.getByLabelText('执行失败：这个动作被拦下了')).toBeInTheDocument()
  })

  it('你写的那段从不挂她办事的记录', () => {
    render(<LetterEntry message={{ role: 'user', content: '我的消息', toolRuns: [{ tool: 'add_task', ok: true, summary: '已安排' }] }} />)
    expect(screen.queryByLabelText('已执行：已安排')).not.toBeInTheDocument()
  })
})

describe('页边的头像', () => {
  it('你设了头像，页边就是一枚小小的圆形头像', async () => {
    userService.fetchAssetUrl.mockResolvedValue('blob:avatar')
    useAuthStore.setState({ user: { id: 'u1', nickname: '小赛', avatarUrl: '/api/user/assets/avatar?v=1' } })

    render(<LetterEntry message={{ role: 'user', content: '我的消息' }} />)

    const image = await screen.findByAltText('我的头像')
    expect(image).toHaveAttribute('src', 'blob:avatar')
    expect(image).toHaveClass('letter-who--avatar')
    expect(userService.fetchAssetUrl).toHaveBeenCalledWith('/api/user/assets/avatar?v=1')
  })

  it('没设头像就写「你」，她那段从不显示你的头像', async () => {
    useAuthStore.setState({ user: { id: 'u1', nickname: '小赛', avatarUrl: null } })
    const { container, rerender } = render(<LetterEntry message={{ role: 'user', content: '我的消息' }} />)
    expect(container.querySelector('.letter-who')).toHaveTextContent('你')
    expect(userService.fetchAssetUrl).not.toHaveBeenCalled()

    userService.fetchAssetUrl.mockResolvedValue('blob:avatar')
    useAuthStore.setState({ user: { id: 'u1', avatarUrl: '/api/user/assets/avatar?v=1' } })
    rerender(<LetterEntry message={{ role: 'assistant', content: '我在' }} />)
    await waitFor(() => expect(container.querySelector('.letter-who')).toHaveTextContent('她'))
    expect(screen.queryByAltText('我的头像')).toBeNull()
  })
})

describe('贴在纸上的照片', () => {
  it('发送中的消息直接用本地预览，不走服务端取图', () => {
    render(<LetterEntry message={{ id: 'temp-user-1', role: 'user', content: '', imagePreviewUrl: 'blob:local-preview' }} />)

    const img = screen.getByAltText('发出的照片')
    expect(img).toHaveAttribute('src', 'blob:local-preview')
    expect(img.closest('figure')).toHaveClass('letter-photo')
    expect(userService.fetchAssetUrl).not.toHaveBeenCalled()
  })

  it('存下来的照片经鉴权路径取回；取不到就不贴，文字不受影响', async () => {
    userService.fetchAssetUrl.mockResolvedValueOnce('blob:server-img')
    const { unmount } = render(<LetterEntry message={{ id: 'm-img-1', role: 'user', content: '看这身', imageExt: '.jpg' }} />)
    expect(await screen.findByAltText('发出的照片')).toHaveAttribute('src', 'blob:server-img')
    expect(userService.fetchAssetUrl).toHaveBeenCalledWith('/chat/images/m-img-1')
    unmount()

    userService.fetchAssetUrl.mockResolvedValueOnce(null)
    render(<LetterEntry message={{ id: 'm-img-2', role: 'user', content: '看这身', imageExt: '.jpg' }} />)
    await waitFor(() => expect(userService.fetchAssetUrl).toHaveBeenCalledWith('/chat/images/m-img-2'))
    expect(screen.queryByAltText('发出的照片')).not.toBeInTheDocument()
    expect(screen.getByText('看这身')).toBeInTheDocument()
  })
})

describe('日期', () => {
  it('按本地日历日判断是不是同一天，写成「9月22日 · 夜」这样', () => {
    expect(sameDay('2026-09-22T08:00:00', '2026-09-22T23:59:00')).toBe(true)
    expect(sameDay('2026-09-22T23:59:00', '2026-09-23T00:01:00')).toBe(false)
    expect(letterDateLabel('2026-09-22T03:00:00')).toBe('9月22日 · 凌晨')
    expect(letterDateLabel('2026-09-22T14:00:00')).toBe('9月22日 · 午后')
    expect(letterDateLabel('2026-09-22T23:30:00')).toBe('9月22日 · 深夜')
  })
})
