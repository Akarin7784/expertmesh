import { defineConfig } from '@playwright/test';
const apiPort = Number(process.env.E2E_API_PORT || 3001);
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
      url: `http://127.0.0.1:${apiPort}/api/health`,
      env: { E2E_API_PORT: String(apiPort) },
      reuseExistingServer: false,
      timeout: 30000,
    },
    {
      command: 'npx vite --host 127.0.0.1',
      url: 'http://127.0.0.1:5173',
      env: { VITE_API_TARGET: `http://127.0.0.1:${apiPort}` },
      reuseExistingServer: false,
      timeout: 30000,
    },
  ],
});
