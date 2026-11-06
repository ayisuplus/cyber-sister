import { defineConfig, devices } from '@playwright/test'
import { fileURLToPath } from 'node:url'

process.env.E2E_DIST_DIR = fileURLToPath(new URL('./dist-ios', import.meta.url))
export default defineConfig({
  testDir: './e2e', testMatch: 'ios-smoke.spec.js', globalSetup: './e2e/global-setup.js',
  workers: 1, retries: 0, reporter: 'list',
  use: { ...devices['iPhone 13'], browserName: 'chromium', baseURL: 'http://127.0.0.1:4173', trace: 'retain-on-failure', contextOptions: { reducedMotion: 'reduce' } },
})
