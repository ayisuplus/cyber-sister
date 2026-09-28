import { afterEach, describe, expect, it, vi } from 'vitest'
import { askNotificationPermission, notificationState, notifyWake } from './notify'

class FakeNotification {
  static permission = 'default'
  static requestPermission = vi.fn(async () => { FakeNotification.permission = 'granted'; return 'granted' })
  static made = []

  constructor(title, options) {
    this.title = title
    this.options = options
    this.close = vi.fn()
    FakeNotification.made.push(this)
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  FakeNotification.permission = 'default'
  FakeNotification.made = []
  FakeNotification.requestPermission.mockClear()
})

describe('早安通知', () => {
  it('不支持通知的浏览器：如实说不支持，也不弹', async () => {
    vi.stubGlobal('Notification', undefined)
    expect(notificationState()).toBe('unsupported')
    await expect(askNotificationPermission()).resolves.toBe('unsupported')
    expect(notifyWake('早安')).toBeNull()
  })

  it('只在还没决定过时问一次', async () => {
    vi.stubGlobal('Notification', FakeNotification)
    await expect(askNotificationPermission()).resolves.toBe('granted')
    await askNotificationPermission()
    expect(FakeNotification.requestPermission).toHaveBeenCalledTimes(1)
  })

  it('允许了才弹：标题「早安」、正文是那句话、自身静音、点一下回到页面', () => {
    vi.stubGlobal('Notification', FakeNotification)
    expect(notifyWake('慢慢来，今天会等你。')).toBeNull()

    FakeNotification.permission = 'granted'
    const focus = vi.spyOn(window, 'focus').mockImplementation(() => {})
    const notification = notifyWake('慢慢来，今天会等你。')
    expect(notification.title).toBe('早安')
    expect(notification.options).toMatchObject({ body: '慢慢来，今天会等你。', tag: 'amie-wake', requireInteraction: true, silent: true })
    notification.onclick()
    expect(focus).toHaveBeenCalled()
    expect(notification.close).toHaveBeenCalled()
  })

  it('被拒绝了：不弹', () => {
    FakeNotification.permission = 'denied'
    vi.stubGlobal('Notification', FakeNotification)
    expect(notifyWake('早安')).toBeNull()
    expect(FakeNotification.made).toHaveLength(0)
  })
})
