import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 10000,
    include: ['src/**/*.test.js', 'tests/**/*.test.js'],
    env: {
      JWT_SECRET: 'test-jwt-secret-for-integration-test',
      JWT_REFRESH_SECRET: 'test-jwt-refresh-secret-for-integration-test',
      NODE_ENV: 'test',
      VITEST: 'true',
      DATABASE_URL: 'file:./test.db',
    },
  },
})
