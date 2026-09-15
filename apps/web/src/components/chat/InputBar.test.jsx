import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const svc = vi.hoisted(() => ({
  getAsrStatus: vi.fn(),
  transcribeAudio: vi.fn(),
}))
const wav = vi.hoisted(() => ({ webmToWav16kMono: vi.fn() }))

vi.mock('../../services/asrService', () => ({ asrService: svc }))
vi.mock('../../utils/voiceWav', () => ({ webmToWav16kMono: wav.webmToWav16kMono }))

import { asrService } from '../../services/asrService'
import { webmToWav16kMono } from '../../utils/voiceWav'
import InputBar from './InputBar'
import { useChatStore } from '../../stores/chatStore'

beforeEach(() => useChatStore.setState({ chatMode: 'chat' }))

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
  it('后台执行为工作模式的显式选择，普通发送仍走原聊天回路', async () => {
    useChatStore.setState({ chatMode: 'work' })
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
  it('工作模式可仅发送附件，失败保留草稿，成功后清空', async () => {
    useChatStore.setState({ chatMode: 'work' })
    const onSend = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    render(<InputBar onSend={onSend} disabled={false} />)
    const file = new File(['item,amount\nA,42'], '数据.csv', { type: 'text/csv' })
    fireEvent.change(screen.getByLabelText('选择工作文件'), { target: { files: [file] } })
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }))
    await waitFor(() => expect(onSend).toHaveBeenCalledWith('', { image: null, files: [file] }))
    expect(screen.getByText('数据.csv')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }))
    await waitFor(() => expect(screen.queryByText('数据.csv')).not.toBeInTheDocument())
  })

  it('超量附件不能覆盖已有草稿，聊天模式不暴露文档入口', () => {
    const { rerender } = render(<InputBar onSend={vi.fn()} disabled={false} />)
    expect(screen.queryByLabelText('选择工作文件')).not.toBeInTheDocument()
    act(() => useChatStore.setState({ chatMode: 'work' }))
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
  })

  it('health presets fill an editable draft without sending or replacing existing input', async () => {
    const user = userEvent.setup()
    const onSend = vi.fn().mockResolvedValue(false)
    render(<InputBar onSend={onSend} disabled={false} />)
    await user.click(screen.getByText('聊天预设 · 身体与情绪'))
    await user.click(screen.getByRole('button', { name: '就诊准备' }))
    const input = screen.getByRole('textbox', { name: '聊天消息' })
    expect(input.value).toContain('要求暂停')
    expect(onSend).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '经期困扰' })).toBeDisabled()
    await user.clear(input)
    await user.type(input, '我的原输入')
    await user.click(screen.getByRole('button', { name: '经期困扰' }))
    expect(input).toHaveValue('我的原输入')
    await user.click(screen.getByRole('button', { name: '发送消息' }))
    expect(input).toHaveValue('我的原输入')
  })

  it('emotion presets remain editable, do not auto-send, and preserve drafts across groups', async () => {
    const user = userEvent.setup()
    const onSend = vi.fn().mockResolvedValue(false)
    render(<InputBar onSend={onSend} disabled={false} />)
    await user.click(screen.getByText('聊天预设 · 身体与情绪'))
    await user.click(screen.getByRole('button', { name: '情绪与关系', exact: true }))
    expect(screen.getByRole('button', { name: '情绪与关系', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: '内疚与修复' }))
    const input = screen.getByRole('textbox', { name: '聊天消息' })
    expect(input.value).toContain('不把内疚感直接当成我有错')
    expect(onSend).not.toHaveBeenCalled()
    const draft = input.value
    await user.click(screen.getByRole('button', { name: '身体呵护', exact: true }))
    expect(input).toHaveValue(draft)
    expect(screen.getByRole('button', { name: '经期困扰' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: '发送消息' }))
    expect(input).toHaveValue(draft)
  })

  it('does not show body care presets in work mode', () => {
    useChatStore.setState({ chatMode: 'work' })
    render(<InputBar onSend={vi.fn()} disabled={false} />)
    expect(screen.queryByText('聊天预设 · 身体与情绪')).not.toBeInTheDocument()
  })

  it('keeps the original input when sending is not confirmed', async () => {
    const user = userEvent.setup()
    const onSend = vi.fn().mockResolvedValue(false)
    render(<InputBar onSend={onSend} disabled={false} />)

    const input = screen.getByRole('textbox', { name: '聊天消息' })
    await user.type(input, '  请重试  ')
    await user.click(screen.getByRole('button', { name: '发送消息' }))

    expect(onSend).toHaveBeenCalledWith('请重试', { image: null })
    expect(input).toHaveValue('  请重试  ')
  })

  it('clears the input only after a confirmed send', async () => {
    const user = userEvent.setup()
    const onSend = vi.fn().mockResolvedValue(true)
    render(<InputBar onSend={onSend} disabled={false} />)

    const input = screen.getByRole('textbox', { name: '聊天消息' })
    await user.type(input, '你好{Enter}')

    expect(onSend).toHaveBeenCalledWith('你好', { image: null })
    expect(input).toHaveValue('')
  })

  it('renders the voice input button next to send', () => {
    render(<InputBar onSend={vi.fn()} disabled={false} />)
    expect(screen.getByRole('button', { name: '语音输入' })).toBeInTheDocument()
  })

  it('shows an honest error when the voice service is unavailable', async () => {
    asrService.getAsrStatus.mockResolvedValue({ available: false, configured: true, reason: 'ASR_UNAVAILABLE' })
    stubMedia()
    const user = userEvent.setup()
    render(<InputBar onSend={vi.fn()} disabled={false} />)

    await waitFor(() => expect(asrService.getAsrStatus).toHaveBeenCalled())
    // 等 mount 探测的 .then 落进 ref，再点麦克风
    await new Promise((resolve) => { setTimeout(resolve, 0) })
    await user.click(screen.getByRole('button', { name: '语音输入' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('语音转文字暂不可用')
  })

  it('records, transcribes and injects the transcript into the input', async () => {
    webmToWav16kMono.mockResolvedValue(new Blob(['wav'], { type: 'audio/wav' }))
    asrService.transcribeAudio.mockResolvedValue({ text: '你好世界' })
    stubMedia()
    const user = userEvent.setup()
    render(<InputBar onSend={vi.fn()} disabled={false} />)

    await waitFor(() => expect(asrService.getAsrStatus).toHaveBeenCalled())
    await user.click(screen.getByRole('button', { name: '语音输入' }))
    expect(await screen.findByRole('button', { name: '停止录音' })).toHaveAttribute('aria-pressed', 'true')

    await user.click(screen.getByRole('button', { name: '停止录音' }))

    await waitFor(() => expect(screen.getByRole('textbox', { name: '聊天消息' })).toHaveValue('你好世界'))
    expect(webmToWav16kMono).toHaveBeenCalled()
    expect(asrService.transcribeAudio).toHaveBeenCalledWith(expect.any(Blob), { signal: expect.any(AbortSignal) })
  })

  it('reports microphone permission denial honestly', async () => {
    stubMedia({ getUserMedia: vi.fn().mockRejectedValue(Object.assign(new Error('denied'), { name: 'NotAllowedError' })) })
    const user = userEvent.setup()
    render(<InputBar onSend={vi.fn()} disabled={false} />)

    await waitFor(() => expect(asrService.getAsrStatus).toHaveBeenCalled())
    await new Promise((resolve) => { setTimeout(resolve, 0) })
    await user.click(screen.getByRole('button', { name: '语音输入' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('麦克风权限被拒绝')
  })

  it('disables the mic while the chat is sending', () => {
    render(<InputBar onSend={vi.fn()} disabled />)
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

    await waitFor(() => expect(asrService.getAsrStatus).toHaveBeenCalled())
    await new Promise((resolve) => { setTimeout(resolve, 0) })
    await user.click(screen.getByRole('button', { name: '语音输入' }))
    expect(await screen.findByRole('button', { name: '停止录音' })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(await screen.findByRole('button', { name: '语音输入' })).toBeInTheDocument()
    expect(webmToWav16kMono).not.toHaveBeenCalled()
    expect(asrService.transcribeAudio).not.toHaveBeenCalled()
  })

  it('工作模式没有麦克风入口，也不探测或调用 ASR', () => {
    stubMedia()
    useChatStore.setState({ chatMode: 'work' })
    render(<InputBar onSend={vi.fn()} disabled={false} />)

    expect(screen.queryByRole('button', { name: '语音输入' })).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '聊天消息' })).toHaveAttribute('placeholder', '交给 Amie：研究、写作、计划或整理成文件…')
    expect(asrService.getAsrStatus).not.toHaveBeenCalled()
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled()
    expect(asrService.transcribeAudio).not.toHaveBeenCalled()
  })

  it('录音时切到工作模式会停止麦克风并丢弃音频', async () => {
    const stopTrack = vi.fn()
    stubMedia({ getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: stopTrack }] }) })
    const user = userEvent.setup()
    render(<InputBar onSend={vi.fn()} disabled={false} />)
    await user.click(screen.getByRole('button', { name: '语音输入' }))
    await screen.findByRole('button', { name: '停止录音' })

    act(() => useChatStore.setState({ chatMode: 'work' }))

    expect(stopTrack).toHaveBeenCalled()
    expect(FakeRecorder.instances[0].state).toBe('inactive')
    expect(webmToWav16kMono).not.toHaveBeenCalled()
    expect(asrService.transcribeAudio).not.toHaveBeenCalled()
    expect(screen.getByRole('textbox', { name: '聊天消息' })).toHaveValue('')
  })

  it('切换工作模式后迟到的麦克风权限不会开始录音', async () => {
    let grantPermission
    const stopTrack = vi.fn()
    stubMedia({ getUserMedia: vi.fn().mockImplementation(() => new Promise(resolve => { grantPermission = resolve })) })
    const user = userEvent.setup()
    render(<InputBar onSend={vi.fn()} disabled={false} />)
    await user.click(screen.getByRole('button', { name: '语音输入' }))
    act(() => useChatStore.setState({ chatMode: 'work' }))
    await act(async () => grantPermission({ getTracks: () => [{ stop: stopTrack }] }))

    expect(stopTrack).toHaveBeenCalledOnce()
    expect(FakeRecorder.instances).toHaveLength(0)
    expect(asrService.transcribeAudio).not.toHaveBeenCalled()
  })

  it('音频转换时切到工作模式，再切回也不上传旧音频', async () => {
    let finishConversion
    webmToWav16kMono.mockImplementationOnce(() => new Promise(resolve => { finishConversion = resolve }))
    stubMedia()
    const user = userEvent.setup()
    render(<InputBar onSend={vi.fn()} disabled={false} />)
    await user.click(screen.getByRole('button', { name: '语音输入' }))
    await user.click(await screen.findByRole('button', { name: '停止录音' }))
    act(() => useChatStore.setState({ chatMode: 'work' }))
    act(() => useChatStore.setState({ chatMode: 'chat' }))
    await act(async () => finishConversion(new Blob(['wav'], { type: 'audio/wav' })))

    expect(asrService.transcribeAudio).not.toHaveBeenCalled()
    expect(screen.getByRole('textbox', { name: '聊天消息' })).toHaveValue('')
    expect(screen.getByRole('button', { name: '语音输入' })).toBeEnabled()
  })

  it('转写期间切到工作模式会取消请求，迟到结果不回填', async () => {
    let finishTranscription
    webmToWav16kMono.mockResolvedValue(new Blob(['wav'], { type: 'audio/wav' }))
    asrService.transcribeAudio.mockImplementationOnce(() => new Promise(resolve => { finishTranscription = resolve }))
    stubMedia()
    const user = userEvent.setup()
    render(<InputBar onSend={vi.fn()} disabled={false} />)
    await user.type(screen.getByRole('textbox', { name: '聊天消息' }), '已有文字')
    await user.click(screen.getByRole('button', { name: '语音输入' }))
    await user.click(await screen.findByRole('button', { name: '停止录音' }))
    await waitFor(() => expect(asrService.transcribeAudio).toHaveBeenCalledOnce())
    const { signal } = asrService.transcribeAudio.mock.calls[0][1]
    act(() => useChatStore.setState({ chatMode: 'work' }))
    expect(signal.aborted).toBe(true)
    act(() => useChatStore.setState({ chatMode: 'chat' }))
    await act(async () => finishTranscription({ text: '旧录音结果' }))

    expect(screen.getByRole('textbox', { name: '聊天消息' })).toHaveValue('已有文字')
    expect(screen.getByRole('button', { name: '语音输入' })).toBeEnabled()
  })
})
    await new Promise((resolve) => { setTimeout(resolve, 0) })

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
