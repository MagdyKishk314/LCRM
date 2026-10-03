/**
 * Upload and import limits, defined once.
 *
 * A CSV import crosses four boundaries that each impose their own cap: the browser check,
 * Next's server-action body limit, Express's JSON body limit, and the row cap in the import
 * handler. They disagreed — the browser allowed 20 MB, Next allowed 1 MB, Express allowed
 * 25 MB, and the handler allowed 20,000 rows — so the real limit was whichever boundary a
 * given file hit first, and the error came from Next with no way for the app to explain it.
 *
 * Anything that enforces a limit reads it from here. `limits.test.ts` fails the build if
 * `next.config.ts` drifts from these values, because that one cannot import them.
 */

/** The largest file a user may import. */
export const IMPORT_MAX_FILE_BYTES = 50 * 1024 * 1024;

/**
 * The largest request body the transports accept.
 *
 * Deliberately above `IMPORT_MAX_FILE_BYTES`: the CSV travels as a JSON string, and quote
 * and newline escaping plus the React Server Component encoding inflate it past the file's
 * own size. Sizing this to exactly 50 MB would reject 50 MB files at the transport with a
 * framework error rather than at the app with an explanation.
 */
export const REQUEST_BODY_LIMIT_BYTES = 72 * 1024 * 1024;

/** The same value in the string form Express and Next expect. */
export const REQUEST_BODY_LIMIT = '72mb';

/**
 * Rows per import.
 *
 * This used to be 100,000, sized so a single request finished before a proxy gave up. That
 * constraint is gone: the browser parses the file and uploads it a chunk at a time, so no
 * one request grows with the file. Measured, a 2,000-row chunk takes 4.5s and 226 KB —
 * against a 60s function budget and a ~4.5 MB body cap.
 *
 * What limits it now is the browser: parsing a 50 MB CSV into arrays costs a few hundred
 * megabytes of heap, and this is roughly what fits comfortably. It is deliberately above
 * what `IMPORT_MAX_FILE_BYTES` can hold (~330,000 rows of land-owner data), so the file
 * size stays the limit a user actually meets.
 */
export const IMPORT_MAX_ROWS = 400_000;

/**
 * How long an import may hold a request open, in milliseconds.
 *
 * Only reachable when self-hosting, and now far more headroom than any single chunk needs.
 * A reverse proxy in front of the API wants a matching read timeout; nginx defaults to 60s,
 * which a chunk comfortably fits inside.
 */
export const IMPORT_REQUEST_TIMEOUT_MS = 15 * 60 * 1000;

/**
 * Rows resolved and written per round trip.
 *
 * Measured against Atlas from this VPS: at 500 rows an insert costs 1.95ms/row, at 2,000 it
 * costs 0.86ms/row. Round-trip latency (~140ms) dominates, so fewer, larger trips win.
 */
export const IMPORT_BATCH_SIZE = 2_000;

/**
 * Rows the browser sends per request when importing.
 *
 * Sized so a request stays far inside the two limits a serverless platform imposes: the
 * body cap (Vercel allows about 4.5 MB; 2,000 land-owner rows as JSON is roughly 500 KB)
 * and the duration cap (at the measured 1.64 ms/row for new contacts, a chunk is a few
 * seconds). Parsing happens in the browser, so the file itself is never uploaded whole.
 */
export const IMPORT_CHUNK_ROWS = 2_000;

// ── Quota ───────────────────────────────────────────────────────────────────

/**
 * How much import data one sub-account may send per hour.
 *
 * A cap on bytes rather than requests: the cost and the risk here are both about volume,
 * and ten 10 MB files are the same load as one 100 MB file. Enforced per sub-account so a
 * single tenant cannot spend the agency's headroom.
 */
export const IMPORT_QUOTA_BYTES = 100 * 1024 * 1024;

/** The window the quota is measured over. Sliding, not calendar-aligned. */
export const IMPORT_QUOTA_WINDOW_MS = 60 * 60 * 1000;

/** Human-readable megabytes, for messages the user reads. */
export function formatBytes(bytes: number): string {
  const mb = bytes / 1024 / 1024;
  if (mb >= 10 || Number.isInteger(mb)) return `${Math.round(mb)} MB`;
  return `${mb.toFixed(1)} MB`;
}
