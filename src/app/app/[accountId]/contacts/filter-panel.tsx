'use client';

import * as React from 'react';
import { CONTACT_STATUS_LABEL, CONTACT_STATUSES, type ContactFilter, type ContactList } from '@/shared';
import { Input, Label, Select } from '@/components/ui/input';
import type { Facets } from '@/lib/contacts/facets';

/**
 * CNT-29 — every condition the API can filter by, in one panel.
 *
 * Shared by the contacts table (where it edits the URL) and the smart-list editor (where
 * it edits the list's stored filter), so a saved view and a live filter are the same
 * thing seen from two places. The panel edits a `ContactFilter`; the caller decides
 * where it goes.
 */
export function FilterPanel({
  filter,
  onChange,
  facets,
  lists = [],
  showList = true,
}: {
  filter: ContactFilter;
  onChange: (next: ContactFilter) => void;
  facets: Facets;
  lists?: ContactList[];
  /** The list condition is meaningless inside a smart list's own filter. */
  showList?: boolean;
}) {
  const set = <K extends keyof ContactFilter>(key: K, value: ContactFilter[K] | undefined) => {
    const next = { ...filter };
    if (value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) delete next[key];
    else next[key] = value;
    onChange(next);
  };

  const toggleIn = (key: 'status' | 'state' | 'county' | 'tags' | 'source', value: string) => {
    const current = (filter[key] as string[] | undefined) ?? [];
    set(key, current.includes(value) ? current.filter((v) => v !== value) : [...current, value]);
  };

  const num = (key: 'acresMin' | 'acresMax' | 'valueMin' | 'valueMax') => (e: React.ChangeEvent<HTMLInputElement>) =>
    set(key, e.target.value === '' ? undefined : Number(e.target.value));

  const tri = (key: 'dnc' | 'hasEmail' | 'hasPhone') => (e: React.ChangeEvent<HTMLSelectElement>) =>
    set(key, e.target.value === '' ? undefined : e.target.value === 'true');

  const cf = filter.customFields ?? {};
  const setCf = (key: string, value: unknown) => {
    const next = { ...cf };
    if (value === undefined || value === '' || value === null) delete next[key];
    else next[key] = value as string | number | boolean;
    set('customFields', Object.keys(next).length ? next : undefined);
  };

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      <Group label="Status">
        <Chips options={CONTACT_STATUSES.map((s) => ({ value: s, label: CONTACT_STATUS_LABEL[s] }))} selected={filter.status ?? []} onToggle={(v) => toggleIn('status', v)} />
      </Group>

      <Group label="Tags">
        <Chips options={facets.tags.map((t) => ({ value: t, label: t }))} selected={filter.tags ?? []} onToggle={(v) => toggleIn('tags', v)} empty="No tags yet" />
        {(filter.tags?.length ?? 0) > 1 && (
          <label className="mt-1.5 flex items-center gap-1.5 text-[12px] text-fg-muted">
            <input type="checkbox" checked={filter.tagMode === 'all'} onChange={(e) => set('tagMode', e.target.checked ? 'all' : undefined)} className="accent-brand" />
            Must have every selected tag
          </label>
        )}
      </Group>

      <Group label="Owner">
        <Select value={filter.ownerId ?? ''} onChange={(e) => set('ownerId', e.target.value || undefined)} aria-label="Owner">
          <option value="">Anyone</option>
          <option value="me">Me</option>
          <option value="none">Unassigned</option>
          {facets.owners.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </Select>
      </Group>

      <Group label="Parcel state">
        <Chips options={facets.states.map((s) => ({ value: s, label: s }))} selected={filter.state ?? []} onToggle={(v) => toggleIn('state', v)} empty="No parcels yet" />
      </Group>

      <Group label="County">
        <Chips options={facets.counties.map((c) => ({ value: c, label: c }))} selected={filter.county ?? []} onToggle={(v) => toggleIn('county', v)} empty="No parcels yet" max={24} />
      </Group>

      <Group label="Acres">
        <div className="flex items-center gap-2">
          <Input type="number" min="0" step="0.01" placeholder="min" value={filter.acresMin ?? ''} onChange={num('acresMin')} aria-label="Minimum acres" />
          <span className="text-fg-subtle">–</span>
          <Input type="number" min="0" step="0.01" placeholder="max" value={filter.acresMax ?? ''} onChange={num('acresMax')} aria-label="Maximum acres" />
        </div>
      </Group>

      <Group label="Assessed value">
        <div className="flex items-center gap-2">
          <Input type="number" min="0" placeholder="min $" value={filter.valueMin ?? ''} onChange={num('valueMin')} aria-label="Minimum assessed value" />
          <span className="text-fg-subtle">–</span>
          <Input type="number" min="0" placeholder="max $" value={filter.valueMax ?? ''} onChange={num('valueMax')} aria-label="Maximum assessed value" />
        </div>
      </Group>

      <Group label="Source">
        <Chips options={facets.sources.map((s) => ({ value: s, label: s }))} selected={filter.source ?? []} onToggle={(v) => toggleIn('source', v)} empty="No sources yet" max={16} />
      </Group>

      <Group label="Do not call / has details">
        <div className="grid grid-cols-3 gap-2">
          <Select value={filter.dnc === undefined ? '' : String(filter.dnc)} onChange={tri('dnc')} aria-label="Do not call">
            <option value="">DNC: any</option>
            <option value="true">Only DNC</option>
            <option value="false">Exclude DNC</option>
          </Select>
          <Select value={filter.hasEmail === undefined ? '' : String(filter.hasEmail)} onChange={tri('hasEmail')} aria-label="Has email">
            <option value="">Email: any</option>
            <option value="true">Has email</option>
            <option value="false">No email</option>
          </Select>
          <Select value={filter.hasPhone === undefined ? '' : String(filter.hasPhone)} onChange={tri('hasPhone')} aria-label="Has phone">
            <option value="">Phone: any</option>
            <option value="true">Has phone</option>
            <option value="false">No phone</option>
          </Select>
        </div>
      </Group>

      <Group label="Created">
        <DateRange after={filter.createdAfter} before={filter.createdBefore} onAfter={(v) => set('createdAfter', v)} onBefore={(v) => set('createdBefore', v)} />
      </Group>

      <Group label="Last activity">
        <DateRange after={filter.activityAfter} before={filter.activityBefore} onAfter={(v) => set('activityAfter', v)} onBefore={(v) => set('activityBefore', v)} />
      </Group>

      {showList && lists.length > 0 && (
        <Group label="List">
          <Select value={filter.listId ?? ''} onChange={(e) => set('listId', e.target.value || undefined)} aria-label="List">
            <option value="">All contacts</option>
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        </Group>
      )}

      {facets.fields.map((def) => (
        <Group key={def.key} label={def.label}>
          {def.type === 'select' || def.type === 'multiselect' ? (
            <Select value={(cf[def.key] as string) ?? ''} onChange={(e) => setCf(def.key, e.target.value)} aria-label={def.label}>
              <option value="">Any</option>
              {(def.options ?? []).map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </Select>
          ) : def.type === 'checkbox' ? (
            <Select value={cf[def.key] === undefined ? '' : String(cf[def.key])} onChange={(e) => setCf(def.key, e.target.value === '' ? undefined : e.target.value === 'true')} aria-label={def.label}>
              <option value="">Any</option>
              <option value="true">Yes</option>
              <option value="false">No</option>
            </Select>
          ) : (
            <Input
              type={def.type === 'number' || def.type === 'currency' ? 'number' : def.type === 'date' ? 'date' : 'text'}
              value={(cf[def.key] as string) ?? ''}
              onChange={(e) => setCf(def.key, def.type === 'number' || def.type === 'currency' ? (e.target.value === '' ? undefined : Number(e.target.value)) : e.target.value)}
              placeholder="equals…"
              aria-label={def.label}
            />
          )}
        </Group>
      ))}
    </div>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function Chips({
  options,
  selected,
  onToggle,
  empty,
  max = 40,
}: {
  options: { value: string; label: string }[];
  selected: string[];
  onToggle: (value: string) => void;
  empty?: string;
  max?: number;
}) {
  const [showAll, setShowAll] = React.useState(false);
  if (options.length === 0) return <p className="text-[12px] text-fg-subtle">{empty ?? '—'}</p>;
  const visible = showAll ? options : options.slice(0, max);
  return (
    <div className="flex flex-wrap gap-1">
      {visible.map((o) => {
        const on = selected.includes(o.value);
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onToggle(o.value)}
            aria-pressed={on}
            className={`rounded-md border px-2 py-0.5 text-[12px] transition-colors ${on ? 'border-brand-border bg-brand-subtle text-brand-text' : 'border-border bg-surface text-fg-muted hover:text-fg'}`}
          >
            {o.label}
          </button>
        );
      })}
      {options.length > max && !showAll && (
        <button type="button" onClick={() => setShowAll(true)} className="px-1 text-[12px] text-fg-subtle hover:text-fg">
          +{options.length - max} more
        </button>
      )}
    </div>
  );
}

function DateRange({ after, before, onAfter, onBefore }: { after?: string; before?: string; onAfter: (v?: string) => void; onBefore: (v?: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <Input type="date" value={after?.slice(0, 10) ?? ''} onChange={(e) => onAfter(e.target.value || undefined)} aria-label="After" />
      <span className="text-fg-subtle">–</span>
      <Input type="date" value={before?.slice(0, 10) ?? ''} onChange={(e) => onBefore(e.target.value || undefined)} aria-label="Before" />
    </div>
  );
}
