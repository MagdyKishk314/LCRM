'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { AuthDivider, GoogleButton } from '@/components/ui/google-button';

const MIN_LENGTH = 10;

/** Set a password from an invite link, then land in the app already signed in. */
export function AcceptInvite({
  token,
  email,
  googleEnabled,
}: {
  token: string;
  email: string;
  googleEnabled: boolean;
}) {
  const router = useRouter();
  const [password, setPassword] = React.useState('');
  const [confirm, setConfirm] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  const longEnough = password.length >= MIN_LENGTH;
  const matches = confirm.length > 0 && password === confirm;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!longEnough) return setError(`Use at least ${MIN_LENGTH} characters.`);
    if (!matches) return setError('The two passwords do not match.');

    setPending(true);
    try {
      const res = await fetch('/api/session/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error ?? 'Could not set your password. Please try again.');
        setPending(false);
        return;
      }

      // Accepting signs them in, so go straight to the app rather than the login screen.
      router.replace('/');
      router.refresh();
    } catch {
      setError('Could not reach the server. Please try again.');
      setPending(false);
    }
  }

  return (
    <div className="rounded-card border border-border bg-surface p-6 shadow-sm">
      {googleEnabled && (
        <>
          {/*
            Signing in with Google settles the invite outright — it proves the address, which
            is the only thing the link exists to do — so there is no password to choose.
          */}
          <GoogleButton label="Continue with Google" />
          <AuthDivider />
        </>
      )}

      <form onSubmit={onSubmit}>
        {error && (
          <div
            role="alert"
            className="mb-4 flex items-start gap-2 rounded-lg border border-danger/25 bg-danger-subtle px-3 py-2.5"
          >
            <AlertCircle size={15} className="mt-0.5 shrink-0 text-danger" />
            <p className="text-[13px] text-danger">{error}</p>
          </div>
        )}

        <div className="mb-4">
          <Label htmlFor="i-email">Email</Label>
          {/* Shown, not editable: the invite was issued to this address. */}
          <Input id="i-email" value={email} readOnly disabled />
        </div>

        <div className="mb-4">
          <Label htmlFor="i-password">Choose a password</Label>
          <Input
            id="i-password"
            type="password"
            autoComplete="new-password"
            autoFocus
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <p
            className={`mt-1 flex items-center gap-1 text-[11px] ${
              longEnough ? 'text-success' : 'text-fg-subtle'
            }`}
          >
            {longEnough && <Check size={11} />}
            At least {MIN_LENGTH} characters
          </p>
        </div>

        <div className="mb-5">
          <Label htmlFor="i-confirm">Confirm password</Label>
          <Input
            id="i-confirm"
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
          {confirm.length > 0 && !matches && (
            <p className="mt-1 text-[11px] text-danger">These do not match.</p>
          )}
        </div>

        <Button
          type="submit"
          size="lg"
          className="w-full justify-center"
          disabled={pending || !longEnough || !matches}
        >
          {pending ? 'Setting up…' : 'Set password and continue'}
        </Button>
      </form>
    </div>
  );
}
