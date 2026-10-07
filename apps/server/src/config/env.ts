import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0', ''])
  .optional()
  .transform((v) => v === 'true' || v === '1');

/** Trims whitespace and surrounding quotes pasted into dashboards; empty means unset. */
function cleanEnvValue(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  const t = v
    .trim()
    .replace(/^(["'])(.*)\1$/, '$2')
    .trim();
  return t === '' ? undefined : t;
}

/** A public web address (not a secret), so the error may echo what was received. */
const webUrl = z.preprocess(
  cleanEnvValue,
  z
    .string()
    .superRefine((v, ctx) => {
      if (!/^https?:\/\/[^\s/]+/.test(v) || !URL.canParse(v)) {
        ctx.addIssue({
          code: 'custom',
          message: `must be a full address starting with https://, e.g. https://rivalrush.vercel.app (got "${v}")`,
        });
      }
    })
    .optional(),
);

/**
 * Dev/test only (docs/defuser.md, spec section 18): a 128-bit seed that makes every Defuser game
 * predictable, so a browser E2E can know the answers. A secret-like value: never echoed or logged.
 */
const fixedSeed = z.preprocess(
  cleanEnvValue,
  z
    .string()
    .regex(/^[0-9a-f]{32}$/, 'must be 32 lowercase hex characters')
    .optional(),
);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /**
   * Which deployment this is, when NODE_ENV=production: the live service (default) or staging.
   * Staging keeps every production check and only adds Defuser for Telegram QA (docs/deployment.md).
   */
  DEPLOY_ENV: z.preprocess(cleanEnvValue, z.enum(['production', 'staging']).optional()),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** Number of reverse proxies in front of the server (Render = 1). */
  TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(0),

  MONGODB_URI: z.string().optional(),
  MONGODB_DB_NAME: z.string().optional(),

  BOT_TOKEN: z.string().optional(),
  BOT_USERNAME: z.string().optional(),
  /** off | polling (local dev) | webhook (hosted; wakes a sleeping free-tier server). */
  BOT_MODE: z.enum(['off', 'polling', 'webhook']).optional(),
  /** Legacy switch: BOT_POLLING=true means BOT_MODE=polling when BOT_MODE is unset. */
  BOT_POLLING: bool,
  WEBAPP_URL: webUrl,
  /** This server's public https URL (webhook target). Render sets RENDER_EXTERNAL_URL. */
  PUBLIC_URL: webUrl,
  RENDER_EXTERNAL_URL: webUrl,

  JWT_SECRET: z.string().optional(),
  JWT_TTL_SECONDS: z.coerce
    .number()
    .int()
    .min(300)
    .default(7 * 24 * 3600),
  /** Telegram launch data older than this is rejected. */
  AUTH_MAX_AGE_SECONDS: z.coerce.number().int().min(60).max(86_400).default(3600),

  CLIENT_ORIGINS: z.string().default('http://localhost:5173'),
  DEV_LOGIN_ENABLED: bool,
  /** Register the Defuser plug-in: dev/test, or staging (DEPLOY_ENV=staging). Never live. */
  DEFUSER_ENABLED: bool,
  DEFUSER_FIXED_SEED: fixedSeed,

  DISCONNECT_GRACE_SECONDS: z.coerce.number().int().min(10).max(600).default(60),
  ROOM_TTL_MINUTES: z.coerce
    .number()
    .int()
    .min(5)
    .max(24 * 60)
    .default(120),
});

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  /** NODE_ENV=production: every production check applies (also on staging). */
  isProduction: boolean;
  /** A production-hardened staging deployment (DEPLOY_ENV=staging), for Telegram QA. */
  isStaging: boolean;
  port: number;
  host: string;
  logLevel: string;
  trustProxy: number;
  mongoUri: string | null;
  mongoDbName: string | undefined;
  botToken: string | null;
  botUsername: string | null;
  botMode: 'off' | 'polling' | 'webhook';
  publicUrl: string | null;
  webAppUrl: string | null;
  jwtSecret: string;
  jwtTtlSeconds: number;
  authMaxAgeSeconds: number;
  clientOrigins: string[];
  devLoginEnabled: boolean;
  /** Registers the Defuser plug-in. Dev/test and staging only; refused on the live service. */
  defuserEnabled: boolean;
  /** Test only; refused in production. Never log the value. */
  defuserFixedSeed: string | null;
  disconnectGraceMs: number;
  roomTtlMs: number;
}

export class ConfigError extends Error {}

const DEV_JWT_SECRET = 'dev-only-insecure-jwt-secret-change-me-0000';

/**
 * Validates the environment. In production it refuses to start with insecure settings:
 * dev login on, a fixed Defuser seed, missing/weak secrets, wildcard CORS, or no database.
 * Defuser is refused too, except on a staging deployment (DEPLOY_ENV=staging), which must also
 * use a staging database.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new ConfigError(`Invalid environment: ${issues}`);
  }
  const e = parsed.data;
  const isProduction = e.NODE_ENV === 'production';
  if (e.DEPLOY_ENV === 'staging' && !isProduction) {
    throw new ConfigError(
      'DEPLOY_ENV=staging requires NODE_ENV=production: staging runs with every production check',
    );
  }
  const isStaging = isProduction && e.DEPLOY_ENV === 'staging';
  const botMode = e.BOT_MODE ?? (e.BOT_POLLING ? 'polling' : 'off');
  const publicUrl = (e.PUBLIC_URL ?? e.RENDER_EXTERNAL_URL ?? null)?.replace(/\/$/, '') ?? null;
  const clientOrigins = e.CLIENT_ORIGINS.split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean);

  if (isProduction) {
    const problems: string[] = [];
    if (e.DEV_LOGIN_ENABLED) problems.push('DEV_LOGIN_ENABLED must be false in production');
    if (e.DEFUSER_ENABLED && !isStaging)
      problems.push('DEFUSER_ENABLED must be false in production (allowed only on staging)');
    if (isStaging && !/staging/i.test(e.MONGODB_DB_NAME ?? ''))
      problems.push('DEPLOY_ENV=staging needs MONGODB_DB_NAME naming a staging database');
    if (e.DEFUSER_FIXED_SEED) problems.push('DEFUSER_FIXED_SEED must not be set in production');
    if (!e.BOT_TOKEN) problems.push('BOT_TOKEN is required');
    if (!e.JWT_SECRET || e.JWT_SECRET.length < 32)
      problems.push('JWT_SECRET must be at least 32 characters');
    if (e.JWT_SECRET === DEV_JWT_SECRET)
      problems.push('JWT_SECRET must not be the development default');
    if (!e.MONGODB_URI) problems.push('MONGODB_URI is required');
    if (clientOrigins.length === 0) problems.push('CLIENT_ORIGINS is required');
    for (const o of clientOrigins) {
      if (o === '*' || !o.startsWith('https://'))
        problems.push(`CLIENT_ORIGINS entry must be an exact https origin: ${o}`);
    }
    if (botMode === 'webhook' && !publicUrl?.startsWith('https://'))
      problems.push('BOT_MODE=webhook needs an https PUBLIC_URL (or RENDER_EXTERNAL_URL)');
    if (botMode !== 'off' && !e.WEBAPP_URL) problems.push('WEBAPP_URL is required for the bot');
    if (problems.length)
      throw new ConfigError(`Refusing to start in production: ${problems.join('; ')}`);
  }

  return {
    nodeEnv: e.NODE_ENV,
    isProduction,
    isStaging,
    port: e.PORT,
    host: e.HOST,
    logLevel: e.LOG_LEVEL,
    trustProxy: e.TRUST_PROXY,
    mongoUri: e.MONGODB_URI ?? null,
    mongoDbName: e.MONGODB_DB_NAME,
    botToken: e.BOT_TOKEN ?? null,
    botUsername: e.BOT_USERNAME ?? null,
    botMode,
    publicUrl,
    webAppUrl: e.WEBAPP_URL ?? null,
    jwtSecret: e.JWT_SECRET ?? DEV_JWT_SECRET,
    jwtTtlSeconds: e.JWT_TTL_SECONDS,
    authMaxAgeSeconds: e.AUTH_MAX_AGE_SECONDS,
    clientOrigins,
    devLoginEnabled: e.DEV_LOGIN_ENABLED,
    defuserEnabled: e.DEFUSER_ENABLED,
    defuserFixedSeed: e.DEFUSER_FIXED_SEED ?? null,
    disconnectGraceMs: e.DISCONNECT_GRACE_SECONDS * 1000,
    roomTtlMs: e.ROOM_TTL_MINUTES * 60_000,
  };
}
