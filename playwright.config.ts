import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  timeout: 180_000,
  expect: { timeout: 60_000 },
  workers: 1,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:4401', ...devices['Desktop Chrome'] },
  // chromium is the supported target; firefox/webkit are best-effort (`pnpm test:e2e --project=firefox`)
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: { command: 'node scripts/serve.ts', env: { PORT: '4401' }, url: 'http://localhost:4401/', reuseExistingServer: true },
})
