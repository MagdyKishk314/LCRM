import { notFound } from 'next/navigation';
import { Sidebar } from '@/components/shell/sidebar';
import { Topbar } from '@/components/shell/topbar';
import { SessionProvider } from '@/lib/session';
import { getSession } from '@/lib/api/server';
import { ApiError } from '@/lib/api/client';

/**
 * Account shell.
 *
 * The session — identity, switchable accounts, resolved module set and effective
 * permissions — is fetched once server-side and handed to the client tree. Everything
 * below renders from it, so switching sub-accounts rebuilds the whole shell.
 */
export default async function AccountLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ accountId: string }>;
}) {
  const { accountId } = await params;

  let session;
  try {
    session = await getSession(accountId);
  } catch (err) {
    // A sub-account the user has no membership for is indistinguishable from one that
    // does not exist, and should stay that way — a 403 here would confirm it exists.
    if (err instanceof ApiError && (err.isForbidden || err.status === 404)) notFound();
    throw err;
  }

  if (!session.activeAccount) notFound();

  return (
    <SessionProvider session={session}>
      <div className="flex h-screen overflow-hidden bg-canvas">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar />
          <main className="flex-1 overflow-y-auto scrollbar-thin">{children}</main>
        </div>
      </div>
    </SessionProvider>
  );
}
