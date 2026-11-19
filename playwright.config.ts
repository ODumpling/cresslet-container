import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  timeout: 180_000,
  expect: { timeout: 60_000 },
  workers: 1,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:4401', ...devices['Desktop Chrome'] },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: { command: 'node scripts/serve.mjs', env: { PORT: '4401' }, url: 'http://localhost:4401/', reuseExistingServer: true },
})
