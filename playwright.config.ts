import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testIgnore: ['**/*security.test.mjs', '**/shared/**', '**/logistics-shared/**', '**/integration/**', '**/native/**', '**/purchasing-ui/**'],
  fullyParallel: false,
  use: {
    baseURL: 'http://127.0.0.1:5174',
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
