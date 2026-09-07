import js from '@eslint/js'

export default [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: {
        process: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        fetch: 'readonly',
        AbortController: 'readonly',
        Buffer: 'readonly',
        AbortSignal: 'readonly',
        FormData: 'readonly',
        Headers: 'readonly',
        Blob: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': 'off',
      'no-undef': 'error',
      'no-constant-condition': ['error', { checkLoops: false }],
      'require-await': 'warn',
      'no-return-await': 'error',
      'no-throw-literal': 'error',
      // 复杂度护栏：复杂度/嵌套超阈提醒重构，循环内串行 await 直接报错（先 Promise.all 再循环）
      'complexity': ['warn', 15],
      'max-depth': ['warn', 4],
      'no-await-in-loop': 'error',
    },
  },
  {
    // 测试里串行 await 是刻意的（顺序交互/逐条断言），不受 no-await-in-loop 约束
    files: ['src/**/*.test.js', 'tests/**/*.test.js'],
    rules: {
      'no-await-in-loop': 'off',
    },
  },
  {
    ignores: [
      'node_modules/',
      'dist/',
      'coverage/',
    ],
  },
]
