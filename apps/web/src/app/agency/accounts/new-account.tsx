'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, Plus, X } from 'lucide-react';
import { getModule, type ModuleKey } from '@landcaller/shared';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { createAccount } from '@/lib/actions/core';

/** CORE-06 — create a sub-account, capped by what the agency plan allows. */
export function NewAccount({
  currentAccountId,
  agencyModules,
}: {
  currentAccountId: string;
  agencyModules: ModuleKey[];
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState('');
  const [slug, setSlug] = React.useState('');
  const [slugTouched, setSlugTouched] = React.useState(false);
  const [markets, setMarkets] = React.useState('');
  const [modules, setModules] = React.useState<Set<ModuleKey>>(new Set(['core', 'contacts']));
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  // Slug follows the name until the user edits it directly, then it stops fighting them.
  React.useEffect(() => {
    if (slugTouched) return;
    setSlug(
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60),
    );
  }, [name, slugTouched]);

  const selectable = agencyModules.filter((k) => k !== 'core' && getModule(k)?.status !== 'planned');

  function toggle(key: ModuleKey) {
    const next = new Set(modules);
    if (next.has(key)) next.delete(key);
    else {
      next.add(key);
      getModule(key)?.dependsOn.forEach((d) => next.add(d));
    }
    setModules(next);
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    startTransition(async () => {
      const res = await createAccount(currentAccountId, {
        name: name.trim(),
        slug: slug.trim(),
        timezone: 'America/Denver',
        markets: markets.split(',').map((m) => m.trim()).filter(Boolean),
        enabledModules: [...modules],
      });

      if (res.ok) {
        setOpen(false);
        setName('');
        setSlug('');
        setSlugTouched(false);
        setMarkets('');
        router.push(`/app/${res.data.id}`);
      } else {
        setError(res.error);
      }
    });
  }

  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus size={13} /> New sub-account
      </Button>
    );
  }

  return (
    <div className="w-full rounded-card border border-border bg-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-fg">New sub-account</h3>
        <button
          onClick={() => setOpen(false)}
          aria-label="Cancel"
          className="text-fg-subtle transition-colors hover:text-fg"
        >
          <X size={15} />
        </button>
      </div>

      <form onSubmit={onSubmit} className="space-y-3">
        {error && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-danger/25 bg-danger-subtle px-3 py-2"
          >
            <AlertCircle size={14} className="mt-0.5 shrink-0 text-danger" />
            <p className="text-[13px] text-danger">{error}</p>
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="acc-name">Client name</Label>
            <Input
              id="acc-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              minLength={2}
              placeholder="Ridgeline Land Co."
            />
          </div>
          <div>
            <Label htmlFor="acc-slug">Slug</Label>
            <Input
              id="acc-slug"
              value={slug}
              onChange={(e) => {
                setSlugTouched(true);
                setSlug(e.target.value);
              }}
              required
              pattern="[a-z0-9\-]+"
              placeholder="ridgeline"
            />
          </div>
        </div>

        <div>
          <Label htmlFor="acc-markets">Target markets</Label>
          <Input
            id="acc-markets"
            value={markets}
            onChange={(e) => setMarkets(e.target.value)}
            placeholder="Costilla County, CO"
          />
        </div>

        <div>
          <Label>Modules</Label>
          <div className="flex flex-wrap gap-1.5">
            {selectable.map((key) => {
              const on = modules.has(key);
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => toggle(key)}
                  aria-pressed={on}
                  className={
                    on
                      ? 'rounded-md border border-brand-border bg-brand-subtle px-2 py-1 text-[12px] font-medium text-brand-text'
                      : 'rounded-md border border-border bg-surface px-2 py-1 text-[12px] text-fg-muted hover:bg-surface-2'
                  }
                >
                  {getModule(key)?.name ?? key}
                </button>
              );
            })}
          </div>
          <p className="mt-1 text-[11px] text-fg-subtle">
            Core is always on. Only modules your agency plan includes are listed.
          </p>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={pending || !name || !slug}>
            {pending ? 'Creating…' : 'Create sub-account'}
          </Button>
        </div>
      </form>
    </div>
  );
}
