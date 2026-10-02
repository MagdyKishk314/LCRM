'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertCircle, GripVertical } from 'lucide-react';
import type { Contact, Opportunity, Pipeline } from '@landcaller/shared';
import { cn } from '@/lib/cn';
import { formatDate } from '@/lib/format';
import { useSession } from '@/lib/session';
import { moveOpportunity } from '@/lib/actions/pipelines';

const STAGE_ACCENT: Record<string, string> = {
  info: 'bg-info',
  warning: 'bg-warning',
  brand: 'bg-brand',
  success: 'bg-success',
  neutral: 'bg-fg-subtle',
};

type BoardContact = Pick<Contact, 'id' | 'firstName' | 'lastName' | 'phone' | 'email'>;

/**
 * PIP-01/02 — the kanban board.
 *
 * Moves are optimistic: the card lands where it was dropped straight away, and reverts if
 * the server rejects it. Waiting on a round trip before the card moves makes dragging feel
 * broken, and a caller reorganising a board does it dozens of times an hour.
 */
export function PipelineBoard({
  accountId,
  pipeline,
  opportunities: initial,
  contacts,
  can,
}: {
  accountId: string;
  pipeline: Pipeline;
  opportunities: Opportunity[];
  contacts: BoardContact[];
  can: { update: boolean; delete: boolean };
}) {
  const router = useRouter();
  const timeZone = useSession().activeAccount?.timezone;

  const [opportunities, setOpportunities] = React.useState(initial);
  const [dragId, setDragId] = React.useState<string | null>(null);
  const [overStage, setOverStage] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  // A server refresh (new card, stage edit) must replace local state, or the board keeps
  // showing a stale optimistic view.
  React.useEffect(() => setOpportunities(initial), [initial]);

  const contactById = React.useMemo(() => new Map(contacts.map((c) => [c.id, c])), [contacts]);
  const stages = React.useMemo(
    () => [...pipeline.stages].sort((a, b) => a.order - b.order),
    [pipeline.stages],
  );

  function onDrop(stageId: string) {
    setOverStage(null);
    if (!dragId) return;

    const card = opportunities.find((o) => o.id === dragId);
    setDragId(null);
    if (!card || card.stageId === stageId) return;

    const previousStageId = card.stageId;
    setOpportunities((prev) => prev.map((o) => (o.id === dragId ? { ...o, stageId } : o)));
    setError(null);

    void moveOpportunity(accountId, dragId, { stageId }).then((res) => {
      if (res.ok) {
        // Refresh so stage totals and any server-side status change (a card dropped in
        // the final stage is marked won) are reflected.
        router.refresh();
        return;
      }
      // Put it back where it came from — a card sitting in a stage the server rejected
      // is worse than no move at all.
      setOpportunities((prev) =>
        prev.map((o) => (o.id === dragId ? { ...o, stageId: previousStageId } : o)),
      );
      setError(res.error);
    });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {error && (
        <div
          role="alert"
          className="mx-6 mb-2 flex items-start gap-2 rounded-lg border border-danger/25 bg-danger-subtle px-3 py-2"
        >
          <AlertCircle size={14} className="mt-0.5 shrink-0 text-danger" />
          <p className="text-[13px] text-danger">{error}</p>
        </div>
      )}

      <div className="flex flex-1 gap-3 overflow-x-auto scrollbar-thin px-6 pb-6">
        {stages.map((stage) => {
          const cards = opportunities.filter((o) => o.stageId === stage.id);
          const total = cards.reduce((s, o) => s + o.value, 0);
          const isOver = overStage === stage.id;

          return (
            <div
              key={stage.id}
              onDragOver={(e) => {
                if (!can.update) return;
                e.preventDefault();
                setOverStage(stage.id);
              }}
              onDragLeave={() => setOverStage((s) => (s === stage.id ? null : s))}
              onDrop={() => onDrop(stage.id)}
              className={cn(
                'flex w-72 shrink-0 flex-col rounded-card border bg-surface-2 transition-colors',
                isOver ? 'border-brand bg-brand-subtle/50' : 'border-border',
              )}
            >
              <div className="shrink-0 border-b border-border px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      'h-2 w-2 rounded-full',
                      STAGE_ACCENT[stage.color] ?? 'bg-fg-subtle',
                    )}
                  />
                  <h3 className="min-w-0 flex-1 truncate text-[13px] font-semibold text-fg">
                    {stage.name}
                  </h3>
                  <span className="tabular rounded-md bg-surface px-1.5 py-0.5 text-[11px] font-medium text-fg-muted">
                    {cards.length}
                  </span>
                </div>
                <p className="tabular mt-1 text-[11px] text-fg-subtle">
                  ${total.toLocaleString()} · {stage.probability}% likely
                </p>
              </div>

              <div className="flex-1 space-y-2 overflow-y-auto scrollbar-thin p-2">
                {cards.map((o) => {
                  const contact = contactById.get(o.contactId);
                  return (
                    <article
                      key={o.id}
                      draggable={can.update}
                      onDragStart={() => setDragId(o.id)}
                      onDragEnd={() => {
                        setDragId(null);
                        setOverStage(null);
                      }}
                      className={cn(
                        'group rounded-lg border border-border bg-surface p-2.5 shadow-xs transition-all',
                        can.update && 'cursor-grab active:cursor-grabbing hover:shadow-sm',
                        dragId === o.id && 'opacity-40',
                      )}
                    >
                      <div className="flex items-start gap-1.5">
                        {can.update && (
                          <GripVertical
                            size={13}
                            className="mt-0.5 shrink-0 text-fg-subtle opacity-0 transition-opacity group-hover:opacity-100"
                          />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] font-medium text-fg">{o.name}</p>
                          {contact && (
                            <Link
                              href={`/app/${accountId}/contacts/${contact.id}`}
                              className="mt-0.5 block truncate text-[11px] text-fg-muted hover:text-brand-text hover:underline"
                            >
                              {contact.firstName} {contact.lastName}
                            </Link>
                          )}
                          <div className="mt-2 flex items-center justify-between">
                            <span className="tabular text-[13px] font-semibold text-fg">
                              ${o.value.toLocaleString()}
                            </span>
                            {o.expectedCloseDate && (
                              <span className="text-[11px] text-fg-subtle">
                                {formatDate(o.expectedCloseDate, timeZone)}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </article>
                  );
                })}

                {cards.length === 0 && (
                  <p className="px-2 py-6 text-center text-[12px] text-fg-subtle">
                    {isOver ? 'Drop here' : 'No opportunities'}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
