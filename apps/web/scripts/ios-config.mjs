export function iosBuildSettings(env = process.env) {
  const value = env.AMIE_IOS_API_URL || 'https://api.example.invalid/api'
  let url
  try { url = new URL(value) } catch { throw new Error('AMIE_IOS_API_URL 必须为 HTTPS API 地址') }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname.replace(/\/$/, '') !== '/api') {
    throw new Error('AMIE_IOS_API_URL 必须为不含凭据、查询参数的 https://主机/api')
  }
  const apiUrl = `${url.origin}/api`
  return {
    apiUrl,
    csp: `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: ${url.origin}; media-src 'self' data: blob: ${url.origin}; font-src 'self' data:; connect-src 'self' ${url.origin}; object-src 'none'; base-uri 'none'; frame-src 'none'`,
  }
}
