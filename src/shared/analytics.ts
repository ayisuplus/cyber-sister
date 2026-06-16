// 轻量级事件埋点 — console.log + POST /api/analytics,fire-and-forget.
// 任何错误不抛,绝不影响 UI.

const ENDPOINT = '/api/analytics';

export type AnalyticsProps = Record<string, unknown> | undefined;

export function track(event: string, props?: AnalyticsProps): void {
  const payload = {
    event,
    props: props ?? {},
    timestamp: Date.now(),
  };
  // 开发模式方便肉眼看到
  if (typeof console !== 'undefined') {
    // eslint-disable-next-line no-console
    console.log('[analytics]', event, props ?? {});
  }
  if (typeof fetch === 'undefined') return;
  try {
    void fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => {
      /* 静默 */
    });
  } catch {
    /* 静默 */
  }
}

/**
 * 计时器辅助:记录 fromNow() 到 now() 的毫秒数.
 */
export function startTimer(): () => number {
  const t0 = Date.now();
  return () => Date.now() - t0;
}
