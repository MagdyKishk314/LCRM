'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';

/**
 * Sign out from a page that has no shell around it.
 *
 * A button that POSTs, not a link: signing out revokes the session on the API, and a
 * state change reachable by GET can be triggered by any page that embeds the URL.
 */
export function SignOutLink({ className }: { className?: string }) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);

  async function signOut() {
    setPending(true);
    await fetch('/api/session/logout', { method: 'POST' });
    router.replace('/login');
    router.refresh();
  }

  return (
    <button onClick={signOut} disabled={pending} className={className}>
      {pending ? 'Signing out…' : 'Sign out'}
    </button>
  );
}
