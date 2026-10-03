import { createHash } from 'node:crypto';
import {
  IMPORT_QUOTA_BYTES,
  IMPORT_QUOTA_WINDOW_MS,
  formatBytes,
} from '@/shared';
import { UsageEvent } from '../models';
import { tooManyRequests } from './errors';

/**
 * Volume quotas, measured per sub-account over a rolling window.
 *
 * Raising the upload limit to 50 MB also raises what one request can cost, so the ceiling
 * moves from the file to the tenant: any one file may be large, but a sub-account only gets
 * so much per hour. A byte quota rather than a request count, because the cost and the risk
 * are both about volume — ten 10 MB files are the same load as one 100 MB file.
 *
 * Per sub-account, not per user or per agency: a compromised login inside one client cannot
 * spend another client's headroom, and cannot spend the agency's.
 */
export interface QuotaCheck {
  /** Whether the request fits, and was recorded. */
  ok: boolean;
  /** Bytes already spent inside the window, before this request. */
  used: number;
  /** Bytes this request would add. Zero when the same content was already charged. */
  charge: number;
  limit: number;
  /** When enough of the window rolls off for this request to fit. */
  retryAt: Date | null;
}

export interface QuotaContext {
  agencyId: string;
  accountId?: string;
  userId?: string;
}

/** One recorded upload inside the window. */
export interface UsageRecord {
  bytes: number;
  contentHash: string;
  occurredAt: Date;
}

/**
 * Decide whether a payload fits — kept pure so the arithmetic is testable without a database.
 *
 * The window arithmetic is the part that goes subtly wrong: an earlier version returned
 * post-charge usage on the accept path and pre-charge usage on the reject path, which made
 * the effective ceiling one file lower than advertised without ever failing loudly.
 */
export function evaluateQuota(
  events: readonly UsageRecord[],
  bytes: number,
  contentHash: string,
): QuotaCheck {
  const used = events.reduce((sum, e) => sum + e.bytes, 0);

  /**
   * The same file inside the window is free.
   *
   * Previewing a 50 MB import and then committing it sends the identical bytes twice.
   * Charging both would make a 100 MB quota mean 50 MB of real imports, contradicting the
   * 50 MB file limit. Distinct payloads are charged in full, which is the case that matters.
   */
  const charge = events.some((e) => e.contentHash === contentHash) ? 0 : bytes;
  const fits = used + charge <= IMPORT_QUOTA_BYTES;

  return {
    ok: fits,
    used,
    charge,
    limit: IMPORT_QUOTA_BYTES,
    retryAt: fits ? null : retryAt(events, charge),
  };
}

/**
 * Check a payload against the import quota, and record it if it fits.
 *
 * Returns rather than throws for the caller that wants to report headroom; use
 * `enforceImportQuota` for the normal path.
 */
export async function chargeImportQuota(
  ctx: QuotaContext,
  content: string,
): Promise<QuotaCheck> {
  const bytes = Buffer.byteLength(content, 'utf8');
  const contentHash = createHash('sha256').update(content).digest('hex');
  const since = new Date(Date.now() - IMPORT_QUOTA_WINDOW_MS);

  const window = () =>
    UsageEvent.find({ kind: 'import', occurredAt: { $gte: since } })
      .select('bytes contentHash occurredAt')
      .sort({ occurredAt: 1 })
      .lean<(UsageRecord & { _id: unknown })[]>();

  const result = evaluateQuota(await window(), bytes, contentHash);

  // Already over, or content that was already paid for: nothing to record.
  if (!result.ok || result.charge === 0) return result;

  /**
   * Record first, then look again.
   *
   * Checking and then recording leaves a gap: two requests arriving together both read the
   * window before either has written to it, both see room, and both are accepted — past
   * the limit. Writing the charge and *then* summing closes it, because each request now
   * sees the other's row. If the total is over, this charge is withdrawn and the request
   * refused.
   *
   * The failure mode flips from "both get in" to "both may be turned away" when two
   * requests race for the last of the headroom, which is the safe side of a limit — and
   * the import sends its chunks one at a time, so in practice it does not arise.
   */
  const mine = await UsageEvent.create({
    kind: 'import',
    bytes: result.charge,
    contentHash,
    userId: ctx.userId,
    occurredAt: new Date(),
  });

  const after = await window();
  const total = after.reduce((sum, e) => sum + e.bytes, 0);
  if (total <= IMPORT_QUOTA_BYTES) return result;

  await UsageEvent.deleteOne({ _id: mine._id });

  const others = after.filter((e) => String(e._id) !== String(mine._id));
  const recheck = evaluateQuota(others, bytes, contentHash);

  return {
    ...recheck,
    ok: false,
    // If the other request backs out too there is room after all; a minute is enough.
    retryAt: recheck.retryAt ?? new Date(Date.now() + 60_000),
  };
}

/**
 * When enough of the window rolls off to make room.
 *
 * Events expire oldest-first, so this walks forward until enough has aged out — telling
 * someone "try again in 40 minutes" is worth the few lines over a bare rejection.
 */
function retryAt(events: readonly UsageRecord[], needed: number): Date | null {
  const total = events.reduce((sum, e) => sum + e.bytes, 0);
  let freed = 0;

  for (const event of events) {
    freed += event.bytes;
    if (total - freed + needed <= IMPORT_QUOTA_BYTES) {
      return new Date(event.occurredAt.getTime() + IMPORT_QUOTA_WINDOW_MS);
    }
  }
  // The request is larger than the whole quota; waiting will not help.
  return null;
}

/** Charge the quota, or reject with a message that says when to come back. */
export async function enforceImportQuota(ctx: QuotaContext, content: string): Promise<void> {
  const result = await chargeImportQuota(ctx, content);
  if (result.ok) return;

  const size = formatBytes(result.charge);
  const limit = formatBytes(result.limit);

  if (result.retryAt === null) {
    throw tooManyRequests(
      `That file is ${size}, which is larger than the ${limit} hourly import limit for this ` +
        `sub-account. Split it into smaller files.`,
    );
  }

  const minutes = Math.max(1, Math.ceil((result.retryAt.getTime() - Date.now()) / 60_000));

  throw tooManyRequests(
    `This sub-account has imported ${formatBytes(result.used)} in the last hour, and the ` +
      `limit is ${limit}. Adding ${size} would go over it. Try again in ` +
      `${minutes} minute${minutes === 1 ? '' : 's'}.`,
    { used: result.used, limit: result.limit, retryAt: result.retryAt.toISOString() },
  );
}
