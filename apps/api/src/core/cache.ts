/**
 * A short-lived, per-process cache for the records every request reads.
 *
 * Resolving a request's tenant context reads the sub-account, its agency, the agency's plan
 * and the caller's role — four documents that change a few times a month and were being
 * fetched from Atlas on every single call, one round trip each, before the handler ran.
 *
 * What is cached is deliberately narrow. Users and memberships are *not* here: suspending
 * someone or revoking their access has to take effect on the next request, not thirty
 * seconds later.
 *
 * The cost, stated plainly: this is per process. A write evicts the entry on the instance
 * that made it (see the hooks in `models/index.ts`), so the admin who flips a module sees
 * it at once — but another instance may serve the old value until the TTL runs out. For a
 * module toggle or a role edit that is an acceptable delay; for anything where it is not,
 * do not read through this.
 */
const TTL_MS = 30_000;

/** Bounded so a long-lived process serving many tenants cannot grow this without limit. */
const MAX_ENTRIES = 5_000;

interface Entry {
  value: unknown;
  expiresAt: number;
}

const store = new Map<string, Entry>();

/** Read `kind:id` from the cache, or load it and remember the result. */
export async function cached<T>(kind: string, id: string, load: () => Promise<T>): Promise<T> {
  const key = `${kind}:${id}`;
  const hit = store.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value as T;

  const value = await load();

  // A miss is not remembered: "this account does not exist" must not outlive its creation.
  if (value !== null && value !== undefined) {
    if (store.size >= MAX_ENTRIES) store.clear();
    store.set(key, { value, expiresAt: Date.now() + TTL_MS });
  }
  return value;
}

/** Forget one record, or every record of a kind when the id is not known. */
export function evict(kind: string, id?: string): void {
  if (id !== undefined) {
    store.delete(`${kind}:${id}`);
    return;
  }
  for (const key of store.keys()) {
    if (key.startsWith(`${kind}:`)) store.delete(key);
  }
}
