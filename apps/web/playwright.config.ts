import { readFileSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

/**
 * Two-browser end-to-end test of the full MVP loop against the real built server
 * (in-memory MongoDB replica set, dev login) and the production web build.
 * Telegram itself is not available here; dev login stands in for initData auth.
 *
 * Defuser is registered here (dev/test only; the server refuses both flags in production) with a
 * fixed seed, so every Defuser game deals the edition pinned in `e2e/defuser-seed.json`.
 */
const DEFUSER_SEED = (
  JSON.parse(readFileSync(new URL('./e2e/defuser-seed.json', import.meta.url), 'utf8')) as {
    seed: string;
  }
).seed;
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
        DEFUSER_ENABLED: 'true',
        DEFUSER_FIXED_SEED: DEFUSER_SEED,
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
