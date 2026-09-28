// 早安闹钟的系统通知（路线图 C28）：浏览器在本机弹的通知，不是服务器推送。只有早安闹钟用，晚安提醒不弹。
// 权限只在她打开闹钟的那一下申请（浏览器要求由点击触发）；拒绝了就只有铃声，睡眠卡上如实写。

/** 'unsupported' | 'default' | 'granted' | 'denied' */
export function notificationState() {
  if (typeof Notification === 'undefined') return 'unsupported'
  return Notification.permission
}

/** 在点击里调用；已经决定过的不再问。 */
export async function askNotificationPermission() {
  if (notificationState() !== 'default') return notificationState()
  try {
    return await Notification.requestPermission()
  } catch {
    return notificationState()
  }
}

/**
 * 弹一条早安通知，点一下回到 Amie。铃声由页面自己放，通知本身静音，免得两种声音叠在一起。
 * @param {string} body
 * @returns {Notification | null}
 */
export function notifyWake(body) {
  if (notificationState() !== 'granted') return null
  try {
    const notification = new Notification('早安', { body, tag: 'amie-wake', requireInteraction: true, silent: true })
    notification.onclick = () => {
      window.focus()
      notification.close()
    }
    return notification
  } catch {
    return null
  }
}
