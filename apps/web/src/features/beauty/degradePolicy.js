// 美颜实时预览的性能自适应降级策略：全部为纯函数，便于单测。
// 思路：慢则快降（避免卡顿累积），快则慢升（迟滞 + 更长的观察窗），防止档位来回振荡。

/** @typedef {{ width: number, intervalMs: number }} Tier */

/**
 * 档位表：0 档画质最高，越往后帧画布越窄、帧间隔越长（越省资源）。
 * @type {readonly Tier[]}
 */
export const TIERS = [
  { width: 1280, intervalMs: 33 },
  { width: 960, intervalMs: 66 },
  { width: 640, intervalMs: 100 },
]

/** EMA 平滑系数：新帧耗时占 20%，历史占 80% */
export const EMA_ALPHA = 0.2
/** 单帧 EMA 超过该耗时判定为「设备跟不上」，触发降档 */
export const DOWNGRADE_EMA_MS = 120
/** 单帧 EMA 低于该耗时判定为「性能宽裕」，允许升档 */
export const UPGRADE_EMA_MS = 40
/** 距上次换档的最短间隔（降档冷却），避免抖动 */
export const SWITCH_COOLDOWN_MS = 3000
/** 升档前必须在当前档位稳定停留的时长（迟滞防振荡） */
export const UPGRADE_HOLD_MS = 10000

/**
 * 用新的一帧耗时更新指数移动平均（EMA）。
 * @param {number | null} previousMs 已有 EMA；null 表示还没有样本
 * @param {number} sampleMs 本帧耗时
 * @param {number} [alpha]
 * @returns {number}
 */
export function updateEma(previousMs, sampleMs, alpha = EMA_ALPHA) {
  if (previousMs == null) return sampleMs
  return previousMs + alpha * (sampleMs - previousMs)
}

/**
 * 根据当前 EMA 决定档位是否变化。
 * - 降档：emaMs 超阈值且距上次换档已满冷却期，降一档（最多到最后一档）。
 * - 升档：emaMs 低于阈值且在当前档位稳定停留满观察窗，升一档（最多到 0 档）。
 * @param {{ emaMs: number, tier: number, sinceMs: number, nowMs: number }} input
 *   sinceMs 为上次换档（或开始计时）的时间戳，nowMs 为当前时间戳。
 * @returns {{ tier: number, changed: boolean }}
 */
export function decideTier({ emaMs, tier, sinceMs, nowMs }) {
  const heldMs = nowMs - sinceMs
  if (tier < TIERS.length - 1 && emaMs > DOWNGRADE_EMA_MS && heldMs >= SWITCH_COOLDOWN_MS) {
    return { tier: tier + 1, changed: true }
  }
  if (tier > 0 && emaMs < UPGRADE_EMA_MS && heldMs >= UPGRADE_HOLD_MS) {
    return { tier: tier - 1, changed: true }
  }
  return { tier, changed: false }
}
