import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  outputDir: './test-results/demo',
  testIgnore: ['**/*.unit.test.mjs', '**/*security.test.mjs', '**/*.unit.test.mjs', '**/shared/**', '**/logistics-shared/**'],
  fullyParallel: false,
  use: {
    baseURL: 'http://127.0.0.1:5174',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : {},
  },
  webServer: {
    command: process.env.TEST_PRODUCTION ? 'npm run build && npm run preview -- --host 127.0.0.1 --port 5174 --strictPort' : 'npm run dev -- --host 127.0.0.1 --port 5174 --strictPort',
    url: 'http://127.0.0.1:5174',
    env: { VITE_INVENTORY_MODE: 'demo' },
    reuseExistingServer: !process.env.CI && !process.env.TEST_PRODUCTION,
  },
});
