import * as React from 'react';
import { Signal } from 'lucide-react';
import { fetchProviders } from '@/lib/api/providers';
import { LoginForm } from './login-form';

/**
 * CORE-01 — sign in.
 *
 * A server component so it can ask the API which providers are configured. The form itself
 * is a client component and posts to the Next route handler rather than the API directly,
 * so the tokens land in httpOnly cookies and never touch client JavaScript.
 */
export default async function LoginPage() {
  /**
   * Unauthenticated on purpose. `apiGet` redirects to `/login` when there is no access
   * token, which on this page is a loop — see lib/api/providers.
   */
  const providers = await fetchProviders();

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-brand">
            <Signal size={22} className="text-brand-fg" />
          </div>
          <h1 className="font-display text-[26px] leading-tight text-fg">Sign in to LandCaller</h1>
          <p className="mt-1 text-sm text-fg-muted">Land investing, organised</p>
        </div>

        <React.Suspense fallback={<FormSkeleton />}>
          <LoginForm googleEnabled={providers.google} />
        </React.Suspense>
      </div>
    </main>
  );
}

function FormSkeleton() {
  return <div className="h-[292px] rounded-card border border-border bg-surface shadow-sm" />;
}
