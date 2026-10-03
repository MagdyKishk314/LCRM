'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { inviteUser } from '@/lib/actions/core';
import { inviteAgencyUser, type InviteResult } from '@/lib/actions/agency';
import type { ActionResult } from '@/lib/api/errors';
import { InviteDialog } from '@/components/ui/invite-dialog';

export interface InviteInput {
  email: string;
  firstName: string;
  lastName: string;
  roleId: string;
}

interface InviteApi {
  /** Invite into one sub-account, from that sub-account's own screens. */
  inviteToAccount: (accountId: string, input: InviteInput) => Promise<ActionResult<InviteResult>>;
  /** Invite from the agency console. Omit `accountId` for an agency-wide seat. */
  inviteFromAgency: (
    input: InviteInput & { accountId?: string },
  ) => Promise<ActionResult<InviteResult>>;
  pending: boolean;
}

const InviteContext = React.createContext<InviteApi | null>(null);

/**
 * The single owner of what happens after someone is invited.
 *
 * Every invite produces a one-time link that is the invited user's only way in until SMTP
 * exists, and showing it is not optional. Leaving that to each form meant three
 * implementations that could each forget, and one of them rendered the link inside a page
 * header's button strip where it was clipped.
 *
 * So the outcome lives here instead, mounted in the root layout:
 *
 *   - it renders above every page, so no caller's layout can squash it;
 *   - its state survives the `revalidatePath` the invite triggers, because it sits above
 *     the tree being revalidated;
 *   - a new invite surface gets the behaviour by calling `useInvite()`, with nothing to
 *     remember and nothing to copy.
 *
 * Views keep their own inline error rendering — an error belongs next to the form that
 * caused it. Only the success path is centralised.
 */
export function InviteProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [issued, setIssued] = React.useState<InviteResult | null>(null);
  const [pending, startTransition] = React.useTransition();

  const run = React.useCallback(
    (fn: () => Promise<ActionResult<InviteResult>>) =>
      new Promise<ActionResult<InviteResult>>((resolve) => {
        startTransition(async () => {
          const res = await fn();

          /**
           * A link is present only for someone who still needs a password. An existing
           * active user gaining access to another sub-account has one already, so there
           * is nothing to show and nothing to copy.
           */
          if (res.ok && res.data.inviteUrl) setIssued(res.data);
          if (res.ok) router.refresh();

          resolve(res);
        });
      }),
    [router],
  );

  const api = React.useMemo<InviteApi>(
    () => ({
      inviteToAccount: (accountId, input) => run(() => inviteUser(accountId, input)),
      inviteFromAgency: (input) => run(() => inviteAgencyUser(input)),
      pending,
    }),
    [run, pending],
  );

  return (
    <InviteContext.Provider value={api}>
      {children}
      {issued?.inviteUrl && (
        <InviteDialog
          email={issued.email}
          url={issued.inviteUrl}
          expiresAt={issued.inviteExpiresAt}
          onDismiss={() => setIssued(null)}
        />
      )}
    </InviteContext.Provider>
  );
}

/**
 * Invite someone, from anywhere.
 *
 * This is the only supported way for a view to invite a user — importing the server
 * actions directly skips showing the link, which strands the person invited.
 * `invite-surfaces.test.ts` fails the build if a view does that.
 */
export function useInvite(): InviteApi {
  const ctx = React.useContext(InviteContext);
  if (!ctx) throw new Error('useInvite must be used inside <InviteProvider>');
  return ctx;
}
