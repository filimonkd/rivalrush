import { readFileSync } from 'node:fs';
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

  it('refuses to start in production with DEFUSER_FIXED_SEED, without echoing it', () => {
    const seed = '0123456789abcdef0123456789abcdef';
    let message = '';
    try {
      loadConfig({ ...prod, DEFUSER_FIXED_SEED: seed });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/DEFUSER_FIXED_SEED must not be set in production/);
    expect(message).not.toContain(seed);
  });

  it('DEFUSER_ENABLED is off by default and refused in production', () => {
    expect(loadConfig({}).defuserEnabled).toBe(false);
    expect(loadConfig({ NODE_ENV: 'test', DEFUSER_ENABLED: 'true' }).defuserEnabled).toBe(true);
    expect(() => loadConfig({ ...prod, DEFUSER_ENABLED: 'true' })).toThrow(
      /DEFUSER_ENABLED must be false in production/,
    );
  });

  it('parses DEFUSER_FIXED_SEED outside production and rejects a malformed one without echoing it', () => {
    const seed = 'fedcba9876543210fedcba9876543210';
    expect(loadConfig({}).defuserFixedSeed).toBeNull();
    expect(loadConfig({ DEFUSER_FIXED_SEED: '' }).defuserFixedSeed).toBeNull();
    expect(loadConfig({ NODE_ENV: 'test', DEFUSER_FIXED_SEED: seed }).defuserFixedSeed).toBe(seed);
    const bad = 'SECRETSECRETSECRET';
    let message = '';
    try {
      loadConfig({ DEFUSER_FIXED_SEED: bad });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/DEFUSER_FIXED_SEED/);
    expect(message).not.toContain(bad);
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

describe('deployment files', () => {
  it('render.yaml never sets DEFUSER_FIXED_SEED', () => {
    const yaml = readFileSync(new URL('../../../../render.yaml', import.meta.url), 'utf8');
    expect(yaml).not.toContain('DEFUSER_FIXED_SEED');
  });
});
