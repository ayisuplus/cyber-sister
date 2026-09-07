/**
 * 危机事件留存服务
 *
 * 危机落库的唯一入口：聊天阻断事务（chatService.persistBlockedCrisis）
 * 与合规上报路由（routes/compliance.js）都经由这里写入 CrisisLog。
 *
 * 单一留存口径：triggerMsg 一律不落库（取两处旧实现中更少留存的口径，
 * 即原 chatService.persistBlockedCrisis 的 null 策略）；合规上报路由
 * 此前保留的触发消息原文（截断 500 字）随之取消。
 */

/**
 * 写入一条危机记录。
 * @param {object} client prisma 客户端或事务客户端
 * @param {{ userId: string, level: 'high' | 'medium', handled: boolean }} entry
 */
export function createCrisisLog(client, { userId, level, handled }) {
  return client.crisisLog.create({
    data: {
      userId,
      triggerMsg: null,
      level,
      handled,
    },
  })
}
