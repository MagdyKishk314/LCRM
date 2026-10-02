'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { openComposer } from './contact-header';

/**
 * Keyboard shortcuts for the record (CNT-28): N note, C log call, T task, A appointment,
 * E email, / search. Ignored while typing in a field, so a note that contains the letter
 * "n" does not open another composer.
 */
export function ContactShortcuts({
  accountId,
  contactId,
  canEmail,
}: {
  accountId: string;
  contactId: string;
  canEmail: boolean;
}) {
  const router = useRouter();

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return;

      switch (e.key.toLowerCase()) {
        case 'n':
          e.preventDefault();
          openComposer('note');
          break;
        case 'c':
          e.preventDefault();
          openComposer('call');
          break;
        case 't':
          e.preventDefault();
          openComposer('task');
          break;
        case 'a':
          e.preventDefault();
          openComposer('appointment');
          break;
        case 'e':
          if (canEmail) {
            e.preventDefault();
            router.push(`/app/${accountId}/email?contactId=${contactId}`);
          }
          break;
        case '/': {
          e.preventDefault();
          const search = document.querySelector<HTMLInputElement>('[data-global-search]');
          search?.focus();
          break;
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [accountId, contactId, canEmail, router]);

  return null;
}
