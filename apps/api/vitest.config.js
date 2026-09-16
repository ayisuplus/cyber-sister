import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 10000,
    include: ['src/**/*.test.js', 'tests/**/*.test.js'],
    coverage: {
      provider: 'v8',
      all: true,
      include: ['src/**/*.js'],
      exclude: [
        // 测试文件自身
        'src/**/*.test.js',
        // 进程入口装配：仅 dotenv + 运行时校验 + 动态 import app.js，无业务逻辑
        'src/bootstrap.js',
        // prisma/client.js 仅实例化 PrismaClient；migrateDeploy.js 是 spawn prisma CLI 的部署脚本
        'src/prisma/**',
      ],
      // 地板不是目标。2026-09-16 连续两次实测有约 2 个点的浮动：
      // 行 84.58~86.79 / 语句 80.85~82.81 / 函数 78.60~80.93 / 分支 73.44~74.80，
      // 因此阈值取观测下限再留一档余量，避免偶发波动误伤 CI；只许往上调。
      // 函数与分支仍未达到 80%，这里如实记着，不假装达标。
      thresholds: {
        lines: 82,
        statements: 78,
        functions: 76,
        branches: 71,
      },
    },
    env: {
      APP_DISTRIBUTION: 'local',
      JWT_SECRET: 'test-jwt-secret-for-integration-test',
      JWT_REFRESH_SECRET: 'test-jwt-refresh-secret-for-integration-test',
      NODE_ENV: 'test',
      VITEST: 'true',
      APP_ENV: 'internal',
      DATABASE_URL: 'postgresql://test:test@localhost:5432/cyber_sister_test',
      INTERNAL_TEST_PHONES: '13800138000,13900139000',
      INSTANCE_ADMIN_PHONES: '13800138000',
      INTERNAL_TEST_CODE: '888888',
      CORS_ORIGIN: 'https://internal.example.test',
      APP_DOMAIN: 'internal.example.test',
      BIND_ADDRESS: '127.0.0.1',
      IMAGE_TAG: 'test-20260829',
      GATEWAY_PROVIDERS: 'qwen',
      GATEWAY_QWEN_BASE_URL: 'https://example.invalid/compatible-mode/v1',
      GATEWAY_QWEN_MODEL: 'test-qwen-model',
      GATEWAY_QWEN_API_KEY: 'test-key',
      LOCAL_LLM_ALLOWED_ORIGINS: 'http://llama:8080,http://host.docker.internal:8080,http://127.0.0.1:8080',
    },
  },
})
