'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, AlertTriangle, Trash2, UserPlus, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/input';
import { revokeMembership } from '@/lib/actions/agency';
import { useInvite } from '@/lib/invite/provider';
import type { AgencyPerson } from '@/lib/api/agency';

interface RoleOption {
  id: string;
  name: string;
  description: string;
  scope: 'platform' | 'agency' | 'account';
}

/**
 * AGY-10 — the agency's people, and the only place an agency-wide seat is handed out.
 *
 * Granting agency scope is treated as consequential rather than as one option among
 * many: it is called out in the form, and the API audits it under its own action name.
 */
export function PeopleManager({
  people,
  roles,
  accounts,
}: {
  people: AgencyPerson[];
  roles: RoleOption[];
  accounts: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [adding, setAdding] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  // The link an invite produces is shown by the provider, above the page — see lib/invite.
  const { inviteFromAgency } = useInvite();

  const [form, setForm] = React.useState({
    firstName: '',
    lastName: '',
    email: '',
    roleId: roles.find((r) => r.scope === 'account')?.id ?? roles[0]?.id ?? '',
    accountId: accounts[0]?.id ?? '',
  });

  const selectedRole = roles.find((r) => r.id === form.roleId);
  const isAgencyRole = selectedRole?.scope === 'agency';

  function invite(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    startTransition(async () => {
      const res = await inviteFromAgency({
        email: form.email.trim(),
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        roleId: form.roleId,
        // An agency role covers every sub-account, so sending one would be contradictory.
        accountId: isAgencyRole ? undefined : form.accountId,
      });

      if (res.ok) {
        setForm((f) => ({ ...f, firstName: '', lastName: '', email: '' }));
        setAdding(false);
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  function revoke(person: AgencyPerson, membershipId: string, what: string) {
    if (!window.confirm(`Remove ${person.firstName} ${person.lastName}'s ${what}?`)) return;

    setError(null);
    startTransition(async () => {
      const res = await revokeMembership(membershipId);
      if (res.ok) router.refresh();
      else setError(res.error);
    });
  }

  return (
    <div className="space-y-3">
      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-danger/25 bg-danger-subtle px-3 py-2.5"
        >
          <AlertCircle size={15} className="mt-0.5 shrink-0 text-danger" />
          <p className="text-[13px] text-danger">{error}</p>
        </div>
      )}

      {adding ? (
        <form onSubmit={invite} className="rounded-card border border-border bg-surface p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-fg">Invite someone</h3>
            <button
              type="button"
              onClick={() => setAdding(false)}
              aria-label="Cancel"
              className="text-fg-subtle transition-colors hover:text-fg"
            >
              <X size={15} />
            </button>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <Label htmlFor="p-first">First name</Label>
              <Input
                id="p-first"
                value={form.firstName}
                onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
                required
              />
            </div>
            <div>
              <Label htmlFor="p-last">Last name</Label>
              <Input
                id="p-last"
                value={form.lastName}
                onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))}
                required
              />
            </div>
            <div>
              <Label htmlFor="p-email">Email</Label>
              <Input
                id="p-email"
                type="email"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                required
              />
            </div>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="p-role">Role</Label>
              <Select
                id="p-role"
                value={form.roleId}
                onChange={(e) => setForm((f) => ({ ...f, roleId: e.target.value }))}
              >
                <optgroup label="Sub-account">
                  {roles
                    .filter((r) => r.scope === 'account')
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                </optgroup>
                <optgroup label="Agency-wide">
                  {roles
                    .filter((r) => r.scope === 'agency')
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                </optgroup>
              </Select>
              <p className="mt-1 text-[11px] text-fg-subtle">{selectedRole?.description}</p>
            </div>

            {!isAgencyRole && (
              <div>
                <Label htmlFor="p-account">Sub-account</Label>
                <Select
                  id="p-account"
                  value={form.accountId}
                  onChange={(e) => setForm((f) => ({ ...f, accountId: e.target.value }))}
                >
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </Select>
              </div>
            )}
          </div>

          {isAgencyRole && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-subtle px-3 py-2">
              <AlertTriangle size={14} className="mt-0.5 shrink-0 text-warning" />
              <p className="text-[12px] text-fg">
                An agency role grants access to <strong>every sub-account</strong>, including
                any created later. Only give it to your own staff.
              </p>
            </div>
          )}

          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={pending || !form.email.trim()}>
              {pending ? 'Sending…' : 'Send invite'}
            </Button>
          </div>
        </form>
      ) : (
        <Button size="sm" onClick={() => setAdding(true)}>
          <UserPlus size={13} /> Invite someone
        </Button>
      )}

      <div className="overflow-hidden rounded-card border border-border bg-surface">
        {people.map((person) => (
          <div key={person.id} className="border-b border-border px-4 py-3 last:border-0">
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-fg">
                  {person.firstName} {person.lastName}
                </p>
                <p className="truncate text-[11px] text-fg-subtle">{person.email}</p>
              </div>
              {person.status !== 'active' && <Badge tone="warning">{person.status}</Badge>}
            </div>

            <div className="mt-2 flex flex-wrap gap-1.5">
              {person.access.map((a) => (
                <span
                  key={a.membershipId}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2 py-1 text-[11px]"
                >
                  {a.scope === 'agency' ? (
                    <Badge tone="brand">Agency-wide</Badge>
                  ) : (
                    <span className="text-fg-muted">{a.accountName}</span>
                  )}
                  <span className="text-fg">{a.roleName}</span>
                  <button
                    onClick={() =>
                      revoke(
                        person,
                        a.membershipId,
                        a.scope === 'agency'
                          ? 'agency-wide access'
                          : `access to ${a.accountName}`,
                      )
                    }
                    disabled={pending}
                    aria-label={`Revoke ${person.firstName}'s ${a.scope} access`}
                    className="text-fg-subtle transition-colors hover:text-danger disabled:opacity-50"
                  >
                    <Trash2 size={12} />
                  </button>
                </span>
              ))}

              {person.access.length === 0 && (
                <span className="text-[11px] text-fg-subtle">No access</span>
              )}
            </div>
          </div>
        ))}

        {people.length === 0 && (
          <p className="px-4 py-14 text-center text-[13px] text-fg-subtle">Nobody yet.</p>
        )}
      </div>
    </div>
  );
}
