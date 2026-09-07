import js from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'

export default [
  {
    ignores: ['dist/**', 'coverage/**', 'playwright-report/**', 'test-results/**'],
  },
  js.configs.recommended,
  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.browser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // 复杂度护栏：复杂度/嵌套超阈提醒重构，循环内串行 await 直接报错（先 Promise.all 再循环）
      'complexity': ['warn', 15],
      'max-depth': ['warn', 4],
      'no-await-in-loop': 'error',
    },
  },
  {
    // 测试里串行 await 是刻意的（user-event 顺序交互/逐条断言），不受 no-await-in-loop 约束
    files: ['src/**/*.test.{js,jsx}'],
    rules: {
      'no-await-in-loop': 'off',
    },
  },
  {
    files: ['*.config.js', 'e2e/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.node,
    },
  },
]
