'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertCircle, Undo2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { undoImport } from '@/lib/actions/contacts';
import { formatDateTime } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { ImportJobRow } from './page';

const STATUS_TONE = { running: 'info', finished: 'success', failed: 'danger', undone: 'neutral' } as const;
const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;

export function ImportsList({ accountId, jobs, canUndo }: { accountId: string; jobs: ImportJobRow[]; canUndo: boolean }) {
  const router = useRouter();
  const timeZone = useSession().activeAccount?.timezone;
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  function undo(job: ImportJobRow) {
    if (!window.confirm(`Undo the import of ${job.fileName}? The ${job.created.toLocaleString()} contacts it created will be deleted; the ${job.updated.toLocaleString()} it updated are kept.`)) return;
    setError(null);
    startTransition(async () => {
      const res = await undoImport(accountId, job.id);
      if (res.ok) {
        setNotice(`Undone: ${res.data.deleted.toLocaleString()} contacts deleted, ${res.data.kept.toLocaleString()} kept.`);
        router.refresh();
      } else {
        setError(res.error);
      }
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
      {notice && <p className="text-[13px] text-success">{notice}</p>}

      {jobs.length === 0 && (
        <div className="rounded-card border border-border bg-surface px-4 py-14 text-center">
          <p className="text-sm font-medium text-fg">No imports yet</p>
          <Link href={`/app/${accountId}/contacts/import`} className="mt-1 inline-block text-[13px] text-brand-text hover:underline">
            Import a file
          </Link>
        </div>
      )}

      {jobs.length > 0 && (
        <div className="overflow-hidden rounded-card border border-border bg-surface">
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-border bg-surface-2">
              <tr className="text-[11px] uppercase tracking-wide text-fg-subtle">
                <th className="px-4 py-2 font-medium">File</th>
                <th className="px-3 py-2 font-medium">When</th>
                <th className="px-3 py-2 font-medium">By</th>
                <th className="px-3 py-2 text-right font-medium">Rows</th>
                <th className="px-3 py-2 text-right font-medium">Created</th>
                <th className="px-3 py-2 text-right font-medium">Updated</th>
                <th className="px-3 py-2 text-right font-medium">Skipped</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => {
                const undoable = canUndo && j.status === 'finished' && j.created > 0 && Date.now() - new Date(j.startedAt).getTime() < THIRTY_DAYS;
                return (
                  <tr key={j.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-2">
                      <p className="font-medium text-fg">{j.fileName}</p>
                      <p className="text-[11px] text-fg-subtle">
                        {j.strategy === 'update' ? 'matches updated' : j.strategy === 'skip' ? 'matches skipped' : 'duplicates allowed'}
                        {j.tag && ` · tagged ${j.tag}`}
                      </p>
                    </td>
                    <td className="px-3 py-2 text-fg-muted">{formatDateTime(j.startedAt, timeZone)}</td>
                    <td className="px-3 py-2 text-fg-muted">{j.userName ?? '—'}</td>
                    <td className="tabular px-3 py-2 text-right text-fg-muted">{j.totalRows.toLocaleString()}</td>
                    <td className="tabular px-3 py-2 text-right text-fg">{j.created.toLocaleString()}</td>
                    <td className="tabular px-3 py-2 text-right text-fg">{j.updated.toLocaleString()}</td>
                    <td className="tabular px-3 py-2 text-right text-fg-muted">{j.skipped.toLocaleString()}</td>
                    <td className="px-3 py-2">
                      <Badge tone={STATUS_TONE[j.status]}>{j.status}</Badge>
                      {j.errorCount > 0 && <span className="ml-1 text-[11px] text-warning">{j.errorCount} errors</span>}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {undoable && (
                        <Button variant="ghost" size="sm" disabled={pending} onClick={() => undo(j)}>
                          <Undo2 size={13} /> Undo
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
