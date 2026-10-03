'use client';

import * as React from 'react';
import { AlertTriangle, Check, Lock } from 'lucide-react';
import {
  dependentsOf,
  getModule,
  listModules,
  validateModuleSet,
  withDependencies,
  type ModuleKey,
} from '@/shared';
import { cn } from '@/lib/cn';
import { Icon } from '@/components/shell/icon';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { saveModules } from '@/lib/actions/core';

/**
 * Per-sub-account module toggles.
 *
 * Two rules from the registry are enforced here rather than left to the user:
 * enabling a module pulls in its dependencies, and disabling one is blocked while
 * another enabled module still depends on it. The agency ceiling (`agencyEnabled`)
 * renders as a locked row — a sub-account can never exceed what its agency sells.
 */
export function ModuleToggles({
  accountId,
  accountEnabled,
  agencyEnabled,
  accountName,
}: {
  accountId: string;
  accountEnabled: ModuleKey[];
  agencyEnabled: ModuleKey[];
  accountName: string;
}) {
  const [enabled, setEnabled] = React.useState<Set<ModuleKey>>(new Set(accountEnabled));
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  const agencySet = React.useMemo(() => new Set(agencyEnabled), [agencyEnabled]);
  const initial = React.useMemo(() => new Set(accountEnabled), [accountEnabled]);

  /**
   * Core modules are deliberately absent from this screen.
   *
   * They cannot be switched off, so listing them as permanently-disabled rows is noise
   * in a place whose entire job is presenting choices. They stay in `enabled` state and
   * are still submitted — the API re-adds them regardless — they are just not rendered.
   */
  const optional = React.useMemo(() => listModules().filter((m) => !m.core), []);

  const dirty =
    enabled.size !== initial.size || [...enabled].some((k) => !initial.has(k));

  function toggle(key: ModuleKey) {
    setError(null);
    setSaved(false);
    const manifest = getModule(key);
    if (!manifest || manifest.core) return;

    const next = new Set(enabled);

    if (next.has(key)) {
      const blockers = dependentsOf(key, [...next]);
      if (blockers.length > 0) {
        const names = blockers.map((b) => getModule(b)?.name ?? b).join(', ');
        setError(`Turn off ${names} first — ${manifest.name} is required by it.`);
        return;
      }
      next.delete(key);
    } else {
      // Pull in the dependency chain, but never past what the agency allows.
      const wanted = withDependencies([key]);
      const unavailable = wanted.filter((k) => !agencySet.has(k) && !getModule(k)?.core);
      if (unavailable.length > 0) {
        const names = unavailable.map((k) => getModule(k)?.name ?? k).join(', ');
        setError(`${manifest.name} requires ${names}, which your agency plan does not include.`);
        return;
      }
      wanted.forEach((k) => next.add(k));
    }

    setEnabled(next);
  }

  function save() {
    // Checked here for an instant message, and again by the API — the browser's copy
    // of these rules is advisory, and the endpoint is reachable directly.
    const result = validateModuleSet([...enabled]);
    if (!result.valid) {
      const first = result.missing[0]!;
      setError(
        `${getModule(first.module)?.name} needs ${first.requires
          .map((r) => getModule(r)?.name ?? r)
          .join(', ')}.`,
      );
      return;
    }

    setError(null);
    startTransition(async () => {
      const res = await saveModules(accountId, [...enabled]);
      if (res.ok) {
        setSaved(true);
      } else {
        // Roll the switches back so what is shown matches what is stored.
        setEnabled(new Set(accountEnabled));
        setError(res.error);
      }
    });
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-danger/25 bg-danger-subtle px-3 py-2.5">
          <AlertTriangle size={15} className="mt-0.5 shrink-0 text-danger" />
          <p className="text-[13px] text-danger">{error}</p>
        </div>
      )}

      <div className="overflow-hidden rounded-card border border-border bg-surface">
        {optional.length === 0 && (
          <p className="px-4 py-10 text-center text-[13px] text-fg-subtle">
            Nothing to configure. This sub-account runs the core modules only.
          </p>
        )}

        {optional.map((m) => {
          const isOn = enabled.has(m.key);
          const allowedByAgency = agencySet.has(m.key);
          const locked = !allowedByAgency;

          // Only optional modules can block a disable, and only optional dependencies are
          // worth naming — "Requires Contacts" is noise when Contacts can never be off.
          const blockers = isOn
            ? dependentsOf(m.key, [...enabled]).filter((k) => !getModule(k)?.core)
            : [];
          const optionalDeps = m.dependsOn.filter((d) => !getModule(d)?.core);

          return (
            <div
              key={m.key}
              className={cn(
                'flex items-start gap-3.5 border-b border-border px-4 py-3.5 last:border-0',
                !allowedByAgency && 'opacity-60',
              )}
            >
              <span
                className={cn(
                  'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border',
                  isOn
                    ? 'border-brand-border bg-brand-subtle text-brand-text'
                    : 'border-border bg-surface-2 text-fg-subtle',
                )}
              >
                <Icon name={m.icon} size={15} />
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-[13px] font-semibold text-fg">{m.name}</h3>
                  {m.status === 'planned' && <Badge tone="info">Coming soon</Badge>}
                  {m.status === 'beta' && <Badge tone="warning">Beta</Badge>}
                  {!allowedByAgency && <Badge tone="warning">Not in agency plan</Badge>}
                </div>

                <p className="mt-0.5 text-[13px] leading-relaxed text-fg-muted">
                  {m.description}
                </p>

                {optionalDeps.length > 0 && (
                  <p className="mt-1 text-[11px] text-fg-subtle">
                    Requires {optionalDeps.map((d) => getModule(d)?.name ?? d).join(', ')}
                  </p>
                )}
                {blockers.length > 0 && (
                  <p className="mt-1 flex items-center gap-1 text-[11px] text-fg-subtle">
                    <Lock size={10} />
                    Needed by {blockers.map((b) => getModule(b)?.name ?? b).join(', ')}
                  </p>
                )}
              </div>

              <Switch
                checked={isOn}
                disabled={locked}
                onChange={() => toggle(m.key)}
                label={`${isOn ? 'Disable' : 'Enable'} ${m.name}`}
              />
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={!dirty || pending}>
          {pending ? 'Saving…' : 'Save changes'}
        </Button>
        {dirty && !pending && (
          <Button
            variant="ghost"
            onClick={() => {
              setEnabled(new Set(accountEnabled));
              setError(null);
              setSaved(false);
            }}
          >
            Discard
          </Button>
        )}
        {saved && (
          <span className="flex items-center gap-1.5 text-[13px] font-medium text-success">
            <Check size={14} /> Saved for {accountName}
          </span>
        )}
      </div>
    </div>
  );
}

function Switch({
  checked,
  disabled,
  onChange,
  label,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={cn(
        // `p-0` matters: a button carries user-agent padding, and without it the knob's
        // static position starts inset from the left, pushing it out through the right
        // edge of the track.
        'relative mt-0.5 h-5 w-9 shrink-0 cursor-pointer rounded-full p-0 transition-colors',
        checked ? 'bg-brand' : 'bg-border-strong',
        disabled && 'cursor-not-allowed opacity-40',
      )}
    >
      {/*
        Track 36×20, knob 16 — `left-0`/`top-0.5` anchor it to the track itself so the
        translate is measured from the left edge, leaving a symmetric 2px inset at both
        ends (2→18 off, 18→34 on).
      */}
      <span
        className={cn(
          'absolute left-0 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-150',
          checked ? 'translate-x-[18px]' : 'translate-x-0.5',
        )}
      />
    </button>
  );
}
