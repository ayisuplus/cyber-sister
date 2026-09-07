import { readFileSync } from 'node:fs'
import { isIP } from 'node:net'
import { URL } from 'node:url'

const PLACEHOLDER_MARKERS = ['replace-with', 'change-in-production', 'your-super-secret', 'change-me']

function isPlaceholder(value) {
  return PLACEHOLDER_MARKERS.some((marker) => value.toLowerCase().includes(marker))
}

function isHttpUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function readSecretFile(path, name) {
  try {
    const value = readFileSync(path, 'utf8').trim()
    if (!value) throw new Error('empty secret')
    return value
  } catch {
    throw new Error(`无法读取运行密钥文件: ${name}`)
  }
}

export function loadRuntimeSecrets(env = process.env) {
  const mappings = [
    ['JWT_SECRET', 'JWT_SECRET_FILE'],
    ['JWT_REFRESH_SECRET', 'JWT_REFRESH_SECRET_FILE'],
    ['INTERNAL_TEST_CODE', 'INTERNAL_TEST_CODE_FILE'],
    ['INTERNAL_TEST_PHONES', 'INTERNAL_TEST_PHONES_FILE'],
    ['INSTANCE_ADMIN_PHONES', 'INSTANCE_ADMIN_PHONES_FILE'],
    ['GATEWAY_QWEN_API_KEY', 'GATEWAY_QWEN_API_KEY_FILE'],
  ]

  for (const [valueName, fileName] of mappings) {
    if (env[fileName]) env[valueName] = readSecretFile(env[fileName], fileName)
  }

  if (env.DATABASE_PASSWORD_FILE) {
    const password = readSecretFile(env.DATABASE_PASSWORD_FILE, 'DATABASE_PASSWORD_FILE')
    const user = encodeURIComponent(env.POSTGRES_USER || 'cyber_sister')
    const database = encodeURIComponent(env.POSTGRES_DB || 'cyber_sister')
    const host = env.DATABASE_HOST || 'postgres'
    const port = env.DATABASE_PORT || '5432'
    env.DATABASE_URL = `postgresql://${user}:${encodeURIComponent(password)}@${host}:${port}/${database}`
  }

  return env
}

export function validateRuntimeConfig(env = process.env) {
  const appEnv = env.APP_ENV || 'development'
  const nodeEnv = env.NODE_ENV || 'development'
  const protectedEnvironment = appEnv === 'internal' || nodeEnv === 'production'
  const errors = []

  if (appEnv === 'internal' && nodeEnv !== 'test') {
    for (const name of [
      'DATABASE_PASSWORD_FILE',
      'JWT_SECRET_FILE',
      'JWT_REFRESH_SECRET_FILE',
      'INTERNAL_TEST_CODE_FILE',
      'INTERNAL_TEST_PHONES_FILE',
      'INSTANCE_ADMIN_PHONES_FILE',
    ]) {
      if (!env[name]) errors.push(`内测环境必须通过只读文件提供: ${name}`)
    }
  }

  for (const name of ['DATABASE_URL', 'JWT_SECRET', 'JWT_REFRESH_SECRET']) {
    const value = env[name]
    if (!value) {
      errors.push(`缺少必需环境变量: ${name}`)
    } else if (protectedEnvironment && isPlaceholder(value)) {
      errors.push(`受保护环境禁止使用占位符: ${name}`)
    }
  }

  if (env.DATABASE_URL && !/^postgres(?:ql)?:\/\//i.test(env.DATABASE_URL)) {
    errors.push('DATABASE_URL 必须使用 PostgreSQL')
  }

  if (protectedEnvironment) {
    for (const name of ['JWT_SECRET', 'JWT_REFRESH_SECRET']) {
      if (env[name] && env[name].length < 32) errors.push(`${name} 必须至少 32 个字符`)
    }
  }

  if (appEnv === 'internal') {
    if (!/^\d{6}$/.test(env.INTERNAL_TEST_CODE || '')) {
      errors.push('内测环境的 INTERNAL_TEST_CODE 必须是 6 位数字')
    }
    const phones = (env.INTERNAL_TEST_PHONES || '')
      .split(',')
      .map((phone) => phone.trim())
      .filter(Boolean)
    if (phones.length === 0 || phones.some((phone) => !/^1[3-9]\d{9}$/.test(phone))) {
      errors.push('INTERNAL_TEST_PHONES 必须是有效的逗号分隔手机号白名单')
    }
    if (!env.CORS_ORIGIN || !env.CORS_ORIGIN.startsWith('https://')) {
      errors.push('内测环境的 CORS_ORIGIN 必须是 HTTPS 来源')
    }
    if (!env.APP_DOMAIN) {
      errors.push('内测环境缺少 APP_DOMAIN')
    } else if (env.CORS_ORIGIN) {
      try {
        if (new URL(env.CORS_ORIGIN).hostname !== env.APP_DOMAIN) {
          errors.push('APP_DOMAIN 必须与 CORS_ORIGIN 的主机名一致')
        }
      } catch {
        errors.push('CORS_ORIGIN 必须是有效 URL')
      }
    }
    if (isIP(env.BIND_ADDRESS || '') !== 4 || env.BIND_ADDRESS === '0.0.0.0') {
      errors.push('BIND_ADDRESS 必须是具体的 VPN 或可信私网 IPv4 地址')
    }
    if (!env.IMAGE_TAG || isPlaceholder(env.IMAGE_TAG) || env.IMAGE_TAG === 'latest') {
      errors.push('IMAGE_TAG 必须是唯一且不可变的发布标签，不能使用 latest 或占位符')
    }
    const admins = (env.INSTANCE_ADMIN_PHONES || '')
      .split(',')
      .map((phone) => phone.trim())
      .filter(Boolean)
    if (admins.length === 0 || admins.some((phone) => !/^1[3-9]\d{9}$/.test(phone))) {
      errors.push('INSTANCE_ADMIN_PHONES 必须是有效的逗号分隔手机号')
    } else if (admins.some((phone) => !phones.includes(phone))) {
      errors.push('INSTANCE_ADMIN_PHONES 必须是 INTERNAL_TEST_PHONES 白名单的子集')
    }
    const providers = (env.GATEWAY_PROVIDERS || '').split(',').map((value) => value.trim()).filter(Boolean)
    if (providers.some((provider) => provider !== 'qwen')) {
      errors.push('内测环境的环境供应商只允许 qwen（云端切割后本地模型面已删除）')
    }
  } else if (env.INTERNAL_TEST_CODE) {
    errors.push('固定验证码只能在 APP_ENV=internal 时使用')
  }

  const qwenValues = [
    env.GATEWAY_QWEN_BASE_URL,
    env.GATEWAY_QWEN_MODEL,
    env.GATEWAY_QWEN_API_KEY,
  ]
  const anyQwenValue = qwenValues.some(Boolean)
  if (anyQwenValue && qwenValues.some((value) => !value)) {
    errors.push('Qwen Base URL、模型名和 API Key 必须同时配置')
  }
  if (appEnv === 'internal' && nodeEnv !== 'test' && anyQwenValue && !env.GATEWAY_QWEN_API_KEY_FILE) {
    errors.push('内测环境的 Qwen API Key 必须通过只读文件提供')
  }
  if (env.GATEWAY_QWEN_BASE_URL && !isHttpUrl(env.GATEWAY_QWEN_BASE_URL)) {
    errors.push('GATEWAY_QWEN_BASE_URL 必须是有效的 HTTP(S) URL')
  }
  if (env.GATEWAY_QWEN_BASE_URL && isHttpUrl(env.GATEWAY_QWEN_BASE_URL)) {
    const qwenUrl = new URL(env.GATEWAY_QWEN_BASE_URL)
    if (qwenUrl.username || qwenUrl.password) errors.push('GATEWAY_QWEN_BASE_URL 不得内嵌凭据')
  }
  if (protectedEnvironment && env.GATEWAY_QWEN_BASE_URL && !env.GATEWAY_QWEN_BASE_URL.startsWith('https://')) {
    errors.push('受保护环境的 GATEWAY_QWEN_BASE_URL 必须使用 HTTPS')
  }
  for (const name of ['GATEWAY_QWEN_BASE_URL', 'GATEWAY_QWEN_MODEL', 'GATEWAY_QWEN_API_KEY']) {
    if (protectedEnvironment && env[name] && isPlaceholder(env[name])) {
      errors.push(`受保护环境禁止使用占位符: ${name}`)
    }
  }


  if (env.CRISIS_RESOURCES_JSON) {
    try {
      const resources = JSON.parse(env.CRISIS_RESOURCES_JSON)
      const valid = Array.isArray(resources)
        && resources.length > 0
        && resources.length <= 8
        && resources.every((resource) =>
          resource
          && typeof resource.type === 'string'
          && typeof resource.label === 'string'
          && typeof resource.guidance === 'string'
          && resource.type.trim()
          && resource.label.trim()
          && resource.guidance.trim())
      if (!valid) errors.push('CRISIS_RESOURCES_JSON 必须是 1 到 8 条完整资源')
    } catch {
      errors.push('CRISIS_RESOURCES_JSON 必须是有效 JSON')
    }
  }

  if (errors.length > 0) throw new Error(`运行配置无效: ${errors.join('; ')}`)
}
