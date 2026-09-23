import { createRef } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const svc = vi.hoisted(() => ({
  getAsrStatus: vi.fn(),
  transcribeAudio: vi.fn(),
}))
const wav = vi.hoisted(() => ({ webmToWav16kMono: vi.fn() }))
// jsdom 没有 AudioContext：默认取不到音量（null），需要时按用例装假音量计
const meter = vi.hoisted(() => ({ createLevelMeter: vi.fn(() => null) }))

vi.mock('../../services/asrService', () => ({ asrService: svc }))
vi.mock('../../utils/voiceWav', () => ({ webmToWav16kMono: wav.webmToWav16kMono }))
vi.mock('../../utils/voiceLevel', () => ({ createLevelMeter: meter.createLevelMeter }))

import { asrService } from '../../services/asrService'
import { webmToWav16kMono } from '../../utils/voiceWav'
import InputBar from './InputBar'
import { appendTranscript, AUTO_STOP_NOTICE } from './useVoiceInput'

afterEach(() => vi.unstubAllEnvs())

// jsdom 无 MediaRecorder/getUserMedia：按用例装假实现
class FakeRecorder {
  static isTypeSupported() { return true }
  static instances = []
  constructor(stream) {
    this.stream = stream
    this.mimeType = 'audio/webm'
    this.state = 'inactive'
    FakeRecorder.instances.push(this)
  }
  start() { this.state = 'recording' }
  stop() {
    this.state = 'inactive'
    this.ondataavailable?.({ data: new Blob(['webm'], { type: 'audio/webm' }) })
    this.onstop?.()
  }
}

const stubMedia = ({ getUserMedia } = {}) => {
  FakeRecorder.instances = []
  vi.stubGlobal('MediaRecorder', FakeRecorder)
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: getUserMedia ?? vi.fn().mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] }) },
  })
}

describe('InputBar', () => {
  it('后台执行是显式选择（聊天页在本地且已启用时才提供），普通发送仍走原对话回路', async () => {
    const onSend = vi.fn().mockResolvedValue(true)
    const onBackgroundSend = vi.fn().mockResolvedValue(true)
    render(<InputBar onSend={onSend} onBackgroundSend={onBackgroundSend} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '普通任务' } })
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }))
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1))
    expect(onBackgroundSend).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('checkbox', { name: /后台执行/ }))
    expect(screen.getByRole('button', { name: '添加照片' })).toBeDisabled()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '后台任务' } })
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }))
    await waitFor(() => expect(onBackgroundSend).toHaveBeenCalledWith('后台任务', { image: null }))
  })
  it('本地客户端可仅发送附件，失败保留草稿，成功后清空', async () => {
    const onSend = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    render(<InputBar onSend={onSend} disabled={false} />)
    const file = new File(['item,amount\nA,42'], '数据.csv', { type: 'text/csv' })
    fireEvent.change(screen.getByLabelText('选择工作文件'), { target: { files: [file] } })
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }))
    await waitFor(() => expect(onSend).toHaveBeenCalledWith('', { image: null, files: [file] }))
    // 发送没成：文件放回信笺
    expect(await screen.findByText('数据.csv')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }))
    await waitFor(() => expect(screen.queryByText('数据.csv')).not.toBeInTheDocument())
  })

  it('网页版不暴露文档入口和后台执行；本地客户端超量附件不能覆盖已有草稿', async () => {
    vi.stubEnv('VITE_APP_DISTRIBUTION', 'web')
    const { rerender } = render(<InputBar onSend={vi.fn()} disabled={false} />)
    expect(screen.queryByLabelText('选择工作文件')).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: /后台执行/ })).not.toBeInTheDocument()
    expect(await screen.findByRole('button', { name: '语音输入' })).toBeInTheDocument()
    vi.stubEnv('VITE_APP_DISTRIBUTION', 'local')
    rerender(<InputBar onSend={vi.fn()} disabled={false} />)
    const file = new File(['a'], '保留.txt')
    fireEvent.change(screen.getByLabelText('选择工作文件'), { target: { files: [file] } })
    fireEvent.change(screen.getByLabelText('选择工作文件'), { target: { files: [file, file, file] } })
    expect(screen.getByText('保留.txt')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('最多 3 个文件')
  })
  beforeEach(() => {
    vi.clearAllMocks()
    asrService.getAsrStatus.mockResolvedValue({ available: true, configured: true, reason: null })
    meter.createLevelMeter.mockImplementation(() => null)
  })

  it('fillDraft puts an editable draft into an empty composer without sending it', async () => {
    const ref = createRef()
    const onSend = vi.fn().mockResolvedValue(false)
    render(<InputBar ref={ref} onSend={onSend} disabled={false} />)

    let filled
    act(() => { filled = ref.current.fillDraft('我有点害怕妇科检查，想准备就诊问题清单。') })

    expect(filled).toBe(true)
    expect(screen.getByRole('textbox', { name: '聊天消息' })).toHaveValue('我有点害怕妇科检查，想准备就诊问题清单。')
    expect(onSend).not.toHaveBeenCalled()
  })

  it('fillDraft never replaces what the user is already writing', async () => {
    const user = userEvent.setup()
    const ref = createRef()
    render(<InputBar ref={ref} onSend={vi.fn()} disabled={false} />)
    const input = screen.getByRole('textbox', { name: '聊天消息' })
    await user.type(input, '我的原输入')

    let filled
    act(() => { filled = ref.current.fillDraft('预设文案') })

    expect(filled).toBe(false)
    expect(input).toHaveValue('我的原输入')
  })

  it('reports whether a draft exists so sensitive openers can be disabled', async () => {
    const user = userEvent.setup()
    const onDraftChange = vi.fn()
    render(<InputBar onSend={vi.fn()} disabled={false} onDraftChange={onDraftChange} />)

    expect(onDraftChange).toHaveBeenLastCalledWith(false)
    await user.type(screen.getByRole('textbox', { name: '聊天消息' }), '你好')
    expect(onDraftChange).toHaveBeenLastCalledWith(true)
  })

  it('点发送，字马上离开信笺；没放进本子（发送没成）就原样放回来', async () => {
    const user = userEvent.setup()
    let settle
    const onSend = vi.fn(() => new Promise((resolve) => { settle = resolve }))
    render(<InputBar onSend={onSend} disabled={false} />)

    const input = screen.getByRole('textbox', { name: '聊天消息' })
    await user.type(input, '  请重试  ')
    await user.click(screen.getByRole('button', { name: '发送消息' }))

    expect(onSend).toHaveBeenCalledWith('请重试', { image: null })
    // 还没等到结果：信笺已经空了，这段字在本子里
    expect(input).toHaveValue('')
    await act(async () => { settle(false) })
    expect(input).toHaveValue('  请重试  ')
    // 放回来就是原处的字，不再叠着一层正在淡去的
    expect(document.querySelector('.chat-slip__handed')).toBeNull()
  })

  it('没放进本子时，这期间新写的字接在放回来的那段后面，一个字不丢', async () => {
    const user = userEvent.setup()
    let settle
    const onSend = vi.fn(() => new Promise((resolve) => { settle = resolve }))
    render(<InputBar onSend={onSend} disabled={false} />)

    const input = screen.getByRole('textbox', { name: '聊天消息' })
    await user.type(input, '第一段{Enter}')
    expect(input).toHaveValue('')
    await user.type(input, '又想到一句')
    await act(async () => { settle(false) })

    expect(input).toHaveValue('第一段\n又想到一句')
  })

  it('她还在写（busy）：信笺照样能写、能说，只是先放不进本子，并轻轻说一声', async () => {
    const user = userEvent.setup()
    const onSend = vi.fn().mockResolvedValue(true)
    const { rerender } = render(<InputBar onSend={onSend} disabled={false} busy />)
    const input = screen.getByRole('textbox', { name: '聊天消息' })
    expect(input).toBeEnabled()
    expect(await screen.findByRole('button', { name: '语音输入' })).toBeEnabled()
    // 信笺空着时不多话
    expect(screen.getByRole('status')).not.toHaveTextContent('她写完这一段')

    await user.type(input, '还有，{Enter}')
    expect(onSend).not.toHaveBeenCalled()
    expect(input).toHaveValue('还有，')
    expect(screen.getByRole('button', { name: '发送消息' })).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent('她写完这一段，就能放进本子')

    // 她写完了：提示收起，这一段可以放进本子
    rerender(<InputBar onSend={onSend} disabled={false} busy={false} />)
    expect(screen.getByRole('status')).not.toHaveTextContent('她写完这一段')
    await user.click(screen.getByRole('button', { name: '发送消息' }))
    expect(onSend).toHaveBeenCalledWith('还有，', { image: null })
  })

  it('放进本子的那几行在信笺上淡去，只给眼睛看，淡完就撤掉；要求减少动态效果时不播', async () => {
    const user = userEvent.setup()
    const { container } = render(<InputBar onSend={vi.fn().mockResolvedValue(true)} disabled={false} />)
    const input = screen.getByRole('textbox', { name: '聊天消息' })

    await user.type(input, '今晚有点难过{Enter}')
    const handed = container.querySelector('.chat-slip__handed')
    expect(handed).toHaveTextContent('今晚有点难过')
    expect(handed).toHaveAttribute('aria-hidden', 'true')
    // 淡去的时候提示语先不出来，免得和那几行叠在一起
    expect(input).toHaveClass('chat-slip__text--handing')
    await waitFor(() => expect(container.querySelector('.chat-slip__handed')).toBeNull())
    expect(input).not.toHaveClass('chat-slip__text--handing')

    const reduced = vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({ matches: query.includes('reduce') }))
    try {
      await user.type(input, '再说一句{Enter}')
      expect(input).toHaveValue('')
      expect(container.querySelector('.chat-slip__handed')).toBeNull()
    } finally {
      reduced.mockRestore()
    }
  })

  it('clears the slip once the text is handed over', async () => {
    const user = userEvent.setup()
    const onSend = vi.fn().mockResolvedValue(true)
    render(<InputBar onSend={onSend} disabled={false} />)

    const input = screen.getByRole('textbox', { name: '聊天消息' })
    await user.type(input, '你好{Enter}')

    expect(onSend).toHaveBeenCalledWith('你好', { image: null })
    expect(input).toHaveValue('')
  })

  it('renders the voice input button next to send', async () => {
    render(<InputBar onSend={vi.fn()} disabled={false} />)
    expect(await screen.findByRole('button', { name: '语音输入' })).toBeInTheDocument()
  })

  it('没配语音服务（或探测失败）就不放麦克风，不假装可用', async () => {
    asrService.getAsrStatus.mockResolvedValue({ available: false, configured: false, reason: 'ASR_NOT_CONFIGURED' })
    const { unmount } = render(<InputBar onSend={vi.fn()} disabled={false} />)
    await waitFor(() => expect(asrService.getAsrStatus).toHaveBeenCalled())
    await act(async () => {})
    expect(screen.queryByRole('button', { name: '语音输入' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '发送消息' })).toBeInTheDocument()
    unmount()

    asrService.getAsrStatus.mockRejectedValue(new Error('network'))
    render(<InputBar onSend={vi.fn()} disabled={false} />)
    await act(async () => {})
    expect(screen.queryByRole('button', { name: '语音输入' })).not.toBeInTheDocument()
  })

  it('shows an honest error when the voice service is unavailable', async () => {
    asrService.getAsrStatus.mockResolvedValue({ available: false, configured: true, reason: 'ASR_UNAVAILABLE' })
    stubMedia()
    const user = userEvent.setup()
    render(<InputBar onSend={vi.fn()} disabled={false} />)

    // 配了但暂时连不上：麦克风在，点了如实说用不了
    await user.click(await screen.findByRole('button', { name: '语音输入' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('语音转文字暂不可用')
  })

  it('records, transcribes and injects the transcript into the input', async () => {
    webmToWav16kMono.mockResolvedValue(new Blob(['wav'], { type: 'audio/wav' }))
    asrService.transcribeAudio.mockResolvedValue({ text: '你好世界' })
    stubMedia()
    const user = userEvent.setup()
    render(<InputBar onSend={vi.fn()} disabled={false} />)

    await user.click(await screen.findByRole('button', { name: '语音输入' }))
    expect(await screen.findByRole('button', { name: '停止录音' })).toHaveAttribute('aria-pressed', 'true')

    await user.click(screen.getByRole('button', { name: '停止录音' }))

    await waitFor(() => expect(screen.getByRole('textbox', { name: '聊天消息' })).toHaveValue('你好世界'))
    expect(webmToWav16kMono).toHaveBeenCalled()
    expect(asrService.transcribeAudio).toHaveBeenCalledWith(expect.any(Blob), { signal: expect.any(AbortSignal) })
  })

  it('长段转写填进来后信笺跟着长高，不抢焦点；几段中文直接接上，不加空格', async () => {
    webmToWav16kMono.mockResolvedValue(new Blob(['wav'], { type: 'audio/wav' }))
    asrService.transcribeAudio.mockResolvedValueOnce({ text: '今天好累。' }).mockResolvedValueOnce({ text: '明天还要早起。' })
    stubMedia()
    const user = userEvent.setup()
    render(<InputBar onSend={vi.fn()} disabled={false} />)
    const input = screen.getByRole('textbox', { name: '聊天消息' })
    // jsdom 不排版，scrollHeight 恒为 0：按两行字的高度装一个
    Object.defineProperty(input, 'scrollHeight', { configurable: true, get: () => 96 })

    for (const expected of ['今天好累。', '今天好累。明天还要早起。']) {
      await user.click(await screen.findByRole('button', { name: '语音输入' }))
      await user.click(await screen.findByRole('button', { name: '停止录音' }))
      await waitFor(() => expect(input).toHaveValue(expected))
    }
    expect(input.style.height).toBe('96px')
    expect(input).not.toHaveFocus()
  })

  it('录音时给她看在听多久了和音量', async () => {
    meter.createLevelMeter.mockReturnValue({ read: () => 0.4, close: vi.fn() })
    stubMedia()
    const user = userEvent.setup()
    const { container } = render(<InputBar onSend={vi.fn()} disabled={false} />)

    await user.click(await screen.findByRole('button', { name: '语音输入' }))
    expect(await screen.findByText('在听 0:00')).toBeInTheDocument()
    expect(container.querySelectorAll('.bg-action-primary.opacity-70')).toHaveLength(5)
    // 停下后这一行收起
    await user.click(screen.getByRole('button', { name: '停止录音' }))
    await waitFor(() => expect(screen.queryByText(/在听/)).not.toBeInTheDocument())
  })

  it('一直没听到像说话的声音才提示靠近一点；听到了提示就收起', async () => {
    let reading = 0
    meter.createLevelMeter.mockReturnValue({ read: () => reading, close: vi.fn() })
    stubMedia()
    render(<InputBar onSend={vi.fn()} disabled={false} />)
    const mic = await screen.findByRole('button', { name: '语音输入' })
    const hint = '还没听到声音，可以靠近一点说'

    vi.useFakeTimers()
    try {
      fireEvent.click(mic)
      await act(async () => {})
      expect(screen.getByRole('button', { name: '停止录音' })).toBeInTheDocument()
      act(() => { vi.advanceTimersByTime(2000) })
      expect(screen.queryByText(hint)).not.toBeInTheDocument()
      act(() => { vi.advanceTimersByTime(1200) })
      expect(screen.getByRole('status')).toHaveTextContent(hint)
      reading = 0.3
      act(() => { vi.advanceTimersByTime(200) })
      expect(screen.queryByText(hint)).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('最后 10 秒倒数；到 90 秒自动停下转写，并告诉她先写下了这些', async () => {
    webmToWav16kMono.mockResolvedValue(new Blob(['wav'], { type: 'audio/wav' }))
    asrService.transcribeAudio.mockResolvedValue({ text: '今天好累。' })
    stubMedia()
    render(<InputBar onSend={vi.fn()} disabled={false} />)
    const mic = await screen.findByRole('button', { name: '语音输入' })

    vi.useFakeTimers()
    try {
      fireEvent.click(mic)
      await act(async () => {})
      act(() => { vi.advanceTimersByTime(81_000) })
      expect(screen.getByText('还能说 9 秒')).toBeInTheDocument()
      act(() => { vi.advanceTimersByTime(9_000) })
    } finally {
      vi.useRealTimers()
    }

    const input = screen.getByRole('textbox', { name: '聊天消息' })
    await waitFor(() => expect(input).toHaveValue('今天好累。'))
    expect(screen.getByRole('status')).toHaveTextContent(AUTO_STOP_NOTICE)

    // 信笺清空后提示收起；接着写下一句，旧提示不会再冒出来
    fireEvent.change(input, { target: { value: '' } })
    await waitFor(() => expect(screen.getByRole('status')).not.toHaveTextContent(AUTO_STOP_NOTICE))
    fireEvent.change(input, { target: { value: '新的一句' } })
    expect(screen.getByRole('status')).not.toHaveTextContent(AUTO_STOP_NOTICE)
  })

  it('reports microphone permission denial honestly', async () => {
    stubMedia({ getUserMedia: vi.fn().mockRejectedValue(Object.assign(new Error('denied'), { name: 'NotAllowedError' })) })
    const user = userEvent.setup()
    render(<InputBar onSend={vi.fn()} disabled={false} />)

    await user.click(await screen.findByRole('button', { name: '语音输入' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('麦克风权限被拒绝')
  })

  it('disables the mic while the chat is sending', async () => {
    render(<InputBar onSend={vi.fn()} disabled />)
    expect(await screen.findByRole('button', { name: '语音输入' })).toBeDisabled()
    expect(screen.getByRole('textbox', { name: '聊天消息' })).toBeDisabled()
  })

  it('does not send while the IME is composing', async () => {
    const user = userEvent.setup()
    const onSend = vi.fn().mockResolvedValue(true)
    render(<InputBar onSend={onSend} disabled={false} />)

    const input = screen.getByRole('textbox', { name: '聊天消息' })
    await user.type(input, '你好')
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    Object.defineProperty(event, 'isComposing', { value: true })
    fireEvent(input, event)

    expect(onSend).not.toHaveBeenCalled()
    expect(input).toHaveValue('你好')
  })

  it('inserts a newline with Shift+Enter without sending', async () => {
    const user = userEvent.setup()
    const onSend = vi.fn().mockResolvedValue(true)
    render(<InputBar onSend={onSend} disabled={false} />)

    const input = screen.getByRole('textbox', { name: '聊天消息' })
    await user.type(input, 'a{Shift>}{Enter}{/Shift}b')

    expect(input).toHaveValue('a\nb')
    expect(onSend).not.toHaveBeenCalled()
  })

  it('cancels an active recording with Escape without transcribing', async () => {
    stubMedia()
    const user = userEvent.setup()
    render(<InputBar onSend={vi.fn()} disabled={false} />)

    await user.click(await screen.findByRole('button', { name: '语音输入' }))
    expect(await screen.findByRole('button', { name: '停止录音' })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(await screen.findByRole('button', { name: '语音输入' })).toBeInTheDocument()
    expect(webmToWav16kMono).not.toHaveBeenCalled()
    expect(asrService.transcribeAudio).not.toHaveBeenCalled()
  })

  it('只有一种对话：语音、照片与附件同在一张信笺上，占位文案只有一句', async () => {
    render(<InputBar onSend={vi.fn()} disabled={false} />)

    expect(await screen.findByRole('button', { name: '语音输入' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '添加照片' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '添加文件' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '聊天消息' })).toHaveAttribute('placeholder', '写下想说的…')
  })
})
    await new Promise((resolve) => { setTimeout(resolve, 0) })

describe('appendTranscript', () => {
  it('挨着中文或中文标点直接接上，只有英文、数字碰在一起才隔一个空格', () => {
    expect(appendTranscript('', '今天好累。')).toBe('今天好累。')
    expect(appendTranscript('今天好累。', '明天还要早起。')).toBe('今天好累。明天还要早起。')
    expect(appendTranscript('我在改PPT', '好烦')).toBe('我在改PPT好烦')
    expect(appendTranscript('明早9点', '要汇报')).toBe('明早9点要汇报')
    expect(appendTranscript('see you', 'tomorrow')).toBe('see you tomorrow')
    expect(appendTranscript('写了一半', '')).toBe('写了一半')
  })
})

const resize = vi.hoisted(() => ({ prepareChatImage: vi.fn() }))
vi.mock('../../features/chat/imageResize', () => resize)

describe('InputBar 照片发送', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    asrService.getAsrStatus.mockResolvedValue({ available: true, configured: true, reason: null })
    resize.prepareChatImage.mockResolvedValue({
      blob: new Blob(['jpeg'], { type: 'image/jpeg' }),
      previewUrl: 'blob:thumb',
    })
  })

  it('选照片出现缩略图，移除后消失', async () => {
    const user = userEvent.setup()
    render(<InputBar onSend={vi.fn()} disabled={false} />)

    await user.upload(
      screen.getByLabelText('选择照片'),
      new File(['raw'], 'photo.png', { type: 'image/png' }),
    )

    const thumb = await screen.findByAltText('待发送的照片预览')
    expect(thumb).toHaveAttribute('src', 'blob:thumb')

    await user.click(screen.getByRole('button', { name: '移除照片' }))
    expect(screen.queryByAltText('待发送的照片预览')).not.toBeInTheDocument()
  })

  it('仅图片时发送按钮可用；发送确认后缩略图与图片一起清空', async () => {
    const user = userEvent.setup()
    const onSend = vi.fn().mockResolvedValue(true)
    render(<InputBar onSend={onSend} disabled={false} />)

    await user.upload(
      screen.getByLabelText('选择照片'),
      new File(['raw'], 'photo.png', { type: 'image/png' }),
    )
    await screen.findByAltText('待发送的照片预览')

    const sendButton = screen.getByRole('button', { name: '发送消息' })
    expect(sendButton).toBeEnabled()
    await user.click(sendButton)

    expect(onSend).toHaveBeenCalledWith('', { image: { blob: expect.any(Blob), previewUrl: 'blob:thumb' } })
    await waitFor(() => expect(screen.queryByAltText('待发送的照片预览')).not.toBeInTheDocument())
  })

  it('图片处理失败给出 alert 提示，不产生缩略图', async () => {
    resize.prepareChatImage.mockRejectedValue(new Error('只支持图片文件'))
    const user = userEvent.setup()
    render(<InputBar onSend={vi.fn()} disabled={false} />)

    await user.upload(
      screen.getByLabelText('选择照片'),
      new File(['raw'], 'broken.png', { type: 'image/png' }),
    )

    expect(await screen.findByRole('alert')).toHaveTextContent('只支持图片文件')
    expect(screen.queryByAltText('待发送的照片预览')).not.toBeInTheDocument()
  })
})
