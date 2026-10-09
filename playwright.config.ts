import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:5173',
    headless: true,
    channel: process.env.CI ? 'chromium' : 'msedge',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'npx tsx tests/e2e-server.ts',
      url: 'http://127.0.0.1:3001/api/health',
      reuseExistingServer: false,
      timeout: 30000,
    },
    {
      command: 'npx vite --host 127.0.0.1',
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: false,
      timeout: 30000,
    },
  ],
});
