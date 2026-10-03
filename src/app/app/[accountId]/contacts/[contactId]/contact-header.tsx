'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, CalendarPlus, CheckSquare, GitMerge, Mail, MessageSquare, Phone, StickyNote, Trash2 } from 'lucide-react';
import { CONTACT_STATUS_LABEL, formatPhone, isUsPhone, type ContactDetail, type ContactStatus } from '@/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { deleteContact } from '@/lib/actions/contacts';
import { MergeDialog } from './merge-dialog';

const STATUS_TONE: Record<ContactStatus, 'neutral' | 'info' | 'success' | 'warning' | 'danger'> = {
  new: 'info',
  contacted: 'neutral',
  qualified: 'success',
  unqualified: 'warning',
  do_not_call: 'danger',
};

/** Ask the history panel to open one of its composers. Also what the keyboard shortcuts send. */
export function openComposer(kind: 'note' | 'call' | 'task' | 'appointment') {
  window.dispatchEvent(new CustomEvent('lc:compose', { detail: kind }));
}

/**
 * The top of the record (CNT-19): who this is, where they stand, and the things one does
 * to them most often. Call and Text are shown greyed until the telephony module exists —
 * the slot is there so the page does not change shape when it arrives.
 */
export function ContactHeader({
  accountId,
  contact,
  can,
}: {
  accountId: string;
  contact: ContactDetail;
  can: { edit: boolean; delete: boolean; email: boolean; tasks: boolean; appointments: boolean };
}) {
  const router = useRouter();
  const [merging, setMerging] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const doNotContact = contact.dnc || contact.status === 'do_not_call';

  function remove() {
    if (!window.confirm(`Delete ${contact.firstName} ${contact.lastName}? Their history, tasks and opportunities are deleted too.`)) return;
    startTransition(async () => {
      const res = await deleteContact(accountId, contact.id);
      if (res.ok) router.replace(`/app/${accountId}/contacts`);
      else window.alert(res.error);
    });
  }

  return (
    <div className="border-b border-border bg-surface px-6 pb-5 pt-5">
      <Link
        href={`/app/${accountId}/contacts`}
        className="mb-3 inline-flex items-center gap-1.5 text-[13px] text-fg-muted transition-colors hover:text-fg"
      >
        <ArrowLeft size={13} /> All contacts
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-brand text-sm font-bold text-brand-fg">
            {contact.firstName[0]}
            {contact.lastName[0]}
          </span>
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-fg">
              {contact.firstName} {contact.lastName}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <Badge tone={STATUS_TONE[contact.status]}>{CONTACT_STATUS_LABEL[contact.status]}</Badge>
              {doNotContact && <Badge tone="danger">Do not contact</Badge>}
              {contact.owner && <span className="text-[12px] text-fg-muted">owned by {contact.owner.name}</span>}
              {contact.source && <span className="text-[12px] text-fg-subtle">via {contact.source}</span>}
              {contact.phone && (
                <span className="tabular text-[12px] text-fg-muted">
                  {formatPhone(contact.phone)}
                  {!isUsPhone(contact.phone) && <span className="ml-1 text-fg-subtle">(not a US number)</span>}
                </span>
              )}
            </div>
            {contact.tags.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {contact.tags.map((t) => (
                  <Badge key={t}>{t}</Badge>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Live when telephony lands (CNT-45). Greyed, with the reason, until then. */}
          <Button variant="outline" size="sm" disabled title="Calling arrives with the telephony module">
            <Phone size={13} /> Call
          </Button>
          <Button variant="outline" size="sm" disabled title="Texting arrives with the telephony module">
            <MessageSquare size={13} /> Text
          </Button>

          {can.email && contact.email && !doNotContact && (
            <Link href={`/app/${accountId}/email?contactId=${contact.id}`}>
              <Button variant="outline" size="sm">
                <Mail size={13} /> Email
              </Button>
            </Link>
          )}
          {can.edit && (
            <>
              <Button variant="outline" size="sm" onClick={() => openComposer('call')}>
                <Phone size={13} /> Log call
              </Button>
              <Button variant="outline" size="sm" onClick={() => openComposer('note')}>
                <StickyNote size={13} /> Note
              </Button>
            </>
          )}
          {can.tasks && (
            <Button variant="outline" size="sm" onClick={() => openComposer('task')}>
              <CheckSquare size={13} /> Task
            </Button>
          )}
          {can.appointments && (
            <Button variant="outline" size="sm" onClick={() => openComposer('appointment')}>
              <CalendarPlus size={13} /> Schedule
            </Button>
          )}
          {can.delete && (
            <>
              <Button variant="ghost" size="sm" onClick={() => setMerging(true)} title="Merge a duplicate into this record">
                <GitMerge size={13} /> Merge
              </Button>
              <Button variant="ghost" size="sm" className="text-danger" onClick={remove} disabled={pending} aria-label="Delete contact">
                <Trash2 size={13} />
              </Button>
            </>
          )}
        </div>
      </div>

      {merging && <MergeDialog accountId={accountId} survivor={contact} onClose={() => setMerging(false)} />}
    </div>
  );
}
