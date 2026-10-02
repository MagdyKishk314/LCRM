import { existsSync } from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

/**
 * Load `.env` from the monorepo root, not the current working directory.
 *
 * `pnpm --filter` runs this app with its own package directory as cwd, so plain
 * `dotenv/config` looks in `apps/api/` and finds nothing. One `.env` at the root is
 * shared by both apps; a local `apps/api/.env` still wins if present.
 */
for (const candidate of [
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), '../../.env'),
]) {
  if (existsSync(candidate)) dotenv.config({ path: candidate });
}

/**
 * Environment is parsed once at boot and fails loudly on anything missing.
 *
 * The JWT secrets have no defaults on purpose — a fallback secret that silently ships
 * to production is worse than a container that refuses to start.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().default(4000),

  MONGODB_URI: z
    .string()
    .min(1, 'MONGODB_URI is required — paste your Atlas connection string')
    .refine((v) => v.startsWith('mongodb://') || v.startsWith('mongodb+srv://'), {
      message: 'MONGODB_URI must start with mongodb:// or mongodb+srv://',
    }),
  REDIS_URL: z.string().optional(),

  JWT_ACCESS_SECRET: z.string().min(16, 'JWT_ACCESS_SECRET must be at least 16 characters'),
  JWT_REFRESH_SECRET: z.string().min(16, 'JWT_REFRESH_SECRET must be at least 16 characters'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),

  CORS_ORIGINS: z.string().default('http://localhost:3000'),
  /** Where the web app lives, used to build invite links. */
  APP_URL: z.string().default('http://localhost:3000'),

  /**
   * Google sign-in. Optional: without a client id the provider is simply not offered, and
   * the password form works exactly as before rather than showing a button that fails.
   */
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  /** Must match a redirect URI registered in the Google Cloud console, exactly. */
  GOOGLE_REDIRECT_URI: z.string().default('http://localhost:3000/api/session/google/callback'),

  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  EMAIL_FROM_DEFAULT: z.string().default('LandCaller CRM <no-reply@landcaller.com>'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment configuration:');
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1'];

/**
 * A localhost database in production means the deploy is pointed at nothing: MongoDB is
 * not self-hosted, so there is no local mongod on the VPS. Failing at boot is far better
 * than starting up and serving an empty database that looks like data loss.
 */
if (
  parsed.data.NODE_ENV === 'production' &&
  LOCAL_HOSTS.some((h) => parsed.data.MONGODB_URI.includes(h))
) {
  console.error('MONGODB_URI points at localhost but NODE_ENV is production.');
  console.error('The database is MongoDB Atlas — set MONGODB_URI to the cluster connection string.');
  process.exit(1);
}

export const env = {
  ...parsed.data,
  corsOrigins: parsed.data.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean),
  isProd: parsed.data.NODE_ENV === 'production',
};
