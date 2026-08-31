// Vitest 用项目根作为 root,跟 Vite (root=public/) 分开.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    root: '.',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      // vitest v4 起 include 内文件一律计入 (all 选项已移除)
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.d.ts', // 纯类型声明,无可执行代码
        'src/frontend/main.tsx', // 纯装配入口:仅 mount React 根组件,无业务逻辑
        'src/backend/bootstrap.ts', // 纯装配入口:仅读取 env 并启动 server.listen,由 server.ts 测试覆盖业务逻辑
      ],
      thresholds: {
        lines: 80,
        statements: 80,
        functions: 80,
        branches: 80,
      },
    },
  },
});
