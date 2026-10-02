'use client';

import * as React from 'react';
import { AlertCircle, Check } from 'lucide-react';
import type { Account } from '@landcaller/shared';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/input';
import { updateAccount } from '@/lib/actions/core';

const TIMEZONES = [
  'America/Denver',
  'America/Chicago',
  'America/Phoenix',
  'America/New_York',
  'America/Los_Angeles',
  'UTC',
];

/** CORE-07 — editable sub-account settings. */
export function SettingsForm({
  account,
  canEdit,
  canChangeStatus = false,
}: {
  account: Account;
  canEdit: boolean;
  /**
   * Pausing or archiving closes the sub-account to its own members, so only the agency may
   * do it — the API refuses a status change from an account-scoped user. The control is
   * shown read-only to them rather than offered and then rejected.
   */
  canChangeStatus?: boolean;
}) {
  const [name, setName] = React.useState(account.name);
  const [timezone, setTimezone] = React.useState(account.timezone);
  const [status, setStatus] = React.useState(account.status);
  const [markets, setMarkets] = React.useState((account.markets ?? []).join(', '));

  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  const dirty =
    name !== account.name ||
    timezone !== account.timezone ||
    status !== account.status ||
    markets !== (account.markets ?? []).join(', ');

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);

    startTransition(async () => {
      const res = await updateAccount(account.id, {
        name: name.trim(),
        timezone,
        // Sent only when it may be changed; an unchanged value would still be refused.
        ...(canChangeStatus ? { status } : {}),
        // Split on commas, drop blanks left by trailing separators.
        markets: markets
          .split(',')
          .map((m) => m.trim())
          .filter(Boolean),
      });

      if (res.ok) setSaved(true);
      else setError(res.error);
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-danger/25 bg-danger-subtle px-3 py-2.5"
        >
          <AlertCircle size={15} className="mt-0.5 shrink-0 text-danger" />
          <p className="text-[13px] text-danger">{error}</p>
        </div>
      )}

      <div>
        <Label htmlFor="name">Name</Label>
        <Input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={!canEdit}
          required
          minLength={2}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="tz">Timezone</Label>
          <Select
            id="tz"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            disabled={!canEdit}
          >
            {/* Keep an unexpected stored value selectable rather than silently rewriting it. */}
            {!TIMEZONES.includes(timezone) && <option value={timezone}>{timezone}</option>}
            {TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <Label htmlFor="status">Status</Label>
          <Select
            id="status"
            value={status}
            onChange={(e) => setStatus(e.target.value as Account['status'])}
            disabled={!canEdit || !canChangeStatus}
          >
            <option value="active">Active</option>
            <option value="paused">Paused</option>
            <option value="archived">Archived</option>
          </Select>
          <p className="mt-1 text-[11px] text-fg-subtle">
            {canChangeStatus
              ? 'Paused and archived sub-accounts are closed to their own team.'
              : 'Set by your agency.'}
          </p>
        </div>
      </div>

      <div>
        <Label htmlFor="markets">Target markets</Label>
        <Input
          id="markets"
          value={markets}
          onChange={(e) => setMarkets(e.target.value)}
          disabled={!canEdit}
          placeholder="Costilla County, CO"
        />
        <p className="mt-1 text-[11px] text-fg-subtle">
          Comma-separated. Used to scope list pulls and campaign targeting.
        </p>
      </div>

      {canEdit && (
        <div className="flex items-center justify-end gap-3">
          {saved && !dirty && (
            <span className="flex items-center gap-1.5 text-[13px] font-medium text-success">
              <Check size={14} /> Saved
            </span>
          )}
          <Button type="submit" disabled={!dirty || pending}>
            {pending ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      )}
    </form>
  );
}
