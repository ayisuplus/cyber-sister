import { act, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AmbientMedia from './AmbientMedia'

let observers
let preference
let connection
let hidden
const originalConnection = Object.getOwnPropertyDescriptor(navigator, 'connection')
const originalHidden = Object.getOwnPropertyDescriptor(document, 'hidden')

const intersect = (isIntersecting) => {
  observers.at(-1).callback([{ isIntersecting }])
}

beforeEach(() => {
  observers = []
  hidden = false
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
  preference = new EventTarget()
  preference.matches = false
  vi.spyOn(window, 'matchMedia').mockReturnValue(preference)
  connection = new EventTarget()
  connection.saveData = false
  Object.defineProperty(navigator, 'connection', { configurable: true, value: connection })
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback) {
      this.callback = callback
      this.observe = vi.fn()
      this.disconnect = vi.fn()
      observers.push(this)
    }
  })
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  if (originalConnection) Object.defineProperty(navigator, 'connection', originalConnection)
  else delete navigator.connection
  if (originalHidden) Object.defineProperty(document, 'hidden', originalHidden)
  else delete document.hidden
})

describe('AmbientMedia', () => {
  it('keeps decorative defaults and only starts playback after entering the viewport', () => {
    const { container } = render(<AmbientMedia className="ambient" />)
    const video = container.querySelector('video')
    expect(video).toHaveAttribute('src', '/design-assets/workspace-ambient.mp4')
    expect(video).toHaveAttribute('poster', '/design-assets/banner-workspace.png')
    expect(video).toHaveAttribute('preload', 'none')
    expect(video).toHaveAttribute('aria-hidden', 'true')
    expect(video).not.toHaveAttribute('autoplay')
    expect(video).toHaveClass('ambient')
    expect(video.muted).toBe(true)
    expect(video.play).not.toHaveBeenCalled()
    expect(observers[0].observe).toHaveBeenCalledWith(video)

    act(() => intersect(true))
    expect(video.play).toHaveBeenCalledTimes(1)
    video.pause.mockClear()
    act(() => intersect(false))
    expect(video.pause).toHaveBeenCalledTimes(1)
    act(() => intersect(true))
    expect(video.play).toHaveBeenCalledTimes(2)
  })

  it('waits while the page is hidden and pauses when the page becomes hidden again', () => {
    hidden = true
    const { container } = render(<AmbientMedia />)
    const video = container.querySelector('video')
    act(() => intersect(true))
    expect(video.play).not.toHaveBeenCalled()

    hidden = false
    fireEvent(document, new Event('visibilitychange'))
    expect(video.play).toHaveBeenCalledTimes(1)
    video.pause.mockClear()
    hidden = true
    fireEvent(document, new Event('visibilitychange'))
    expect(video.pause).toHaveBeenCalledTimes(1)
  })

  it('honors the parent pause toggle without replacing the video frame', () => {
    const { container, rerender } = render(<AmbientMedia paused />)
    const video = container.querySelector('video')
    act(() => intersect(true))
    expect(video.play).not.toHaveBeenCalled()

    rerender(<AmbientMedia paused={false} />)
    act(() => intersect(true))
    expect(video.play).toHaveBeenCalledTimes(1)
    video.pause.mockClear()
    rerender(<AmbientMedia paused />)
    act(() => intersect(true))
    expect(video.pause).toHaveBeenCalled()
    expect(container.querySelector('video')).toBe(video)
    expect(video.play).toHaveBeenCalledTimes(1)
  })

  it('never mounts video under reduced motion and responds to preference changes', () => {
    preference.matches = true
    const { container } = render(<AmbientMedia />)
    expect(container.querySelector('video')).toBeNull()
    expect(container.querySelector('img')).toHaveAttribute('alt', '')
    expect(observers).toHaveLength(0)

    preference.matches = false
    const event = new Event('change')
    Object.defineProperty(event, 'matches', { value: false })
    act(() => preference.dispatchEvent(event))
    act(() => intersect(true))
    const video = container.querySelector('video')
    expect(video.play).toHaveBeenCalledTimes(1)

    const reduce = new Event('change')
    Object.defineProperty(reduce, 'matches', { value: true })
    act(() => preference.dispatchEvent(reduce))
    expect(container.querySelector('video')).toBeNull()
    expect(observers[0].disconnect).toHaveBeenCalledTimes(1)
    expect(video.pause).toHaveBeenCalled()
  })

  it('avoids loading video in Save-Data mode and removes its connection listener', () => {
    connection.saveData = true
    const remove = vi.spyOn(connection, 'removeEventListener')
    const { container, unmount } = render(<AmbientMedia imageSrc="/poster.webp" />)
    expect(container.querySelector('video')).toBeNull()
    expect(container.querySelector('img')).toHaveAttribute('src', '/poster.webp')
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled()

    connection.saveData = false
    act(() => connection.dispatchEvent(new Event('change')))
    act(() => intersect(true))
    expect(container.querySelector('video')).not.toBeNull()
    connection.saveData = true
    act(() => connection.dispatchEvent(new Event('change')))
    expect(container.querySelector('video')).toBeNull()
    expect(observers[0].disconnect).toHaveBeenCalledTimes(1)
    unmount()
    expect(remove).toHaveBeenCalledWith('change', expect.any(Function))
  })

  it('falls back on media errors and starts a fresh lifecycle for every source change', () => {
    const { container, rerender } = render(<AmbientMedia videoSrc="/a.mp4" imageSrc="/a.webp" />)
    fireEvent.error(container.querySelector('video'))
    expect(container.querySelector('video')).toBeNull()
    expect(container.querySelector('img')).toHaveAttribute('src', '/a.webp')
    expect(observers[0].disconnect).toHaveBeenCalledTimes(1)

    rerender(<AmbientMedia videoSrc="/b.mp4" imageSrc="/b.webp" />)
    expect(container.querySelector('video')).toHaveAttribute('src', '/b.mp4')
    expect(container.querySelector('video')).toHaveAttribute('poster', '/b.webp')
    rerender(<AmbientMedia videoSrc="/a.mp4" imageSrc="/a.webp" />)
    expect(container.querySelector('video')).toHaveAttribute('src', '/a.mp4')
  })

  it('shows the poster if the browser rejects playback', async () => {
    HTMLMediaElement.prototype.play.mockRejectedValueOnce(new Error('Autoplay denied'))
    const { container } = render(<AmbientMedia />)
    await act(async () => intersect(true))
    expect(container.querySelector('video')).toBeNull()
    expect(container.querySelector('img')).not.toBeNull()
  })

  it('ignores a pending playback rejection after leaving the viewport', async () => {
    let rejectPlayback
    HTMLMediaElement.prototype.play.mockReturnValueOnce(new Promise((_, reject) => { rejectPlayback = reject }))
    const { container } = render(<AmbientMedia />)
    act(() => intersect(true))
    act(() => intersect(false))
    await act(async () => rejectPlayback(new Error('Playback interrupted by pause')))
    expect(container.querySelector('video')).not.toBeNull()
    act(() => intersect(true))
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2)
  })

  it('cleans up playback, observers and visibility listeners on unmount', async () => {
    let rejectPlayback
    HTMLMediaElement.prototype.play.mockReturnValueOnce(new Promise((_, reject) => { rejectPlayback = reject }))
    const remove = vi.spyOn(document, 'removeEventListener')
    const { unmount } = render(<AmbientMedia />)
    act(() => intersect(true))
    HTMLMediaElement.prototype.pause.mockClear()
    unmount()
    expect(observers[0].disconnect).toHaveBeenCalledTimes(1)
    expect(remove).toHaveBeenCalledWith('visibilitychange', expect.any(Function))
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalledTimes(1)
    await act(async () => rejectPlayback(new Error('Element removed')))
    fireEvent(document, new Event('visibilitychange'))
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1)
  })

  it('uses page visibility when IntersectionObserver and Network Information are unavailable', () => {
    vi.stubGlobal('IntersectionObserver', undefined)
    delete navigator.connection
    const { container } = render(<AmbientMedia />)
    expect(container.querySelector('video')).not.toBeNull()
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1)
    hidden = true
    fireEvent(document, new Event('visibilitychange'))
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled()
  })
})
