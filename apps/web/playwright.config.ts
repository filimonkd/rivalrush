import { defineConfig, devices } from '@playwright/test';

/**
 * Two-browser end-to-end test of the full MVP loop against the real built server
 * (in-memory MongoDB replica set, dev login) and the production web build.
 * Telegram itself is not available here; dev login stands in for initData auth.
 */
const SERVER_PORT = 4100;
const WEB_PORT = 4173;
const chromiumPath = process.env.PW_CHROMIUM_PATH;

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure',
    ...devices['Pixel 7'],
    ...(chromiumPath ? { launchOptions: { executablePath: chromiumPath } } : {}),
  },
  webServer: [
    {
      command: 'node ../server/dist/index.js',
      url: `http://localhost:${SERVER_PORT}/health`,
      timeout: 120_000,
      reuseExistingServer: false,
      env: {
        NODE_ENV: 'development',
        PORT: String(SERVER_PORT),
        DEV_LOGIN_ENABLED: 'true',
        CLIENT_ORIGINS: `http://localhost:${WEB_PORT}`,
        LOG_LEVEL: 'warn',
        DISCONNECT_GRACE_SECONDS: '60',
      },
    },
    {
      command: `npx vite build && npx vite preview --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}`,
      timeout: 180_000,
      reuseExistingServer: false,
      env: {
        VITE_API_URL: `http://localhost:${SERVER_PORT}`,
        VITE_DEV_LOGIN: 'true',
        VITE_BOT_USERNAME: '',
      },
    },
  ],
});
