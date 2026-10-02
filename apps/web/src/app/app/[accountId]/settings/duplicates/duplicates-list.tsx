'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertCircle, GitMerge } from 'lucide-react';
import { CONTACT_STATUS_LABEL, formatPhone } from '@landcaller/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { mergeContacts } from '@/lib/actions/contacts';
import { formatDate } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { DuplicateGroup } from './page';

export function DuplicatesList({ accountId, groups, canMerge }: { accountId: string; groups: DuplicateGroup[]; canMerge: boolean }) {
  const router = useRouter();
  const timeZone = useSession().activeAccount?.timezone;
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  /** Keep `survivorId`, fold every other contact in the group into it. */
  function mergeGroup(group: DuplicateGroup, survivorId: string) {
    const others = group.contacts.filter((c) => c.id !== survivorId);
    const survivor = group.contacts.find((c) => c.id === survivorId)!;
    if (!window.confirm(`Merge ${others.length} contact${others.length === 1 ? '' : 's'} into ${survivor.firstName} ${survivor.lastName}? The others are deleted; nothing known about them is lost.`)) return;

    setError(null);
    startTransition(async () => {
      for (const other of others) {
        const res = await mergeContacts(accountId, survivorId, other.id, []);
        if (!res.ok) {
          setError(res.error);
          break;
        }
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger/25 bg-danger-subtle px-3 py-2.5">
          <AlertCircle size={15} className="mt-0.5 shrink-0 text-danger" />
          <p className="text-[13px] text-danger">{error}</p>
        </div>
      )}

      {groups.length === 0 && (
        <div className="rounded-card border border-border bg-surface px-4 py-14 text-center">
          <p className="text-sm font-medium text-fg">No duplicates found</p>
          <p className="mt-1 text-[13px] text-fg-muted">No two contacts share a phone number or an email address.</p>
        </div>
      )}

      {groups.map((g) => (
        <div key={`${g.by}-${g.value}`} className="rounded-card border border-border bg-surface">
          <div className="flex items-center justify-between border-b border-border px-4 py-2">
            <p className="text-[12px] text-fg-muted">
              Same {g.by}: <span className="tabular font-medium text-fg">{g.by === 'phone' ? formatPhone(g.value) : g.value}</span>
            </p>
            <span className="text-[12px] text-fg-subtle">{g.contacts.length} contacts</span>
          </div>
          <div className="divide-y divide-border">
            {g.contacts.map((c) => (
              <div key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-[13px]">
                <div className="min-w-0 flex-1">
                  <Link href={`/app/${accountId}/contacts/${c.id}`} className="font-medium text-fg hover:text-brand-text hover:underline">
                    {c.firstName} {c.lastName}
                  </Link>
                  <p className="text-[12px] text-fg-subtle">
                    {[c.phone ? formatPhone(c.phone) : null, c.email, c.property?.apn ? `APN ${c.property.apn}` : null].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <Badge>{CONTACT_STATUS_LABEL[c.status]}</Badge>
                <span className="text-[12px] text-fg-subtle">created {formatDate(c.createdAt, timeZone)}</span>
                <span className="text-[12px] text-fg-subtle">active {formatDate(c.lastActivityAt, timeZone)}</span>
                {canMerge && (
                  <Button variant="outline" size="sm" disabled={pending} onClick={() => mergeGroup(g, c.id)} title="Keep this one; merge the others into it">
                    <GitMerge size={13} /> Keep this one
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
