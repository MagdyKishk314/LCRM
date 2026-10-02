'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ListFilter, Plus, X } from 'lucide-react';
import type { ContactDetail, ContactList } from '@landcaller/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Select } from '@/components/ui/input';
import { setContactListMembership } from '@/lib/actions/contacts';

/**
 * CNT-26 — which lists this contact is in: static ones by membership, smart ones by
 * currently matching their conditions. Only static membership can be changed here.
 */
export function ListsCard({
  accountId,
  contact,
  lists,
  canEdit,
}: {
  accountId: string;
  contact: ContactDetail;
  lists: ContactList[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  const inIds = new Set(contact.lists.map((l) => l.id));
  const addable = lists.filter((l) => l.type === 'static' && !inIds.has(l.id));

  function change(listId: string, member: boolean) {
    setError(null);
    startTransition(async () => {
      const res = await setContactListMembership(accountId, contact.id, listId, member);
      if (res.ok) router.refresh();
      else setError(res.error);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Lists</CardTitle>
      </CardHeader>
      <CardBody className="space-y-2">
        {error && <p className="text-[12px] text-danger">{error}</p>}
        {contact.lists.length === 0 && <p className="text-[13px] text-fg-subtle">Not in any list.</p>}
        {contact.lists.map((l) => (
          <div key={l.id} className="flex items-center justify-between gap-2">
            <Link href={`/app/${accountId}/contacts?listId=${l.id}`} className="truncate text-[13px] text-fg hover:text-brand-text hover:underline">
              {l.name}
            </Link>
            <div className="flex items-center gap-1.5">
              <Badge tone={l.type === 'smart' ? 'brand' : 'neutral'}>
                {l.type === 'smart' ? (
                  <>
                    <ListFilter size={10} /> Smart
                  </>
                ) : (
                  'Static'
                )}
              </Badge>
              {canEdit && l.type === 'static' && (
                <button onClick={() => change(l.id, false)} disabled={pending} aria-label={`Remove from ${l.name}`} className="text-fg-subtle hover:text-danger">
                  <X size={13} />
                </button>
              )}
            </div>
          </div>
        ))}
        {canEdit && addable.length > 0 && (
          <Select
            defaultValue=""
            disabled={pending}
            aria-label="Add to list"
            className="mt-1 h-8 text-[13px]"
            onChange={(e) => {
              if (e.target.value) change(e.target.value, true);
              e.target.value = '';
            }}
          >
            <option value="">
              <Plus size={12} /> Add to list…
            </option>
            {addable.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        )}
        {canEdit && addable.length === 0 && lists.every((l) => l.type !== 'static') && (
          <Button variant="ghost" size="sm" disabled title="Create a static list first">
            <Plus size={13} /> Add to list
          </Button>
        )}
      </CardBody>
    </Card>
  );
}
