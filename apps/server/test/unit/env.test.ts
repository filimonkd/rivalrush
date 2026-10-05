import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../../src/config/env.js';

const prod = {
  NODE_ENV: 'production',
  BOT_TOKEN: '123:abc',
  JWT_SECRET: 'x'.repeat(40),
  MONGODB_URI: 'mongodb+srv://example/db',
  CLIENT_ORIGINS: 'https://rivalrush.vercel.app',
};

describe('loadConfig', () => {
  it('has safe development defaults', () => {
    const c = loadConfig({});
    expect(c.isProduction).toBe(false);
    expect(c.devLoginEnabled).toBe(false);
    expect(c.disconnectGraceMs).toBe(60_000);
    expect(c.authMaxAgeSeconds).toBe(3600);
  });

  it('accepts a complete production config', () => {
    const c = loadConfig(prod);
    expect(c.clientOrigins).toEqual(['https://rivalrush.vercel.app']);
  });

  it('refuses to start in production with dev login enabled', () => {
    expect(() => loadConfig({ ...prod, DEV_LOGIN_ENABLED: 'true' })).toThrow(/DEV_LOGIN_ENABLED/);
  });

  it.each([
    ['missing bot token', { BOT_TOKEN: undefined }, /BOT_TOKEN/],
    ['weak jwt secret', { JWT_SECRET: 'short' }, /JWT_SECRET/],
    ['missing database', { MONGODB_URI: undefined }, /MONGODB_URI/],
    ['wildcard CORS', { CLIENT_ORIGINS: '*' }, /CLIENT_ORIGINS/],
    ['http origin', { CLIENT_ORIGINS: 'http://rivalrush.app' }, /CLIENT_ORIGINS/],
  ])('refuses production with %s', (_name, over, pattern) => {
    expect(() => loadConfig({ ...prod, ...over })).toThrow(pattern);
  });

  it('reports invalid values as a ConfigError', () => {
    expect(() => loadConfig({ PORT: 'abc' })).toThrow(ConfigError);
  });
});
