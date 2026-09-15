// 每次身份边界变化都使旧请求失效；令牌轮换本身不改变会话归属。
let sessionVersion = 0
const resetHandlers = new Set()

export const getSessionVersion = () => sessionVersion

export const assertSessionVersion = (version) => {
  if (version !== sessionVersion) {
    throw Object.assign(new Error('登录会话已切换'), { code: 'SESSION_CHANGED' })
  }
}

export const onSessionReset = (handler) => {
  resetHandlers.add(handler)
  return () => resetHandlers.delete(handler)
}

export const resetSession = () => {
  sessionVersion += 1
  for (const reset of resetHandlers) reset()
}
