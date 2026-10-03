'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, Pencil, Plus, X } from 'lucide-react';
import type { PermissionDef, Role } from '@/shared';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { deleteRole, saveRole } from '@/lib/actions/core';

/**
 * Create a custom role, or edit the one passed in.
 *
 * `grantable` is already limited to permissions the person editing holds: the API refuses a
 * role stronger than its author, so offering a checkbox for anything else would only lead
 * to a rejected save.
 */
export function RoleEditor({
  accountId,
  role,
  grantable,
}: {
  accountId: string;
  role?: Role;
  grantable: PermissionDef[];
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  const [name, setName] = React.useState(role?.name ?? '');
  const [description, setDescription] = React.useState(role?.description ?? '');
  const [selected, setSelected] = React.useState<Set<string>>(new Set(role?.permissions ?? []));

  const byKey = React.useMemo(() => new Map(grantable.map((d) => [d.key, d])), [grantable]);

  const groups = React.useMemo(() => {
    const out: Record<string, PermissionDef[]> = {};
    for (const def of grantable) (out[def.group] ??= []).push(def);
    return Object.entries(out);
  }, [grantable]);

  function close() {
    setOpen(false);
    setError(null);
    setName(role?.name ?? '');
    setDescription(role?.description ?? '');
    setSelected(new Set(role?.permissions ?? []));
  }

  function toggle(key: string) {
    setSelected((current) => {
      const next = new Set(current);

      if (next.has(key)) {
        next.delete(key);
        return next;
      }

      // Granting "edit" without "view" makes a user who can save a record they cannot
      // open, so whatever a permission implies comes with it.
      const add = (k: string) => {
        if (next.has(k) || !byKey.has(k)) return;
        next.add(k);
        byKey.get(k)?.implies?.forEach(add);
      };
      add(key);
      return next;
    });
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    startTransition(async () => {
      const res = await saveRole(accountId, role?.id, {
        name: name.trim(),
        description: description.trim(),
        permissions: [...selected],
      });

      if (!res.ok) return setError(res.error);

      setOpen(false);
      if (!role) {
        setName('');
        setDescription('');
        setSelected(new Set());
      }
      router.refresh();
    });
  }

  function onDelete() {
    if (!role) return;
    if (!window.confirm(`Delete the role "${role.name}"?`)) return;

    startTransition(async () => {
      const res = await deleteRole(accountId, role.id);
      if (!res.ok) return setError(res.error);
      setOpen(false);
      router.refresh();
    });
  }

  if (!open) {
    return role ? (
      <button
        onClick={() => setOpen(true)}
        aria-label={`Edit ${role.name}`}
        className="text-fg-subtle transition-colors hover:text-fg"
      >
        <Pencil size={13} />
      </button>
    ) : (
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus size={13} /> New role
      </Button>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-fg/20 p-4 pt-12"
      role="dialog"
      aria-modal="true"
      aria-label={role ? 'Edit role' : 'New role'}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="w-full max-w-xl rounded-card border border-border bg-surface text-left shadow-lg">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-sm font-semibold text-fg">{role ? 'Edit role' : 'New role'}</h2>
          <button
            onClick={close}
            aria-label="Close"
            className="text-fg-subtle transition-colors hover:text-fg"
          >
            <X size={16} />
          </button>
        </div>

        <form onSubmit={onSubmit} className="space-y-3 px-5 py-4">
          {error && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-danger/25 bg-danger-subtle px-3 py-2"
            >
              <AlertCircle size={14} className="mt-0.5 shrink-0 text-danger" />
              <p className="text-[13px] text-danger">{error}</p>
            </div>
          )}

          <div>
            <Label htmlFor="r-name">Name</Label>
            <Input
              id="r-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              minLength={2}
              maxLength={60}
              autoFocus
            />
          </div>

          <div>
            <Label htmlFor="r-description">Description</Label>
            <Input
              id="r-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={300}
              placeholder="What this role is for"
            />
          </div>

          <div className="max-h-[46vh] space-y-3 overflow-y-auto scrollbar-thin rounded-lg border border-border p-3">
            {groups.map(([group, defs]) => (
              <fieldset key={group}>
                <legend className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">
                  {group}
                </legend>
                <div className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
                  {defs.map((def) => (
                    <label
                      key={def.key}
                      className="flex cursor-pointer items-center gap-2 text-[13px] text-fg"
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(def.key)}
                        onChange={() => toggle(def.key)}
                        className="accent-brand"
                      />
                      {def.label}
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
          </div>

          <p className="text-[11px] text-fg-subtle">
            This role is shared by every sub-account in your agency. Changing it changes what
            everyone holding it can do, from their next request.
          </p>

          <div className="flex items-center justify-between gap-2 pt-1">
            {role ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-danger"
                disabled={pending}
                onClick={onDelete}
              >
                Delete
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={close}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={pending || name.trim().length < 2}>
                {pending ? 'Saving…' : role ? 'Save changes' : 'Create role'}
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
