'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';

/**
 * Tabs for one sub-account, seen from the agency console.
 *
 * Same most-specific-match rule as the sidebars: the Overview tab's href is a prefix of
 * every other tab, so matching each independently would keep Overview lit throughout.
 */
export function AccountTabs({ accountId }: { accountId: string }) {
  const pathname = usePathname();
  const base = `/agency/accounts/${accountId}`;

  const tabs = [
    { label: 'Overview', href: base },
    { label: 'Settings', href: `${base}/settings` },
    { label: 'Modules', href: `${base}/modules` },
    { label: 'Team', href: `${base}/team` },
  ];

  const activeHref = tabs
    .map((t) => t.href)
    .filter((href) => pathname === href || pathname.startsWith(`${href}/`))
    .sort((a, b) => b.length - a.length)[0];

  return (
    <nav className="-mb-px mt-4 flex gap-1 overflow-x-auto scrollbar-thin">
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          className={cn(
            'whitespace-nowrap border-b-2 px-3 py-2 text-[13px] font-medium transition-colors',
            tab.href === activeHref
              ? 'border-brand text-brand-text'
              : 'border-transparent text-fg-muted hover:text-fg',
          )}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
