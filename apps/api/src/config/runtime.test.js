import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadRuntimeSecrets, validateRuntimeConfig } from './runtime.js'

function internalEnv(overrides = {}) {
  return {
    APP_ENV: 'internal',
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    JWT_SECRET: 'x'.repeat(32),
    JWT_REFRESH_SECRET: 'y'.repeat(32),
    INTERNAL_TEST_CODE: '888888',
    INTERNAL_TEST_PHONES: '13800138000,13900139000',
    INSTANCE_ADMIN_PHONES: '13800138000',
    CORS_ORIGIN: 'https://internal.example.test',
    APP_DOMAIN: 'internal.example.test',
    BIND_ADDRESS: '127.0.0.1',
    IMAGE_TAG: 'test-20260830',
    ...overrides,
  }
}

describe('本地优先运行配置', () => {
  it('不配置 Qwen 也可启动，实例管理员必须在白名单内', () => {
    expect(() => validateRuntimeConfig(internalEnv())).not.toThrow()
    expect(() => validateRuntimeConfig(internalEnv({ INSTANCE_ADMIN_PHONES: '13700137000' })))
      .toThrow(/INSTANCE_ADMIN_PHONES 必须是 INTERNAL_TEST_PHONES 白名单的子集/)
  })

  it('内测环境的环境供应商只允许 qwen（本地模型面已删除）', () => {
    expect(() => validateRuntimeConfig(internalEnv({ GATEWAY_PROVIDERS: 'llamacpp' })))
      .toThrow(/内测环境的环境供应商只允许 qwen/)
    expect(() => validateRuntimeConfig(internalEnv({ GATEWAY_PROVIDERS: 'qwen' }))).not.toThrow()
  })
})

describe('loadRuntimeSecrets', () => {
  let dir

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
    dir = undefined
  })

  function secretFile(name, content) {
    dir ??= mkdtempSync(join(tmpdir(), 'runtime-secrets-'))
    const path = join(dir, name)
    writeFileSync(path, content)
    return path
  }

  it('从只读文件加载密钥并去除首尾空白', () => {
    const env = { JWT_SECRET_FILE: secretFile('jwt', '  s3cret-value\n') }
    const result = loadRuntimeSecrets(env)
    expect(result.JWT_SECRET).toBe('s3cret-value')
  })

  it('密钥文件缺失或为空时抛出可读错误', () => {
    expect(() => loadRuntimeSecrets({ JWT_SECRET_FILE: join(tmpdir(), 'no-such-file-xyz') }))
      .toThrow(/无法读取运行密钥文件: JWT_SECRET_FILE/)
    expect(() => loadRuntimeSecrets({ JWT_SECRET_FILE: secretFile('empty', '   ') }))
      .toThrow(/无法读取运行密钥文件/)
  })

  it('DATABASE_PASSWORD_FILE 组合出完整 DATABASE_URL 并转义特殊字符', () => {
    const env = { DATABASE_PASSWORD_FILE: secretFile('dbpass', 'p@ss/word#1') }
    loadRuntimeSecrets(env)
    expect(env.DATABASE_URL)
      .toBe(`postgresql://cyber_sister:${encodeURIComponent('p@ss/word#1')}@postgres:5432/cyber_sister`)
  })

  it('数据库连接参数可被环境覆盖', () => {
    const env = {
      DATABASE_PASSWORD_FILE: secretFile('dbpass', 'pw'),
      POSTGRES_USER: 'app',
      POSTGRES_DB: 'appdb',
      DATABASE_HOST: 'db.internal',
      DATABASE_PORT: '5544',
    }
    loadRuntimeSecrets(env)
    expect(env.DATABASE_URL).toBe('postgresql://app:pw@db.internal:5544/appdb')
  })
})

describe('validateRuntimeConfig 通用校验', () => {
  const devEnv = (overrides = {}) => ({
    APP_ENV: 'development',
    NODE_ENV: 'development',
    DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
    JWT_SECRET: 'dev-secret',
    JWT_REFRESH_SECRET: 'dev-refresh',
    ...overrides,
  })

  it('开发环境最小配置可通过', () => {
    expect(() => validateRuntimeConfig(devEnv())).not.toThrow()
  })

  it('缺少必需环境变量时报错', () => {
    expect(() => validateRuntimeConfig(devEnv({ DATABASE_URL: '' })))
      .toThrow(/缺少必需环境变量: DATABASE_URL/)
    expect(() => validateRuntimeConfig(devEnv({ JWT_SECRET: undefined })))
      .toThrow(/缺少必需环境变量: JWT_SECRET/)
  })

  it('DATABASE_URL 必须是 PostgreSQL 连接串', () => {
    expect(() => validateRuntimeConfig(devEnv({ DATABASE_URL: 'mysql://localhost/db' })))
      .toThrow(/DATABASE_URL 必须使用 PostgreSQL/)
  })

  it('非内测环境禁止使用固定验证码', () => {
    expect(() => validateRuntimeConfig(devEnv({ INTERNAL_TEST_CODE: '888888' })))
      .toThrow(/固定验证码只能在 APP_ENV=internal 时使用/)
  })

  it('受保护环境拒绝占位符与过短密钥', () => {
    expect(() => validateRuntimeConfig(devEnv({
      NODE_ENV: 'production',
      JWT_SECRET: 'replace-with-real-secret-value-here',
    }))).toThrow(/受保护环境禁止使用占位符: JWT_SECRET/)

    expect(() => validateRuntimeConfig(devEnv({
      NODE_ENV: 'production',
      JWT_SECRET: 'short',
    }))).toThrow(/JWT_SECRET 必须至少 32 个字符/)
  })

  it('Qwen 三项配置必须同时提供', () => {
    expect(() => validateRuntimeConfig(devEnv({ GATEWAY_QWEN_BASE_URL: 'https://qwen.test/v1' })))
      .toThrow(/Qwen Base URL、模型名和 API Key 必须同时配置/)
  })

  it('Qwen Base URL 必须是合法的 HTTP(S) URL 且不得内嵌凭据', () => {
    const base = devEnv({ GATEWAY_QWEN_MODEL: 'm', GATEWAY_QWEN_API_KEY: 'k' })
    expect(() => validateRuntimeConfig({ ...base, GATEWAY_QWEN_BASE_URL: 'ftp://x' }))
      .toThrow(/GATEWAY_QWEN_BASE_URL 必须是有效的 HTTP\(S\) URL/)
    expect(() => validateRuntimeConfig({ ...base, GATEWAY_QWEN_BASE_URL: 'https://u:p@qwen.test/v1' }))
      .toThrow(/GATEWAY_QWEN_BASE_URL 不得内嵌凭据/)
  })

  it('受保护环境的 Qwen Base URL 必须使用 HTTPS 且禁止占位符', () => {
    const base = devEnv({ NODE_ENV: 'production', GATEWAY_QWEN_MODEL: 'm', GATEWAY_QWEN_API_KEY: 'k' })
    expect(() => validateRuntimeConfig({ ...base, GATEWAY_QWEN_BASE_URL: 'http://qwen.test/v1' }))
      .toThrow(/受保护环境的 GATEWAY_QWEN_BASE_URL 必须使用 HTTPS/)
    expect(() => validateRuntimeConfig({ ...base, GATEWAY_QWEN_API_KEY: 'change-me' }))
      .toThrow(/受保护环境禁止使用占位符: GATEWAY_QWEN_API_KEY/)
  })

  it('CRISIS_RESOURCES_JSON 必须是 1 到 8 条完整资源', () => {
    expect(() => validateRuntimeConfig(devEnv({ CRISIS_RESOURCES_JSON: 'not-json' })))
      .toThrow(/CRISIS_RESOURCES_JSON 必须是有效 JSON/)
    expect(() => validateRuntimeConfig(devEnv({ CRISIS_RESOURCES_JSON: '[]' })))
      .toThrow(/CRISIS_RESOURCES_JSON 必须是 1 到 8 条完整资源/)
    expect(() => validateRuntimeConfig(devEnv({
      CRISIS_RESOURCES_JSON: JSON.stringify(Array.from({ length: 9 }, () => ({
        type: 'hotline', label: 'x', guidance: 'y',
      }))),
    }))).toThrow(/CRISIS_RESOURCES_JSON 必须是 1 到 8 条完整资源/)
    expect(() => validateRuntimeConfig(devEnv({
      CRISIS_RESOURCES_JSON: JSON.stringify([{ type: 'hotline', label: '', guidance: 'y' }]),
    }))).toThrow(/CRISIS_RESOURCES_JSON 必须是 1 到 8 条完整资源/)
    expect(() => validateRuntimeConfig(devEnv({
      CRISIS_RESOURCES_JSON: JSON.stringify([{ type: 'hotline', label: '求助热线', guidance: '请拨打' }]),
    }))).not.toThrow()
  })
})

describe('validateRuntimeConfig 内测环境校验', () => {
  it('非 test 的内测环境必须通过文件提供密钥', () => {
    expect(() => validateRuntimeConfig(internalEnv({ NODE_ENV: 'production' })))
      .toThrow(/内测环境必须通过只读文件提供: DATABASE_PASSWORD_FILE/)
  })

  it('内测环境校验固定验证码与手机号白名单', () => {
    expect(() => validateRuntimeConfig(internalEnv({ INTERNAL_TEST_CODE: '12345' })))
      .toThrow(/INTERNAL_TEST_CODE 必须是 6 位数字/)
    expect(() => validateRuntimeConfig(internalEnv({ INTERNAL_TEST_PHONES: '' })))
      .toThrow(/INTERNAL_TEST_PHONES 必须是有效的逗号分隔手机号白名单/)
    expect(() => validateRuntimeConfig(internalEnv({ INTERNAL_TEST_PHONES: '23800138000' })))
      .toThrow(/INTERNAL_TEST_PHONES 必须是有效的逗号分隔手机号白名单/)
  })

  it('CORS_ORIGIN 必须是 HTTPS 且与 APP_DOMAIN 主机名一致', () => {
    expect(() => validateRuntimeConfig(internalEnv({ CORS_ORIGIN: 'http://internal.example.test' })))
      .toThrow(/CORS_ORIGIN 必须是 HTTPS 来源/)
    expect(() => validateRuntimeConfig(internalEnv({ APP_DOMAIN: '' })))
      .toThrow(/内测环境缺少 APP_DOMAIN/)
    expect(() => validateRuntimeConfig(internalEnv({ APP_DOMAIN: 'other.example.test' })))
      .toThrow(/APP_DOMAIN 必须与 CORS_ORIGIN 的主机名一致/)
    expect(() => validateRuntimeConfig(internalEnv({ CORS_ORIGIN: 'https://' })))
      .toThrow(/CORS_ORIGIN 必须是有效 URL|APP_DOMAIN/)
  })

  it('BIND_ADDRESS 必须是具体 IPv4 且不能是 0.0.0.0', () => {
    expect(() => validateRuntimeConfig(internalEnv({ BIND_ADDRESS: '0.0.0.0' })))
      .toThrow(/BIND_ADDRESS 必须是具体的 VPN 或可信私网 IPv4 地址/)
    expect(() => validateRuntimeConfig(internalEnv({ BIND_ADDRESS: 'not-an-ip' })))
      .toThrow(/BIND_ADDRESS 必须是具体的 VPN 或可信私网 IPv4 地址/)
  })

  it('IMAGE_TAG 不允许 latest、占位符或缺失', () => {
    expect(() => validateRuntimeConfig(internalEnv({ IMAGE_TAG: 'latest' })))
      .toThrow(/IMAGE_TAG 必须是唯一且不可变的发布标签/)
    expect(() => validateRuntimeConfig(internalEnv({ IMAGE_TAG: '' })))
      .toThrow(/IMAGE_TAG 必须是唯一且不可变的发布标签/)
  })

  it('实例管理员必须是合法手机号', () => {
    expect(() => validateRuntimeConfig(internalEnv({ INSTANCE_ADMIN_PHONES: 'bad' })))
      .toThrow(/INSTANCE_ADMIN_PHONES 必须是有效的逗号分隔手机号/)
  })

  it('内测环境只允许 qwen 作为环境供应商', () => {
    expect(() => validateRuntimeConfig(internalEnv({ GATEWAY_PROVIDERS: 'qwen,openai' })))
      .toThrow(/内测环境的环境供应商只允许 qwen/)
  })

  it('非 test 内测环境的 Qwen Key 必须通过文件提供', () => {
    const env = internalEnv({
      NODE_ENV: 'production',
      DATABASE_PASSWORD_FILE: '/run/secrets/db',
      JWT_SECRET_FILE: '/run/secrets/jwt',
      JWT_REFRESH_SECRET_FILE: '/run/secrets/jwt-refresh',
      INTERNAL_TEST_CODE_FILE: '/run/secrets/code',
      INTERNAL_TEST_PHONES_FILE: '/run/secrets/phones',
      INSTANCE_ADMIN_PHONES_FILE: '/run/secrets/admins',
      GATEWAY_QWEN_BASE_URL: 'https://qwen.test/v1',
      GATEWAY_QWEN_MODEL: 'qwen-model',
      GATEWAY_QWEN_API_KEY: 'real-key',
    })
    expect(() => validateRuntimeConfig(env)).toThrow(/Qwen API Key 必须通过只读文件提供/)
  })
})
