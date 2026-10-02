import { createApp } from '@landcaller/api';
import { connectDatabase } from '@landcaller/api/db';
import { handleWithExpress } from '@/lib/api/express-adapter';

/**
 * The API, served by the web deployment.
 *
 * One Vercel project rather than two. The Express app is unchanged — same `createApp()`,
 * same routes, same middleware — it just arrives through a Next route handler instead of
 * its own listening socket. `apps/api/src/index.ts` still serves it on a VPS, and both
 * build the app from the same function, so the two deployments cannot drift.
 *
 * Same-origin has a second benefit worth the wiring: the browser and the API share a
 * domain, so there is no CORS preflight and no cross-origin cookie handling between them.
 */
export const runtime = 'nodejs';

/**
 * Every request is dynamic and none may be cached.
 *
 * A cached API response would be served to the wrong tenant — the isolation boundary is
 * per-request, resolved from the caller's token.
 */
export const dynamic = 'force-dynamic';

/** A CSV import chunk is the longest request here; measured at 4.5s, budgeted generously. */
export const maxDuration = 60;

/**
 * One app per warm instance.
 *
 * Held on `globalThis` rather than in a module variable: the platform reuses a process
 * across invocations while re-evaluating modules, and rebuilding the app on every one of
 * those is wasted work. The database connection is not cached here — `connectDatabase`
 * is idempotent and ties the connection to the Mongoose instance that owns it, which is
 * what keeps it correct when the dev server recompiles the API (see `core/db.ts`).
 */
const cache = ((globalThis as Record<string, unknown>).__landcallerApi ??= {}) as {
  app?: ReturnType<typeof createApp>;
};

/**
 * In development the app is rebuilt whenever this module is recompiled.
 *
 * `globalThis` outlives a recompile, so an app cached there kept serving the API routes as
 * they were when the dev server started — an edit to `apps/api` did nothing until a
 * restart. This variable is module-level on purpose: a fresh compile gets a fresh one.
 */
let compiledApp: ReturnType<typeof createApp> | undefined;

async function ready() {
  await connectDatabase();

  if (process.env.NODE_ENV === 'development') return (compiledApp ??= createApp());

  cache.app ??= createApp();
  return cache.app;
}

async function handle(request: Request): Promise<Response> {
  const app = await ready();
  return handleWithExpress(app, request);
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const PUT = handle;
export const DELETE = handle;
export const OPTIONS = handle;
export const HEAD = handle;
