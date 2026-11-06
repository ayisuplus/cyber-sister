import { useEffect, useState } from 'react'
import { App as NativeApp } from '@capacitor/app'
import { Keyboard } from '@capacitor/keyboard'
import { isIOSApp } from './native'
import { useAuthStore } from '../stores/authStore'
import { useChatStore } from '../stores/chatStore'

let restorePromise
const restore = () => {
  restorePromise ??= useAuthStore.getState().restoreMobileSession().finally(() => { restorePromise = null })
  return restorePromise
}

export function handleAppState({ isActive }) {
  if (!isActive) useChatStore.getState().interruptForBackground()
  else if (useAuthStore.getState().isLoggedIn) void useChatStore.getState().refreshThread()
}

export default function MobileStartup({ children }) {
  const native = isIOSApp()
  const [ready, setReady] = useState(!native)
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!native) return undefined
    let alive = true
    setError(false)
    restore().then(() => { if (alive) setReady(true) }).catch(() => { if (alive) setError(true) })
    return () => { alive = false }
  }, [native, attempt])

  useEffect(() => {
    if (!native) return undefined
    document.documentElement.dataset.native = 'ios'
    const handles = [NativeApp.addListener('appStateChange', handleAppState)]
    const keyboard = (open) => {
      document.documentElement.dataset.keyboard = open ? 'open' : 'closed'
      window.dispatchEvent(new Event('resize'))
    }
    handles.push(Keyboard.addListener('keyboardDidShow', () => keyboard(true)))
    handles.push(Keyboard.addListener('keyboardDidHide', () => keyboard(false)))
    const offline = () => handleAppState({ isActive: false })
    const online = () => handleAppState({ isActive: true })
    window.addEventListener('offline', offline)
    window.addEventListener('online', online)
    return () => {
      for (const handle of handles) void handle.then(listener => listener.remove())
      window.removeEventListener('offline', offline)
      window.removeEventListener('online', online)
    }
  }, [native])

  if (ready) return children
  return <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-surface-page p-6 text-text-primary">
    <p role="status">{error ? '暂时无法恢复登录，请检查网络后重试。' : '正在打开你的本子…'}</p>
    {error && <button className="min-h-11 rounded-control bg-action-primary px-6 text-text-inverse" onClick={() => setAttempt(value => value + 1)}>重试</button>}
  </main>
}
