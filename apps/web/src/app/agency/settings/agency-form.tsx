'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { updateAgency } from '@/lib/actions/agency';

interface Branding {
  logoUrl?: string;
  primaryColor?: string;
  customDomain?: string;
}

/** AGY-12 — edit the agency record. */
export function AgencyForm({ name: initialName, branding }: { name: string; branding: Branding }) {
  const router = useRouter();
  const [name, setName] = React.useState(initialName);
  const [customDomain, setCustomDomain] = React.useState(branding.customDomain ?? '');
  const [primaryColor, setPrimaryColor] = React.useState(branding.primaryColor ?? '');
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  const dirty =
    name !== initialName ||
    customDomain !== (branding.customDomain ?? '') ||
    primaryColor !== (branding.primaryColor ?? '');

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);

    startTransition(async () => {
      const res = await updateAgency({
        name: name.trim(),
        branding: { customDomain: customDomain.trim(), primaryColor: primaryColor.trim() },
      });

      if (res.ok) {
        setSaved(true);
        router.refresh();
      } else {
        setError(res.error);
      }
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
        <Label htmlFor="a-name">Agency name</Label>
        <Input
          id="a-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          minLength={2}
        />
        <p className="mt-1 text-[11px] text-fg-subtle">
          Shown in the console header and to every user beneath this agency.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="a-domain">Custom domain</Label>
          <Input
            id="a-domain"
            value={customDomain}
            onChange={(e) => setCustomDomain(e.target.value)}
            placeholder="crm.landcaller.com"
          />
        </div>
        <div>
          <Label htmlFor="a-color">Brand colour</Label>
          <Input
            id="a-color"
            value={primaryColor}
            onChange={(e) => setPrimaryColor(e.target.value)}
            placeholder="#E8523A"
          />
        </div>
      </div>

      <p className="text-[11px] text-fg-subtle">
        Branding is stored now but not yet applied to the interface — that arrives with the
        White-label module.
      </p>

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
    </form>
  );
}
