/**
 * "Continue with Google".
 *
 * A plain link, not a button with a handler: starting the flow means leaving the site, and
 * `/login/google` is a redirect. Nothing here needs JavaScript, so this stays a server
 * component and works before hydration.
 *
 * The mark is inlined rather than fetched — the artifact CSP aside, an external image on the
 * sign-in screen is a request that can fail and leave a blank square on the one page every
 * user has to get through.
 */
export function GoogleButton({ label = 'Continue with Google' }: { label?: string }) {
  return (
    <a
      href="/login/google"
      className="flex h-10 w-full items-center justify-center gap-2.5 rounded-lg border border-border bg-surface px-4 text-[13px] font-medium text-fg transition-colors hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
    >
      <GoogleMark />
      {label}
    </a>
  );
}

/** Google's four-colour mark, at the size the button uses. */
function GoogleMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden focusable="false">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  );
}

/** The "or" rule between the provider button and the password form. */
export function AuthDivider() {
  return (
    <div className="my-4 flex items-center gap-3">
      <span className="h-px flex-1 bg-border" />
      <span className="text-[11px] uppercase tracking-wide text-fg-subtle">or</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}
