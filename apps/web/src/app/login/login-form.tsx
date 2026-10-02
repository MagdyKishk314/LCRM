'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { AuthDivider, GoogleButton } from '@/components/ui/google-button';

/**
 * Why a redirect carries its reason in the query string.
 *
 * The Google flow finishes on a route handler, which can only hand the browser a URL — there
 * is no component alive to hold state across it. The API's own message is passed through
 * verbatim under `google:` so a user learns whether they were not invited, suspended, or
 * signing in with an address Google never verified.
 */
function describeError(raw: string | null): string | null {
  if (!raw) return null;
  if (raw.startsWith('google:')) return decodeURIComponent(raw.slice('google:'.length));

  switch (raw) {
    case 'cancelled':
      return 'Google sign-in was cancelled.';
    case 'expired':
      return 'That sign-in took too long. Please try again.';
    case 'state_mismatch':
      return 'That sign-in could not be verified. Please try again.';
    case 'unreachable':
      return 'Could not reach the server. Please try again.';
    case 'google_unavailable':
      return 'Google sign-in is not available right now. Use your password instead.';
    case 'google_failed':
      return 'Google sign-in did not complete. Please try again.';
    default:
      return 'Sign in failed. Please try again.';
  }
}

export function LoginForm({ googleEnabled }: { googleEnabled: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const from = params.get('from');

  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [error, setError] = React.useState<string | null>(() => describeError(params.get('error')));
  const [pending, setPending] = React.useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);

    try {
      const res = await fetch('/api/session/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error ?? 'Sign in failed. Please try again.');
        setPending(false);
        return;
      }

      // `refresh()` clears the router cache so the shell re-fetches the session with
      // the cookie that was just set, rather than rendering a stale signed-out tree.
      router.replace(from && from.startsWith('/') ? from : '/');
      router.refresh();
    } catch {
      setError('Could not reach the server. Please try again.');
      setPending(false);
    }
  }

  return (
    <div className="rounded-card border border-border bg-surface p-6 shadow-sm">
      {error && (
        <div
          role="alert"
          className="mb-4 flex items-start gap-2 rounded-lg border border-danger/25 bg-danger-subtle px-3 py-2.5"
        >
          <AlertCircle size={15} className="mt-0.5 shrink-0 text-danger" />
          <p className="text-[13px] text-danger">{error}</p>
        </div>
      )}

      {googleEnabled && (
        <>
          <GoogleButton />
          <AuthDivider />
        </>
      )}

      <form onSubmit={onSubmit}>
        <div className="mb-4">
          <Label htmlFor="email">Work email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@landcaller.com"
          />
        </div>

        <div className="mb-5">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        <Button
          type="submit"
          size="lg"
          className="w-full justify-center"
          disabled={pending || !email || !password}
        >
          {pending ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </div>
  );
}
