// 从 App 里「分享」出来的一段文字里认出链接、商品名和来源。纯本地解析：不去打开那个网页。
const URL_PATTERN = /https?:\/\/[^\s"'<>，。！？、；：「」【】（）()\u3000]+/i
const TRAILING = /[.,;:!?）)】」]+$/
const MAX_NAME = 40

const SOURCES = [
  { pattern: /(^|\.)(tb\.cn|taobao\.com|tmall\.com)$/, label: '淘宝' },
  { pattern: /(^|\.)(xhslink\.com|xiaohongshu\.com)$/, label: '小红书' },
  { pattern: /(^|\.)(3\.cn|jd\.com)$/, label: '京东' },
  { pattern: /(^|\.)(yangkeduo\.com|pinduoduo\.com)$/, label: '拼多多' },
  { pattern: /(^|\.)(dewu\.com|poizon\.com)$/, label: '得物' },
]

// 分享文字里常见的套话，认不出商品名时先去掉它们
const BOILERPLATE = [
  /打开\s*(?:【[^】]*】)?\s*\S{0,8}?App\S*/gi,
  /【[^】]*】/g,
  /复制(?:本条|这条)信息[^，。！!]*[，。！!]?/g,
  /(?:点击链接|或者?\S{0,4}搜索)直接打开/g,
  /\S{0,12}发布了一篇\S{0,6}笔记[，,！!]?/g,
  /快来看吧[！!]?/g,
  // 小红书两个 😆 之间是一串口令码，不是标题
  /😆\s*[A-Za-z0-9]+\s*😆/gu,
  /[A-Za-z]{2}\d{3,}/g,
  /\p{Extended_Pictographic}/gu,
]

const clip = (value) => value.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME)

/**
 * 链接来自哪里：认得的写平台名，其余写域名；不是链接就空。
 * @param {string | null | undefined} link
 * @returns {string}
 */
export function sourceOf(link) {
  try {
    const host = new URL(String(link)).hostname.replace(/^www\./, '')
    return SOURCES.find((source) => source.pattern.test(host))?.label ?? host
  } catch {
    return ''
  }
}

function guessName(text, link) {
  // 淘宝、京东把商品名放在「」里；其余（比如小红书）取链接旁边去掉套话后的那句
  const quoted = text.match(/「([^」]{1,80})」/)
  if (quoted) return clip(quoted[1])
  let rest = text.replace(link, ' ')
  for (const pattern of BOILERPLATE) rest = rest.replace(pattern, ' ')
  rest = rest.replace(/^[\s，,。.!！:：-]+|[\s，,。.!！:：-]+$/g, '')
  return /\p{Script=Han}/u.test(rest) ? clip(rest) : ''
}

/**
 * @param {string} input 粘贴进来的整段文字（也可以只是一个链接）
 * @returns {{ link: string | null, name: string, source: string }}
 */
export function parseShareText(input) {
  const text = String(input ?? '').trim()
  const match = text.match(URL_PATTERN)
  if (!match) return { link: null, name: '', source: '' }
  const link = String(match[0]).replace(TRAILING, '')
  return { link, name: guessName(text, match[0]), source: sourceOf(link) }
}
