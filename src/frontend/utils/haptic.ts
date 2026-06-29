// 轻量级触感反馈 — 包装 navigator.vibrate,做 feature detection + safe 调用.
// 仅在支持 Vibration API 的浏览器 (Android Chrome/Edge) 上生效,iOS Safari 自动忽略.

/** 不同事件类型对应的震动模式. */
export type HapticPattern = 'tap' | 'success' | 'error' | 'select';

const PATTERNS: Record<HapticPattern, number | number[]> = {
  tap: 10, // 轻点 — 极短 10ms,接近"确认按下"感
  select: 5, // 选中 / 切换 — 比 tap 更轻
  success: [10, 30, 20], // 成功:短-停-短 双脉冲
  error: [20, 40, 20, 40, 30], // 失败:三次脉冲提示注意
};

/**
 * 触发触感反馈.出错时静默忽略 — 触感失败绝不影响主流程.
 * 每次调用重新检测 navigator.vibrate (支持测试 stub).
 * @returns 是否成功触发 (无震动能力的设备返回 false,但不抛错).
 */
export function haptic(pattern: HapticPattern = 'tap'): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') {
    return false;
  }
  try {
    return navigator.vibrate(PATTERNS[pattern]);
  } catch {
    return false;
  }
}

/** 是否支持触感反馈 (用于条件渲染 / 调试). 每次重新检测,避免 stale 状态. */
export function isHapticSupported(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
}
