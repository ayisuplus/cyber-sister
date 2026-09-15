import { useEffect, useRef, useState } from 'react'
import { workTaskService } from '../services/workTaskService'
import { useChatStore } from '../stores/chatStore'
import { getSessionVersion, onSessionReset } from '../services/sessionLifecycle'

export function useWorkTasks(enabled) {
  const [tasks, setTasks] = useState([])
  const [available, setAvailable] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const generation = useRef(0)
  const busy = useRef(null)
  const pending = useRef(null)
  const refresh = useRef(() => {})

  useEffect(() => {
    const current = ++generation.current
    const session = getSessionVersion()
    const controller = new AbortController()
    let timer
    let loading = false
    const seen = new Map()
    const valid = () => generation.current === current && session === getSessionVersion() && !controller.signal.aborted
    setTasks([]); setAvailable(false); setError(''); setSubmitting(false)
    const load = async () => {
      if (!valid() || loading) return
      loading = true
      try {
        const next = await workTaskService.list({ signal: controller.signal })
        if (!valid()) return
        setTasks((previousTasks) => next.map((task) => {
          const previous = previousTasks.find((item) => item.id === task.id)
          return previous && previous.updatedAt > task.updatedAt ? previous : task
        }))
        setError('')
        for (const task of next) {
          if (task.status === 'completed' && seen.get(task.id) !== 'completed') {
            void useChatStore.getState().refreshConversation(task.conversationId)
          }
          seen.set(task.id, task.status)
        }
      } catch {
        if (valid()) setError('任务进度暂时无法更新，正在重试')
      } finally { loading = false }
    }
    refresh.current = load
    if (enabled) {
      void workTaskService.status().then((status) => { if (valid()) setAvailable(status.capabilities?.backgroundTasks === true) }).catch(() => {})
      void load()
      timer = setInterval(load, 5000)
    }
    const unsubscribe = onSessionReset(() => {
      controller.abort()
      clearInterval(timer)
      generation.current += 1
      busy.current = null
      pending.current = null
      setTasks([]); setAvailable(false); setError(''); setSubmitting(false)
    })
    return () => {
      controller.abort(); clearInterval(timer); unsubscribe()
      if (generation.current === current) generation.current += 1
    }
  }, [enabled])

  const submit = async (content, { files = [] } = {}) => {
    if (!available || busy.current === generation.current || useChatStore.getState().isSending) return false
    busy.current = generation.current
    setSubmitting(true)
    setError('')
    const current = generation.current
    const session = getSessionVersion()
    try {
      const chat = useChatStore.getState()
      const conversationId = chat.currentConversationId || (await chat.createConversation())?.id
      if (!conversationId || current !== generation.current || session !== getSessionVersion()) return false
      const previous = pending.current
      const sameInput = previous && previous.conversationId === conversationId && previous.content === content
        && previous.files.length === files.length && files.every((file, index) => file === previous.files[index])
      if (!sameInput) pending.current = { conversationId, content, files, requestKey: crypto.randomUUID() }
      const task = await workTaskService.create(conversationId, content, files, pending.current.requestKey)
      if (current !== generation.current || session !== getSessionVersion()) return false
      pending.current = null
      setTasks((previousTasks) => [task, ...previousTasks.filter((item) => item.id !== task.id)].slice(0, 20))
      void refresh.current()
      return true
    } catch (requestError) {
      if (current === generation.current && session === getSessionVersion()) {
        setError(requestError.response?.data?.error || '任务提交未确认，输入已保留；重试会使用同一提交标识')
      }
      return false
    } finally {
      if (busy.current === current) busy.current = null
      if (current === generation.current) setSubmitting(false)
    }
  }

  const change = async (id, action, ...args) => {
    const current = generation.current
    const session = getSessionVersion()
    try {
      const task = await workTaskService[action](id, ...args)
      if (current !== generation.current || session !== getSessionVersion()) return
      setTasks((previous) => previous.map((item) => item.id === id ? task : item))
      setError('')
    } catch (requestError) {
      if (current === generation.current && session === getSessionVersion()) setError(requestError.response?.data?.error || '任务状态修改失败，请重试')
      if (action === 'decide' && current === generation.current && session === getSessionVersion()) throw requestError
    }
  }
  return { tasks, available, submitting, error, submit, cancel: (id) => change(id, 'cancel'), retry: (id) => change(id, 'retry'),
    decide: (id, actionId, decision) => change(id, 'decide', actionId, decision) }
}
