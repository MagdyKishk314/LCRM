'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, Trash2, UserPlus, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/input';
import { revokeMembership, updateMembership } from '@/lib/actions/agency';
import { useInvite } from '@/lib/invite/provider';
import type { AgencyAccess, AgencyPerson } from '@/lib/api/agency';

interface RoleOption {
  id: string;
  name: string;
  description: string;
}

/** A direct member of this sub-account. Agency seats are managed in People. */
interface Member {
  person: AgencyPerson;
  grant: AgencyAccess;
}

/** AGY-09 — manage who reaches one sub-account, without switching into it. */
export function TeamManager({
  accountId,
  members,
  roles,
}: {
  accountId: string;
  members: Member[];
  roles: RoleOption[];
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
    roleId: roles[0]?.id ?? '',
  });

  function invite(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    startTransition(async () => {
      const res = await inviteFromAgency({
        email: form.email.trim(),
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        roleId: form.roleId,
        accountId,
      });

      if (res.ok) {
        setForm({ firstName: '', lastName: '', email: '', roleId: roles[0]?.id ?? '' });
        setAdding(false);
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  function changeRole(membershipId: string, roleId: string) {
    setError(null);
    startTransition(async () => {
      const res = await updateMembership(membershipId, { roleId });
      if (res.ok) router.refresh();
      else setError(res.error);
    });
  }

  function revoke(member: Member) {
    const who = `${member.person.firstName} ${member.person.lastName}`;
    if (!window.confirm(`Remove ${who}'s access to this sub-account?`)) return;

    setError(null);
    startTransition(async () => {
      const res = await revokeMembership(member.grant.membershipId, accountId);
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
            <h3 className="text-sm font-semibold text-fg">Invite to this sub-account</h3>
            <button
              type="button"
              onClick={() => setAdding(false)}
              aria-label="Cancel"
              className="text-fg-subtle transition-colors hover:text-fg"
            >
              <X size={15} />
            </button>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="t-first">First name</Label>
              <Input
                id="t-first"
                value={form.firstName}
                onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
                required
              />
            </div>
            <div>
              <Label htmlFor="t-last">Last name</Label>
              <Input
                id="t-last"
                value={form.lastName}
                onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))}
                required
              />
            </div>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="t-email">Email</Label>
              <Input
                id="t-email"
                type="email"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                required
              />
            </div>
            <div>
              <Label htmlFor="t-role">Role</Label>
              <Select
                id="t-role"
                value={form.roleId}
                onChange={(e) => setForm((f) => ({ ...f, roleId: e.target.value }))}
              >
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <p className="mt-1 text-[11px] text-fg-subtle">
            {roles.find((r) => r.id === form.roleId)?.description}
          </p>

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
          <UserPlus size={13} /> Invite to this sub-account
        </Button>
      )}

      <div className="overflow-hidden rounded-card border border-border bg-surface">
        {members.map(({ person, grant }) => (
          <div
            key={grant.membershipId}
            className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3 last:border-0"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium text-fg">
                {person.firstName} {person.lastName}
              </p>
              <p className="truncate text-[11px] text-fg-subtle">{person.email}</p>
            </div>

            {person.status !== 'active' && <Badge tone="warning">{person.status}</Badge>}

            <Select
              value={grant.roleId}
              disabled={pending}
              onChange={(e) => changeRole(grant.membershipId, e.target.value)}
              className="h-8 w-auto text-[13px]"
              aria-label={`Role for ${person.firstName} ${person.lastName}`}
            >
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
              {/* Keep an unlisted current role selectable rather than silently changing it. */}
              {!roles.some((r) => r.id === grant.roleId) && (
                <option value={grant.roleId}>{grant.roleName ?? "Current role"}</option>
              )}
            </Select>

            <button
              onClick={() => revoke({ person, grant })}
              disabled={pending}
              aria-label={`Remove ${person.firstName} ${person.lastName}`}
              className="text-fg-subtle transition-colors hover:text-danger disabled:opacity-50"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}

        {members.length === 0 && (
          <p className="px-4 py-12 text-center text-[13px] text-fg-subtle">
            Nobody can reach this sub-account yet.
          </p>
        )}
      </div>
    </div>
  );
}
