import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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
  beforeEach(() => {
    vi.clearAllMocks()
    asrService.getAsrStatus.mockResolvedValue({ available: true, configured: true, reason: null })
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
    expect(asrService.transcribeAudio).toHaveBeenCalledWith(expect.any(Blob))
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
