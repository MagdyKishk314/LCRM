/**
 * Date formatting with an explicit timezone.
 *
 * Two reasons this must never fall back to the ambient zone:
 *
 * 1. **Hydration.** Client components render on the server too. `toLocaleDateString`
 *    without a `timeZone` uses whatever zone the process is in — Node's on the server,
 *    the browser's on the client. For a timestamp near midnight those disagree, and React
 *    reports a hydration mismatch.
 *
 * 2. **Correctness.** A sub-account works one market. A Denver client's "last activity"
 *    should read in Denver time whether the server runs in UTC and whoever is looking
 *    happens to be in London.
 */

const FALLBACK_TZ = 'UTC';

export function formatDate(
  value: string | Date | undefined | null,
  timeZone: string | undefined,
  options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' },
): string {
  if (!value) return '—';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';

  return date.toLocaleDateString('en-US', { ...options, timeZone: timeZone || FALLBACK_TZ });
}

export function formatDateTime(
  value: string | Date | undefined | null,
  timeZone: string | undefined,
): string {
  if (!value) return '—';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';

  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: timeZone || FALLBACK_TZ,
  });
}
