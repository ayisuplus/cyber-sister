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
    },
  },
  {
    ignores: [
      'node_modules/',
      'dist/',
      'coverage/',
      'src/prisma/dev.db',
    ],
  },
]
