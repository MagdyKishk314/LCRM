'use client';

import * as React from 'react';
import { AlertCircle, UserPlus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/input';
import { useInvite } from '@/lib/invite/provider';

export interface RoleOption {
  id: string;
  name: string;
  description: string;
}

/** CORE-09 — invite a user into this sub-account. */
export function InviteUser({ accountId, roles }: { accountId: string; roles: RoleOption[] }) {
  const [open, setOpen] = React.useState(false);
  const [firstName, setFirstName] = React.useState('');
  const [lastName, setLastName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [roleId, setRoleId] = React.useState(roles[0]?.id ?? '');
  const [error, setError] = React.useState<string | null>(null);
  // The link this produces is shown by the provider, above the page — see lib/invite.
  const { inviteToAccount, pending } = useInvite();

  function reset() {
    setFirstName('');
    setLastName('');
    setEmail('');
    setRoleId(roles[0]?.id ?? '');
    setError(null);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const res = await inviteToAccount(accountId, {
      email: email.trim(),
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      roleId,
    });

    if (res.ok) {
      reset();
      setOpen(false);
    } else {
      setError(res.error);
    }
  }

  if (roles.length === 0) {
    return (
      <p className="text-[13px] text-fg-subtle">No assignable roles for this sub-account.</p>
    );
  }

  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)}>
        <UserPlus size={13} /> Invite user
      </Button>
    );
  }

  return (
    <div className="w-full rounded-card border border-border bg-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-fg">Invite a user</h3>
        <button
          onClick={() => {
            setOpen(false);
            reset();
          }}
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
            <Label htmlFor="firstName">First name</Label>
            <Input
              id="firstName"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              required
            />
          </div>
          <div>
            <Label htmlFor="lastName">Last name</Label>
            <Input
              id="lastName"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              required
            />
          </div>
        </div>

        <div>
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            placeholder="name@company.com"
          />
        </div>

        <div>
          <Label htmlFor="role">Role</Label>
          <Select id="role" value={roleId} onChange={(e) => setRoleId(e.target.value)}>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
          <p className="mt-1 text-[11px] text-fg-subtle">
            {roles.find((r) => r.id === roleId)?.description}
          </p>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setOpen(false);
              reset();
            }}
          >
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? 'Sending…' : 'Send invite'}
          </Button>
        </div>
      </form>
    </div>
  );
}
