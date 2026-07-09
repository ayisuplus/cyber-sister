// Vitest 用项目根作为 root,跟 Vite (root=public/) 分开.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    root: '.',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
  },
});
