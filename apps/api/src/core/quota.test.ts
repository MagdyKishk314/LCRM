import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { IMPORT_QUOTA_BYTES, IMPORT_QUOTA_WINDOW_MS } from '@landcaller/shared';
import { evaluateQuota, type UsageRecord } from './quota';

const MB = 1024 * 1024;

/** Usage rows oldest-first, the order the real query returns them in. */
function history(...entries: [minutesAgo: number, mb: number, hash?: string][]): UsageRecord[] {
  return entries
    .map(([minutesAgo, mb, hash]) => ({
      bytes: mb * MB,
      contentHash: hash ?? `hash-${minutesAgo}-${mb}`,
      occurredAt: new Date(Date.now() - minutesAgo * 60_000),
    }))
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
}

test('an empty window accepts a file', () => {
  const result = evaluateQuota([], 50 * MB, 'a');
  assert.equal(result.ok, true);
  assert.equal(result.used, 0);
  assert.equal(result.charge, 50 * MB);
  assert.equal(result.retryAt, null);
});

test('a file that exactly fills the remaining allowance is accepted', () => {
  // The boundary an earlier version got wrong: it compared post-charge usage against the
  // limit a second time, so the last file that should fit was refused.
  const result = evaluateQuota(history([10, 50]), 50 * MB, 'new');
  assert.equal(result.ok, true, 'a file filling the exact remainder must be accepted');
  assert.equal(result.used, 50 * MB, 'used reports the window before this request');
});

test('one byte past the allowance is refused', () => {
  const result = evaluateQuota(history([10, 50]), 50 * MB + 1, 'new');
  assert.equal(result.ok, false);
  assert.ok(result.retryAt instanceof Date);
});

test('used means the same thing whether the request fits or not', () => {
  const past = history([10, 40]);
  const accepted = evaluateQuota(past, 10 * MB, 'x');
  const refused = evaluateQuota(past, 90 * MB, 'y');

  assert.equal(accepted.ok, true);
  assert.equal(refused.ok, false);
  assert.equal(accepted.used, refused.used, 'used must not change meaning between paths');
  assert.equal(accepted.used, 40 * MB);
});

test('identical content inside the window is not charged again', () => {
  // Preview then commit sends the same bytes twice; charging both would halve the quota.
  const past = history([5, 50, 'same-file']);
  const result = evaluateQuota(past, 50 * MB, 'same-file');

  assert.equal(result.ok, true);
  assert.equal(result.charge, 0, 'a repeat of charged content is free');
});

test('a repeat is free even when the window is already full', () => {
  const past = history([5, 100, 'same-file']);
  const result = evaluateQuota(past, 100 * MB, 'same-file');
  assert.equal(result.ok, true, 'committing what was already previewed must not be blocked');
});

test('different content of the same size is charged in full', () => {
  const past = history([5, 60, 'file-one']);
  const result = evaluateQuota(past, 60 * MB, 'file-two');
  assert.equal(result.ok, false);
  assert.equal(result.charge, 60 * MB);
});

test('retryAt is when enough of the window has rolled off', () => {
  // 100 MB spent 30 minutes ago; a 60 MB file needs 60 MB freed, so it waits for the
  // oldest entry to age out of the hour.
  const oldest = new Date(Date.now() - 30 * 60_000);
  const past: UsageRecord[] = [{ bytes: 100 * MB, contentHash: 'old', occurredAt: oldest }];
  const result = evaluateQuota(past, 60 * MB, 'new');

  assert.equal(result.ok, false);
  assert.equal(result.retryAt?.getTime(), oldest.getTime() + IMPORT_QUOTA_WINDOW_MS);
});

test('the earliest entry that frees enough room decides the retry time', () => {
  const past = history([50, 30], [40, 30], [10, 30]);
  const result = evaluateQuota(past, 30 * MB, 'new');

  assert.equal(result.ok, false, '90 MB used, 30 MB more would exceed 100 MB');
  // Dropping the oldest 30 MB leaves 60 + 30 = 90, which fits, so waiting for it is enough.
  assert.equal(result.retryAt?.getTime(), past[0]!.occurredAt.getTime() + IMPORT_QUOTA_WINDOW_MS);
});

test('a file larger than the whole quota has no retry time', () => {
  // Waiting cannot help, so the message must say "split it" rather than "try later".
  const result = evaluateQuota([], IMPORT_QUOTA_BYTES + 1, 'huge');
  assert.equal(result.ok, false);
  assert.equal(result.retryAt, null);
});

test('the limit reported is the configured one', () => {
  assert.equal(evaluateQuota([], 1, 'a').limit, IMPORT_QUOTA_BYTES);
});
