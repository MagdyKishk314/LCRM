import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';

/**
 * Architectural invariants for capabilities that more than one screen can reach.
 *
 * This CRM will grow several places to do the same thing — invite a user, send an email,
 * import contacts — and a capability implemented per screen drifts: one screen forgets a
 * step, another renders it somewhere it gets clipped, and the bug only surfaces on the
 * screen nobody tested. So each such capability gets one implementation, and this file
 * fails the build when a screen reaches around it.
 *
 * Adding a capability means adding a row to CAPABILITIES — not remembering a convention.
 */
interface Capability {
  /** What it is, named in the failure message. */
  name: string;
  /** Symbols only the shared implementation may import. */
  restricted: string[];
  /** Files allowed to import them: the shared implementation and the actions themselves. */
  owner: string[];
  /** What a screen should use instead. */
  use: string;
}

const CAPABILITIES: Capability[] = [
  {
    name: 'Inviting a user',
    // Every invite yields a one-time link that is the invited person's only way in until
    // SMTP exists. Calling the action directly skips showing it and strands them.
    restricted: ['inviteUser', 'inviteAgencyUser'],
    owner: ['src/lib/invite/provider.tsx', 'src/lib/actions/core.ts', 'src/lib/actions/agency.ts'],
    use: "useInvite() from '@/lib/invite/provider'",
  },
  {
    name: 'Starting an OAuth sign-in',
    // The state, PKCE verifier and nonce are what make the callback trustworthy. A second
    // place minting them is a second place to get the state check subtly wrong, and the
    // failure mode is login CSRF rather than an error anyone would notice.
    restricted: ['createAttempt', 'decodeAttempt', 'stateMatches'],
    owner: [
      'src/lib/api/oauth-state.ts',
      'src/app/login/google/route.ts',
      'src/app/api/session/google/callback/route.ts',
    ],
    use: 'the /login/google and /api/session/google/callback route handlers',
  },
];

const SRC = join(import.meta.dirname, '..');
const APP = join(SRC, '..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    const isSource = /\.tsx?$/.test(entry.name) && !entry.name.endsWith('.test.ts');
    return isSource ? [full] : [];
  });
}

/** Repo-relative and forward-slashed, so the rules read the same on every platform. */
function id(file: string): string {
  return relative(APP, file).split('\\').join('/');
}

const files = sourceFiles(SRC);

test('every screen reaches shared capabilities through their one implementation', () => {
  assert.ok(files.length > 20, `expected to scan the whole app, found ${files.length} files`);

  for (const capability of CAPABILITIES) {
    for (const file of files) {
      const rel = id(file);
      if (capability.owner.includes(rel)) continue;

      const source = readFileSync(file, 'utf8');
      for (const symbol of capability.restricted) {
        // Only imports count — a local identifier of the same name is not a bypass.
        const imported = new RegExp(`import\\s[^;]*\\b${symbol}\\b[^;]*from`, 's').test(source);
        assert.equal(
          imported,
          false,
          `${rel} imports ${symbol} directly.\n` +
            `  ${capability.name} is shared — use ${capability.use} instead,\n` +
            `  so this screen cannot skip a step the capability depends on.`,
        );
      }
    }
  }
});

/**
 * Pages a signed-out user can reach must not use the session-bound helpers.
 *
 * `apiGet` redirects to `/login` when there is no access token — correct inside the shell,
 * fatal on `/login` itself, where having no token is the normal case. Using it there makes
 * the page redirect to itself, and it renders as a hanging tab rather than an error.
 *
 * This is exactly the bug that shipped when the sign-in page started asking which providers
 * were configured, so it is pinned rather than remembered.
 */
test('pages reachable without a session avoid the authenticated helpers', () => {
  const publicPages = [
    'src/app/login/page.tsx',
    'src/app/login/login-form.tsx',
    'src/app/invite/[token]/page.tsx',
    'src/app/invite/[token]/accept-invite.tsx',
    // Opened from an email by whoever reads that mailbox — often not a CRM user at all.
    'src/app/verify-sender/[token]/page.tsx',
    'src/app/verify-sender/[token]/confirm-sender.tsx',
    'src/lib/actions/verify-sender.ts',
  ];
  const sessionBound = ['apiGet', 'apiGetOptional', 'apiSend', 'getSession'];

  for (const page of publicPages) {
    const file = files.find((f) => id(f) === page);
    assert.ok(file, `${page} no longer exists — update this list`);

    const source = readFileSync(file, 'utf8');
    for (const symbol of sessionBound) {
      const imported = new RegExp(`import\\s[^;]*\\b${symbol}\\b[^;]*from`, 's').test(source);
      assert.equal(
        imported,
        false,
        `${page} imports ${symbol}, which redirects to /login when there is no session.\n` +
          '  On a page reached without a session that is an infinite redirect.\n' +
          "  Use an unauthenticated helper such as fetchProviders() from '@/lib/api/providers'.",
      );
    }
  }
});

test('the invite provider wraps every screen', () => {
  const layout = readFileSync(join(SRC, 'app/layout.tsx'), 'utf8');
  assert.match(layout, /<InviteProvider>/, 'InviteProvider is not mounted in the root layout');
});

test('each capability still points at files that exist', () => {
  const known = new Set(files.map(id));
  for (const capability of CAPABILITIES) {
    for (const owner of capability.owner) {
      assert.ok(known.has(owner), `${capability.name}: owner ${owner} no longer exists`);
    }
  }
});
