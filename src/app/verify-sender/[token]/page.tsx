import { Signal } from 'lucide-react';
import { ConfirmSender } from './confirm-sender';

/**
 * Where the link in a "confirm this sending address" email lands.
 *
 * Outside the authenticated area, like an invite: the person opening it is proving they
 * read that mailbox, not that they have a CRM login.
 *
 * Nothing is confirmed by loading the page. Mail scanners and link previews fetch every URL
 * in a message, and an address that verified itself on a GET would be "confirmed" by a spam
 * filter. It takes a click.
 */
export default async function VerifySenderPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-7 flex flex-col items-center text-center">
          <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-brand">
            <Signal size={22} className="text-brand-fg" />
          </div>
          <h1 className="font-display text-[26px] leading-tight text-fg">Confirm this address</h1>
          <p className="mt-1 text-sm text-fg-muted">LandCaller</p>
        </div>

        <ConfirmSender token={token} />
      </div>
    </main>
  );
}
