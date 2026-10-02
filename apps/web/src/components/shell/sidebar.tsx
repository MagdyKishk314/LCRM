'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';
import type { NavSection } from '@landcaller/shared';
import { useNavigation, useSession } from '@/lib/session';
import { AccountSwitcher } from './account-switcher';
import { Icon } from './icon';

/**
 * The sidebar is generated, never hand-written: `useNavigation()` intersects the
 * account's enabled modules with the user's permissions. Turning a module off in
 * Settings removes its entries here on the next session refresh.
 */
export function Sidebar() {
  const sections = useNavigation();
  const { activeAccount } = useSession();
  const pathname = usePathname();
  const base = `/app/${activeAccount?.id ?? ''}`;

  // Resolved once for the whole sidebar: only the most specific matching link is active.
  const activeHref = React.useMemo(
    () => resolveActiveHref(pathname, collectHrefs(sections, base)),
    [pathname, sections, base],
  );

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r border-border bg-surface">
      <div className="flex h-14 items-center gap-2 border-b border-border px-4">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-brand">
          <Icon name="Signal" size={15} className="text-brand-fg" />
        </div>
        <span className="font-display text-[16px] text-fg">LandCaller</span>
      </div>

      <div className="border-b border-border p-2.5">
        <AccountSwitcher />
      </div>

      <nav className="flex-1 overflow-y-auto scrollbar-thin p-2.5">
        {sections.map((section) => (
          <div key={section.group} className="mb-4 last:mb-0">
            <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
              {section.group}
            </p>
            <ul className="space-y-0.5">
              {section.items.map((item) => (
                <NavEntry
                  key={item.href}
                  item={item}
                  base={base}
                  pathname={pathname}
                  activeHref={activeHref}
                />
              ))}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  );
}

type NavItemShape = {
  label: string;
  href: string;
  icon: string;
  children?: NavItemShape[];
};

function NavEntry({
  item,
  base,
  pathname,
  activeHref,
}: {
  item: NavItemShape;
  base: string;
  pathname: string;
  activeHref: string | null;
}) {
  const href = item.href ? `${base}/${item.href}` : base;
  const hasChildren = (item.children?.length ?? 0) > 0;

  // A parent counts as within-section if the URL sits under it, which is what
  // decides whether the group starts expanded.
  const withinSection = hasChildren
    ? pathname === href || pathname.startsWith(`${href}/`)
    : false;

  const [open, setOpen] = React.useState(withinSection);
  React.useEffect(() => {
    if (withinSection) setOpen(true);
  }, [withinSection]);

  if (!hasChildren) {
    return (
      <li>
        <Link href={href} className={entryClass(href === activeHref)}>
          <Icon name={item.icon} size={15} className="shrink-0" />
          <span className="truncate">{item.label}</span>
        </Link>
      </li>
    );
  }

  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn(entryClass(withinSection && !open), 'w-full')}
      >
        <Icon name={item.icon} size={15} className="shrink-0" />
        <span className="flex-1 truncate text-left">{item.label}</span>
        <Icon
          name="ChevronRight"
          size={13}
          className={cn('shrink-0 transition-transform', open && 'rotate-90')}
        />
      </button>

      {open && (
        <ul className="ml-[19px] mt-0.5 space-y-0.5 border-l border-border pl-2.5">
          {item.children!.map((child) => {
            const childHref = child.href ? `${base}/${child.href}` : base;
            return (
              <li key={child.href}>
                <Link
                  href={childHref}
                  className={entryClass(childHref === activeHref)}
                >
                  <span className="truncate">{child.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}

function entryClass(active: boolean) {
  return cn(
    'flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] font-medium transition-colors',
    active ? 'bg-brand-subtle text-brand-text' : 'text-fg-muted hover:bg-surface-2 hover:text-fg',
  );
}

/**
 * Resolve which single nav link the current URL belongs to.
 *
 * Matching each link independently does not work. "General" points at `settings` and
 * "Team" at `settings/team`, so on `/settings/team` a prefix test lights up both. Exact
 * matching alone is no better: it would leave nothing highlighted on `/contacts/<id>`,
 * where the reader plainly is inside Contacts.
 *
 * So candidates are collected across the whole sidebar and the **longest** matching href
 * wins — the most specific link, and only that one. This also handles Dashboard, whose
 * href is the account root and therefore prefixes every other page: any real page has a
 * longer match, and Dashboard only wins when the URL is the root exactly.
 */
function resolveActiveHref(pathname: string, hrefs: string[]): string | null {
  let best: string | null = null;

  for (const href of hrefs) {
    const matches = pathname === href || pathname.startsWith(`${href}/`);
    if (!matches) continue;
    if (best === null || href.length > best.length) best = href;
  }

  return best;
}

/** Every leaf link in the sidebar, as absolute paths. */
function collectHrefs(sections: NavSection[], base: string): string[] {
  const out: string[] = [];

  const walk = (items: NavItemShape[]) => {
    for (const item of items) {
      if (item.children?.length) walk(item.children);
      else out.push(item.href ? `${base}/${item.href}` : base);
    }
  };

  sections.forEach((s) => walk(s.items as NavItemShape[]));
  return out;
}
