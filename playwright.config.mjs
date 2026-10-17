// Playwright end-to-end tests: the built app (docs/) in Chromium, on a desktop
// window, an emulated phone (touch) and an emulated tablet.
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60000,
  expect: { timeout: 8000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5174/',
    serviceWorkers: 'block',
    colorScheme: 'dark',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node scripts/serve.mjs 5174',
    url: 'http://localhost:5174/',
    reuseExistingServer: true,
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1280, height: 800 } }, testIgnore: /perf\.spec/ },
    { name: 'phone', use: { ...devices['Pixel 7'] }, testIgnore: /perf\.spec/ },
    { name: 'tablet', use: { ...devices['Galaxy Tab S4 landscape'] }, testIgnore: /perf\.spec/ },
    // Timing tests run last and alone: next to the others the CPU is shared
    // and they would measure the machine's load, not the editor.
    { name: 'perf', testMatch: /perf\.spec/, dependencies: ['desktop', 'phone', 'tablet'] },
  ],
});
