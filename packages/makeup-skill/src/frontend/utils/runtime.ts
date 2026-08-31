const configuredApiBase = import.meta.env.VITE_API_BASE as string | undefined;

export const API_BASE = (configuredApiBase || '/makeup/api').replace(/\/$/, '');
export const APP_BASE = (import.meta.env.BASE_URL || '/makeup/').replace(/\/?$/, '/');
export const MODEL_BASE = `${APP_BASE}mp-models`;

export function toApiUrl(path: string): string {
  // 精确匹配: '/api' 本身或以 '/api/' 开头才重写, '/apix' 不动
  if (path !== '/api' && !path.startsWith('/api/')) return path;
  return `${API_BASE}${path.slice('/api'.length)}`;
}

export function getMainAccessToken(): string | null {
  try {
    const stored = window.localStorage.getItem('cyber-sister-auth');
    if (!stored) return null;
    const parsed = JSON.parse(stored) as { state?: { token?: unknown } };
    return typeof parsed.state?.token === 'string' ? parsed.state.token : null;
  } catch {
    return null;
  }
}
