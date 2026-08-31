import { describe, expect, it, vi, afterEach } from 'vitest';
import { resolveCorsOrigins } from '../src/backend/config';

describe('CORS 环境变量', () => {
  it('支持 Compose 使用的 CORS_ORIGIN', () => {
    expect(resolveCorsOrigins({ CORS_ORIGIN: 'https://internal.example.cn' })).toBe(
      'https://internal.example.cn',
    );
  });

  it('CORS_ORIGINS 优先并保留逗号分隔白名单', () => {
    expect(
      resolveCorsOrigins({
        CORS_ORIGIN: 'https://single.example.cn',
        CORS_ORIGINS: ' https://a.example.cn,https://b.example.cn ',
      }),
    ).toBe('https://a.example.cn,https://b.example.cn');
  });

  it('生产未配置时返回空白名单，由服务端禁用跨域许可', () => {
    expect(resolveCorsOrigins({})).toBe('');
  });
});
describe('readInt 拒绝 0/负数 (防 RATE_LIMIT_*=0 毒化限流器)', () => {
  afterEach(() => {
    delete process.env.RATE_LIMIT_ANALYTICS;
    vi.resetModules();
  });

  it('0 与负数回退默认值', async () => {
    for (const bad of ['0', '-5']) {
      vi.resetModules();
      process.env.RATE_LIMIT_ANALYTICS = bad;
      // 动态 import: config 在模块加载时读 env, 静态 import 无法逐用例换 env
      const { config } = await import('../src/backend/config');
      expect(config.rateLimitAnalytics).toBe(60);
    }
  });

  it('合法正整数正常生效', async () => {
    vi.resetModules();
    process.env.RATE_LIMIT_ANALYTICS = '7';
    const { config } = await import('../src/backend/config');
    expect(config.rateLimitAnalytics).toBe(7);
  });
});
