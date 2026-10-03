import { ApiError } from './client';

/** Result shape returned by every server action, so forms can render errors inline. */
export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string; details?: unknown };

/**
 * Run a server action body and convert any thrown API error into a displayable result.
 *
 * Server actions cannot throw arbitrary errors to the client without Next replacing the
 * message in production, so failures are returned as values instead.
 */
export async function action<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    if (err instanceof ApiError) {
      return { ok: false, error: err.message, details: err.details };
    }
    // `redirect()` throws a control-flow signal that must propagate, not be swallowed.
    if (isRedirect(err)) throw err;

    console.error('[action] unexpected error:', err);
    return { ok: false, error: 'Something went wrong. Please try again.' };
  }
}

function isRedirect(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'digest' in err &&
    typeof (err as { digest?: unknown }).digest === 'string' &&
    (err as { digest: string }).digest.startsWith('NEXT_REDIRECT')
  );
}
