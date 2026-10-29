import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:5174',
    viewport: { width: 1440, height: 960 },
    launchOptions: { channel: 'chrome' },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node scripts/dev.mjs',
    url: 'http://127.0.0.1:5174',
    reuseExistingServer: false,
    env: { TESTSTUDIO_FRONTEND_PORT: '5174', TESTSTUDIO_DATA_DIR: 'data/e2e' },
    timeout: 30_000,
  },
})
