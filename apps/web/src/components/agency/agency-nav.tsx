'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';
import { Icon } from '@/components/shell/icon';

const ITEMS = [
  { label: 'Overview', href: '/agency', icon: 'LayoutDashboard' },
  { label: 'Sub-accounts', href: '/agency/accounts', icon: 'Building2' },
  { label: 'People', href: '/agency/people', icon: 'Users' },
  { label: 'Audit log', href: '/agency/audit', icon: 'ScrollText' },
  { label: 'Agency settings', href: '/agency/settings', icon: 'Settings' },
];

/**
 * Agency console navigation.
 *
 * Uses the same most-specific-match rule as the sub-account sidebar: `/agency` prefixes
 * every other entry, so matching each link independently would light up Overview on every
 * page. The longest matching href wins, and only that one.
 */
export function AgencyNav() {
  const pathname = usePathname();

  const activeHref = ITEMS.map((i) => i.href)
    .filter((href) => pathname === href || pathname.startsWith(`${href}/`))
    .sort((a, b) => b.length - a.length)[0];

  return (
    <nav className="flex-1 overflow-y-auto scrollbar-thin p-2.5">
      <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
        Agency
      </p>
      <ul className="space-y-0.5">
        {ITEMS.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              className={cn(
                'flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] font-medium transition-colors',
                item.href === activeHref
                  ? 'bg-brand-subtle text-brand-text'
                  : 'text-fg-muted hover:bg-surface-2 hover:text-fg',
              )}
            >
              <Icon name={item.icon} size={15} className="shrink-0" />
              <span className="truncate">{item.label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
