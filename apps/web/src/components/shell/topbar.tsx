'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Bell, LogOut, Repeat, Settings, UserCircle } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useSession } from '@/lib/session';
import { Badge } from '@/components/ui/badge';
import { switchContext } from '@/lib/actions/context';
import { GlobalSearch } from './global-search';

export function Topbar() {
  const { user, activeAccount, scope, hasAgencyAccess, activeContext, destinations } = useSession();

  // Offered only when the user is actually operating as agency staff. Someone who chose
  // to enter as a sub-account member should not be shown a door they declined.
  const showAgencyLink = hasAgencyAccess && activeContext === 'agency';
  const router = useRouter();
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [signingOut, setSigningOut] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menuOpen]);

  async function signOut() {
    setSigningOut(true);
    await fetch('/api/session/logout', { method: 'POST' });
    router.replace('/login');
    router.refresh();
  }

  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-border bg-surface px-5">
      <GlobalSearch />

      <div className="ml-auto flex items-center gap-2">
        {activeAccount?.status === 'paused' && <Badge tone="warning">Sub-account paused</Badge>}
        {scope === 'agency' && <Badge tone="brand">Agency access</Badge>}
        {scope === 'platform' && <Badge tone="brand">Platform access</Badge>}

        <button
          className="relative flex h-8 w-8 items-center justify-center rounded-lg text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
          aria-label="Notifications"
        >
          <Bell size={16} />
        </button>

        <div ref={ref} className="relative">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            className="flex h-8 items-center gap-2 rounded-lg pl-1 pr-2 transition-colors hover:bg-surface-2"
          >
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-fg text-[10px] font-bold text-canvas">
              {user.firstName[0]}
              {user.lastName[0]}
            </span>
            <span className="text-[13px] font-medium text-fg">{user.firstName}</span>
          </button>

          {menuOpen && (
            <div
              role="menu"
              className="absolute right-0 top-full z-50 mt-1.5 w-56 overflow-hidden rounded-lg border border-border bg-surface py-1 shadow-lg"
            >
              <div className="border-b border-border px-3 py-2">
                <p className="truncate text-[13px] font-semibold text-fg">
                  {user.firstName} {user.lastName}
                </p>
                <p className="truncate text-[11px] text-fg-subtle">{user.email}</p>
              </div>

              <MenuLink
                href={`/app/${activeAccount?.id}/settings`}
                icon={<Settings size={14} />}
                onNavigate={() => setMenuOpen(false)}
              >
                Sub-account settings
              </MenuLink>
              {showAgencyLink && (
                <MenuLink
                  href="/agency"
                  icon={<UserCircle size={14} />}
                  onNavigate={() => setMenuOpen(false)}
                >
                  Agency console
                </MenuLink>
              )}

              {destinations.length > 1 && (
                <form action={switchContext}>
                  <button
                    type="submit"
                    role="menuitem"
                    className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[13px] text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
                  >
                    <Repeat size={14} />
                    Switch account
                  </button>
                </form>
              )}

              <div className="my-1 border-t border-border" />

              <button
                role="menuitem"
                onClick={signOut}
                disabled={signingOut}
                className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[13px] text-danger transition-colors hover:bg-surface-2 disabled:opacity-60"
              >
                <LogOut size={14} />
                {signingOut ? 'Signing out…' : 'Sign out'}
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

function MenuLink({
  href,
  icon,
  children,
  onNavigate,
}: {
  href: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  onNavigate: () => void;
}) {
  return (
    <Link
      href={href}
      role="menuitem"
      onClick={onNavigate}
      className={cn(
        'flex items-center gap-2.5 px-3 py-1.5 text-[13px] text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg',
      )}
    >
      {icon}
      {children}
    </Link>
  );
}
