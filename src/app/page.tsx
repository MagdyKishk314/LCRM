import { redirect } from 'next/navigation';
import type { SessionContext } from '@/shared';
import { SignOutLink } from '@/components/ui/sign-out-link';
import { apiGet } from '@/lib/api/server';

/**
 * Entry point — land people where their job starts.
 *
 * Three cases, in order:
 *
 *   many   One email holding several memberships (agency staff plus a seat in a client's
 *          sub-account, say) is asked to choose. Those are different jobs with different
 *          data, and guessing a default lands half the logins in the wrong place.
 *   one    Straight in. An agency operator's single destination is the console that spans
 *          every client, not whichever sub-account sorts first.
 *   none   An identity with no membership — a real state worth saying out loud rather
 *          than bouncing around a redirect loop.
 */
export default async function Home() {
  const session = await apiGet<SessionContext>('/core/auth/session');
  const { destinations } = session;

  if (destinations.length > 1) redirect('/choose');
  if (destinations.length === 1) redirect(destinations[0]!.href);

  return <NoAccess email={session.user.email} />;
}

function NoAccess({ email }: { email: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <div className="max-w-md text-center">
        <h1 className="font-display text-xl text-fg">No access yet</h1>
        <p className="mt-2 text-sm text-fg-muted">
          {email} is signed in but has not been given access to a sub-account or an agency.
          An agency admin can invite you from the agency console.
        </p>
        <SignOutLink className="mt-4 inline-block text-sm font-medium text-brand-text hover:underline" />
      </div>
    </main>
  );
}
