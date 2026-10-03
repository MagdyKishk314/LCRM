import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';

/**
 * Invariants about which module owns a capability, checked against the source.
 *
 * The API's counterpart to `src/lib/capabilities.test.ts`. Rules that must hold
 * everywhere are cheap to state and expensive to rediscover — this fails the build at the
 * moment someone reaches around one, with the fix in the message.
 */
interface Capability {
  name: string;
  /** Symbols only the owner may import. */
  restricted: string[];
  /** Files allowed to import them — the owner, and the module that defines them. */
  owner: string[];
  use: string;
}

const CAPABILITIES: Capability[] = [
  {
    name: 'Issuing a session',
    /**
     * Three things prove identity — a password, an invite, a Google account — and they must
     * all produce the same session. A second place minting refresh tokens is how the claims
     * or the cookie quietly diverge, and nobody finds out until one of them fails to refresh.
     */
    restricted: ['signRefreshToken'],
    owner: ['server/core/auth/jwt.ts', 'server/core/auth/session.ts'],
    use: "issueSession() from 'core/auth/session'",
  },
];

const SRC = join(import.meta.dirname, '..');
const APP = join(SRC, '..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    const isSource = /\.ts$/.test(entry.name) && !entry.name.endsWith('.test.ts');
    return isSource ? [full] : [];
  });
}

/** Repo-relative and forward-slashed, so the rules read the same on every platform. */
function id(file: string): string {
  return relative(APP, file).split('\\').join('/');
}

const files = sourceFiles(SRC);

test('every route reaches shared capabilities through their one implementation', () => {
  assert.ok(files.length > 10, `expected to scan the API, found ${files.length} files`);

  for (const capability of CAPABILITIES) {
    for (const file of files) {
      const rel = id(file);
      if (capability.owner.includes(rel)) continue;

      const source = readFileSync(file, 'utf8');
      for (const symbol of capability.restricted) {
        const imported = new RegExp(`import\\s[^;]*\\b${symbol}\\b[^;]*from`, 's').test(source);
        assert.equal(
          imported,
          false,
          `${rel} imports ${symbol} directly.\n` +
            `  ${capability.name} is shared — use ${capability.use} instead,\n` +
            `  so every way of signing in produces the same session.`,
        );
      }
    }
  }
});

test('each capability still points at files that exist', () => {
  const known = new Set(files.map(id));
  for (const capability of CAPABILITIES) {
    for (const owner of capability.owner) {
      assert.ok(known.has(owner), `${capability.name}: owner ${owner} no longer exists`);
    }
  }
});

test('the tenancy escape hatch stays greppable and rare', () => {
  /**
   * `bypassTenantScope` disables the isolation boundary. It is meant to be reviewable in one
   * search, so this pins the set of files allowed to use it — a new one is a deliberate
   * decision, not something that arrives unnoticed in a large diff.
   */
  const allowed = new Set([
    'server/core/tenancy/plugin.ts',
    'server/core/tenancy/context.ts',
    'server/seed.ts',
    'server/scripts/cleanup-test-users.ts',
    'server/scripts/cleanup-bench-contacts.ts',
    'server/scripts/clear-import-quota.ts',
    'server/scripts/check-bulkwrite-isolation.ts',
    // Confirming a sending address from an emailed link: the caller has no session, so
    // there is no tenant until the token has been resolved. One function, one lookup.
    'server/modules/email/verification.ts',
  ]);

  const users = files
    .filter((f) => readFileSync(f, 'utf8').includes('bypassTenantScope'))
    .map(id)
    .filter((f) => !allowed.has(f));

  assert.deepEqual(
    users,
    [],
    'These files bypass tenant scoping without being on the reviewed list. ' +
      'If the use is deliberate, add the file to the list above with a reason.',
  );
});
