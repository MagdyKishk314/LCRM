'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, ChevronDown, ChevronUp, Plus, Trash2, X } from 'lucide-react';
import type { Pipeline } from '@/shared';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/input';
import { deletePipeline, updatePipeline, type StageInput } from '@/lib/actions/pipelines';

const COLORS = [
  { value: 'info', label: 'Blue' },
  { value: 'warning', label: 'Amber' },
  { value: 'brand', label: 'Brand' },
  { value: 'success', label: 'Green' },
  { value: 'neutral', label: 'Grey' },
];

/**
 * PIP-05/06 — rename a pipeline and edit its stages.
 *
 * Existing stages keep their `id` through every edit. That id is what each opportunity
 * stores, so a rename or reorder must not mint a new one — the server refuses ids it does
 * not recognise for exactly this reason, and treats them as new stages instead.
 */
export function StageEditor({
  accountId,
  pipeline,
  canDelete,
  onClose,
}: {
  accountId: string;
  pipeline: Pipeline;
  canDelete: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [name, setName] = React.useState(pipeline.name);
  const [stages, setStages] = React.useState<StageInput[]>(
    [...pipeline.stages]
      .sort((a, b) => a.order - b.order)
      .map((s) => ({
        id: s.id,
        name: s.name,
        order: s.order,
        color: s.color,
        probability: s.probability,
      })),
  );
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  function patch(index: number, changes: Partial<StageInput>) {
    setStages((prev) => prev.map((s, i) => (i === index ? { ...s, ...changes } : s)));
  }

  function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= stages.length) return;
    setStages((prev) => {
      const next = [...prev];
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  }

  function addStage() {
    // No id — the server reads that as "new" and mints a stable one.
    setStages((prev) => [
      ...prev,
      { name: '', order: prev.length, color: 'neutral', probability: 50 },
    ]);
  }

  function save() {
    setError(null);

    if (stages.some((s) => !s.name.trim())) {
      setError('Every stage needs a name.');
      return;
    }

    startTransition(async () => {
      const res = await updatePipeline(accountId, pipeline.id, {
        name: name.trim(),
        stages: stages.map((s, i) => ({ ...s, name: s.name.trim(), order: i })),
      });

      if (res.ok) {
        onClose();
        router.refresh();
      } else {
        // Typically "3 opportunities are still in Offer sent" — actionable as written.
        setError(res.error);
      }
    });
  }

  function remove() {
    if (!window.confirm(`Delete the pipeline "${pipeline.name}"?`)) return;

    setError(null);
    startTransition(async () => {
      const res = await deletePipeline(accountId, pipeline.id);
      if (res.ok) {
        onClose();
        router.push(`/app/${accountId}/pipelines`);
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <div className="mt-3 rounded-card border border-border bg-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-fg">Edit pipeline</h3>
        <button onClick={onClose} aria-label="Close" className="text-fg-subtle hover:text-fg">
          <X size={15} />
        </button>
      </div>

      {error && (
        <div
          role="alert"
          className="mb-3 flex items-start gap-2 rounded-lg border border-danger/25 bg-danger-subtle px-3 py-2"
        >
          <AlertCircle size={14} className="mt-0.5 shrink-0 text-danger" />
          <p className="text-[13px] text-danger">{error}</p>
        </div>
      )}

      <div className="mb-4 max-w-sm">
        <Label htmlFor="pl-name">Name</Label>
        <Input id="pl-name" value={name} onChange={(e) => setName(e.target.value)} required />
      </div>

      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">
        Stages
      </p>

      <div className="space-y-2">
        {stages.map((stage, i) => (
          <div key={stage.id ?? `new-${i}`} className="flex flex-wrap items-end gap-2">
            <div className="flex shrink-0 flex-col gap-0.5">
              <button
                type="button"
                onClick={() => move(i, -1)}
                disabled={i === 0}
                aria-label="Move up"
                className="text-fg-subtle transition-colors hover:text-fg disabled:opacity-30"
              >
                <ChevronUp size={13} />
              </button>
              <button
                type="button"
                onClick={() => move(i, 1)}
                disabled={i === stages.length - 1}
                aria-label="Move down"
                className="text-fg-subtle transition-colors hover:text-fg disabled:opacity-30"
              >
                <ChevronDown size={13} />
              </button>
            </div>

            <div className="min-w-[160px] flex-1">
              <Input
                value={stage.name}
                onChange={(e) => patch(i, { name: e.target.value })}
                placeholder="Stage name"
                aria-label={`Stage ${i + 1} name`}
              />
            </div>

            <Select
              value={stage.color}
              onChange={(e) => patch(i, { color: e.target.value })}
              className="w-28"
              aria-label={`Stage ${i + 1} colour`}
            >
              {COLORS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Select>

            <div className="w-28">
              <Input
                type="number"
                min={0}
                max={100}
                value={stage.probability}
                onChange={(e) => patch(i, { probability: Number(e.target.value) })}
                aria-label={`Stage ${i + 1} win probability`}
              />
            </div>

            <button
              type="button"
              onClick={() => setStages((prev) => prev.filter((_, x) => x !== i))}
              disabled={stages.length === 1}
              aria-label={`Remove stage ${i + 1}`}
              title={stages.length === 1 ? 'A pipeline needs at least one stage' : undefined}
              className="pb-2 text-fg-subtle transition-colors hover:text-danger disabled:opacity-30"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>

      <p className="mt-1.5 text-[11px] text-fg-subtle">
        The number is the win probability, used for the weighted forecast. Removing a stage
        is refused while opportunities are still in it.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={addStage}>
          <Plus size={13} /> Add stage
        </Button>

        <div className="ml-auto flex items-center gap-2">
          {canDelete && (
            <Button type="button" variant="danger" size="sm" onClick={remove} disabled={pending}>
              Delete pipeline
            </Button>
          )}
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" size="sm" onClick={save} disabled={pending}>
            {pending ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </div>
    </div>
  );
}
