import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useChatStore } from '../stores/chatStore'

// 帮助弹层与实现共用同一份清单（含既有快捷键，只做文档化）
export const SHORTCUTS = [
  { keys: 'Enter', label: '发送消息' },
  { keys: 'Shift + Enter', label: '消息换行' },
  { keys: 'Esc', label: '取消录音 / 取消输入焦点 / 关闭帮助' },
  { keys: '/', label: '聚焦聊天输入框' },
  { keys: 'Ctrl/⌘ + Shift + O', label: '新建会话' },
  { keys: 'Shift + /（?）', label: '打开本帮助' },
  { keys: '长按空格 / Enter', label: '美颜页按住看原图' },
]

const isTypingTarget = (el) =>
  el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
  || el instanceof HTMLSelectElement || el?.isContentEditable

export default function useGlobalShortcuts() {
  const [helpOpen, setHelpOpen] = useState(false)
  const helpOpenRef = useRef(false)
  const navigate = useNavigate()
  const { pathname } = useLocation()

  const setHelp = useCallback((open) => {
    helpOpenRef.current = open
    setHelpOpen(open)
  }, [])

  useEffect(() => {
    if (pathname === '/login') return undefined
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        if (helpOpenRef.current) { setHelp(false); return }
        if (isTypingTarget(document.activeElement)) document.activeElement.blur()
        return
      }
      // Ctrl/⌘+Shift+O：新建会话（全局生效，先回 /chat 再建；createConversation 无参且自动置为当前会话）
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'o') {
        event.preventDefault()
        navigate('/chat')
        useChatStore.getState().createConversation()
        return
      }
      if (event.ctrlKey || event.metaKey || event.altKey || isTypingTarget(event.target)) return
      if (event.key === '/' && pathname === '/chat') {
        event.preventDefault()
        document.querySelector('[aria-label="聊天消息"]:not([disabled])')?.focus()
      } else if (event.key === '?') {
        event.preventDefault()
        setHelp(true)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [navigate, pathname, setHelp])

  return { helpOpen, closeHelp: () => setHelp(false) }
}
