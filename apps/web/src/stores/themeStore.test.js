import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import indexHtml from '../../index.html?raw'
import { resetSession } from '../services/sessionLifecycle'
import { startThemeSync, useThemeStore } from './themeStore'

const bootstrap = indexHtml.match(/<script>([\s\S]*?)<\/script>/)[1]
let media
let listeners
let stopSync

function systemChanges(dark) {
  media.matches = dark
  listeners.forEach(listener => listener({ matches: dark }))
}

beforeEach(() => {
  listeners = new Set()
  media = {
    matches: false,
    addEventListener: vi.fn((_, listener) => listeners.add(listener)),
    removeEventListener: vi.fn((_, listener) => listeners.delete(listener)),
  }
  vi.spyOn(window, 'matchMedia').mockReturnValue(media)
  useThemeStore.setState({ preference: 'system' })
})

afterEach(() => {
  stopSync?.()
  stopSync = undefined
  vi.restoreAllMocks()
  delete document.documentElement.dataset.theme
  document.documentElement.style.removeProperty('color-scheme')
})

describe('device theme preference', () => {
  it.each([
    [null, false, 'system', 'light'],
    [null, true, 'system', 'dark'],
    ['system', true, 'system', 'dark'],
    ['invalid', true, 'system', 'dark'],
    ['dark', false, 'dark', 'dark'],
    ['light', true, 'light', 'light'],
  ])('keeps first-paint and runtime resolution aligned for %s / system dark %s', (saved, dark, preference, theme) => {
    if (saved !== null) localStorage.setItem('amie-theme', saved)
    media.matches = dark

    // 执行真实 HTML 的提前配色脚本，防止两处解析规则漂移。
    new Function(bootstrap)()
    expect(document.documentElement.dataset.theme).toBe(theme)
    expect(document.documentElement.style.colorScheme).toBe(theme)

    stopSync = startThemeSync()
    expect(useThemeStore.getState().preference).toBe(preference)
    expect(document.documentElement.dataset.theme).toBe(theme)
  })

  it('follows OS changes only while system is selected, and persists manual choices', () => {
    stopSync = startThemeSync()
    systemChanges(true)
    expect(document.documentElement.dataset.theme).toBe('dark')

    useThemeStore.getState().setPreference('light')
    expect(localStorage.getItem('amie-theme')).toBe('light')
    systemChanges(false)
    systemChanges(true)
    expect(document.documentElement.dataset.theme).toBe('light')

    useThemeStore.getState().setPreference('system')
    expect(localStorage.getItem('amie-theme')).toBe('system')
    expect(document.documentElement.dataset.theme).toBe('dark')
    systemChanges(false)
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('works for the current visit when local storage access is denied', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied') })
    media.matches = true

    expect(() => new Function(bootstrap)()).not.toThrow()
    expect(document.documentElement.dataset.theme).toBe('dark')
    stopSync = startThemeSync()
    expect(() => useThemeStore.getState().setPreference('light')).not.toThrow()
    expect(useThemeStore.getState().preference).toBe('light')
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('syncs local-storage changes between tabs, including removed and invalid preferences', () => {
    stopSync = startThemeSync()
    const storage = (key, newValue, storageArea = localStorage) => {
      window.dispatchEvent(new StorageEvent('storage', { key, newValue, storageArea }))
    }
    storage('amie-theme', 'dark')
    expect(useThemeStore.getState().preference).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    storage('unrelated', 'light')
    storage('amie-theme', 'light', sessionStorage)
    expect(useThemeStore.getState().preference).toBe('dark')

    storage('amie-theme', 'invalid')
    expect(useThemeStore.getState().preference).toBe('system')
    expect(document.documentElement.dataset.theme).toBe('light')
    storage('amie-theme', 'dark')
    storage('amie-theme', null)
    expect(useThemeStore.getState().preference).toBe('system')
    storage('amie-theme', 'dark')
    storage(null, null)
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('preserves the device preference across an account session reset', () => {
    stopSync = startThemeSync()
    useThemeStore.getState().setPreference('dark')
    resetSession()
    expect(localStorage.getItem('amie-theme')).toBe('dark')
    expect(useThemeStore.getState().preference).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('cleans up listeners when the application runtime is disposed', () => {
    const stop = startThemeSync()
    expect(listeners.size).toBe(1)
    stop()
    expect(listeners.size).toBe(0)
    systemChanges(true)
    window.dispatchEvent(new StorageEvent('storage', { key: 'amie-theme', newValue: 'dark' }))
    expect(document.documentElement.dataset.theme).toBe('light')
  })
})
