import { Signal } from 'lucide-react';
import { apiFetch, ApiError } from '@/lib/api/client';
import { fetchProviders } from '@/lib/api/providers';
import { AcceptInvite } from './accept-invite';

interface InvitePreview {
  email: string;
  firstName: string;
  lastName: string;
}

/**
 * Invite acceptance — where a new user sets their first password.
 *
 * Deliberately outside the authenticated area: the person opening this link has no
 * session yet, which is the entire point. The token is looked up before the form renders
 * so an expired link fails immediately rather than after they have chosen a password.
 */
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  let preview: InvitePreview | null = null;
  let error: string | null = null;

  // Unauthenticated: whoever opens an invite link has no session yet, by definition.
  const providers = await fetchProviders();

  try {
    preview = await apiFetch<InvitePreview>(`/core/auth/invite/${encodeURIComponent(token)}`);
  } catch (err) {
    error =
      err instanceof ApiError
        ? err.message
        : 'This invite link could not be checked. Please try again.';
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-7 flex flex-col items-center text-center">
          <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-brand">
            <Signal size={22} className="text-brand-fg" />
          </div>
          <h1 className="font-display text-[26px] leading-tight text-fg">
            {preview ? `Welcome, ${preview.firstName}` : 'Invite link'}
          </h1>
          <p className="mt-1 text-sm text-fg-muted">
            {preview ? 'Choose a password to finish setting up your account.' : 'LandCaller CRM'}
          </p>
        </div>

        {preview ? (
          <AcceptInvite
            token={token}
            email={preview.email}
            googleEnabled={providers.google}
          />
        ) : (
          <div className="rounded-card border border-border bg-surface p-6 text-center">
            <p className="text-[13px] text-danger">{error}</p>
            <p className="mt-3 text-[13px] text-fg-muted">
              Ask whoever invited you to send a new link — invites expire after seven days,
              and each one works only once.
            </p>
            <a
              href="/login"
              className="mt-4 inline-block text-sm font-medium text-brand-text hover:underline"
            >
              Go to sign in
            </a>
          </div>
        )}
      </div>
    </main>
  );
}
