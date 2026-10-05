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

  it('bot mode: webhook needs an https public URL in production; Render URL is the default', () => {
    expect(loadConfig({}).botMode).toBe('off');
    expect(loadConfig({ BOT_POLLING: 'true' }).botMode).toBe('polling');
    const withBot = { ...prod, BOT_MODE: 'webhook', WEBAPP_URL: 'https://rivalrush.vercel.app' };
    expect(() => loadConfig(withBot)).toThrow(/PUBLIC_URL/);
    const c = loadConfig({
      ...withBot,
      RENDER_EXTERNAL_URL: 'https://rivalrush-api.onrender.com/',
    });
    expect(c.publicUrl).toBe('https://rivalrush-api.onrender.com');
    expect(() => loadConfig({ ...prod, BOT_MODE: 'polling' })).toThrow(/WEBAPP_URL/);
  });

  it('URL settings: tolerates pasted spaces/quotes, treats empty as unset, explains bad values', () => {
    expect(loadConfig({ WEBAPP_URL: '  "https://rivalrush.vercel.app"  ' }).webAppUrl).toBe(
      'https://rivalrush.vercel.app',
    );
    expect(loadConfig({ WEBAPP_URL: '' }).webAppUrl).toBeNull();
    expect(() => loadConfig({ WEBAPP_URL: 'rivalrush.vercel.app' })).toThrow(
      /WEBAPP_URL: must be a full address starting with https:\/\/.*got "rivalrush.vercel.app"/,
    );
  });

  it('reports invalid values as a ConfigError', () => {
    expect(() => loadConfig({ PORT: 'abc' })).toThrow(ConfigError);
  });
});
