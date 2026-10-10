import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/desktop',
  outputDir: './test-results/desktop-runs',
  timeout: 60000,
  workers: 1,
  fullyParallel: false,
  use: { trace: 'retain-on-failure' },
});
