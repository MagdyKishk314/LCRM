/**
 * A short-lived, per-process cache for the records every request reads.
 *
 * Authenticating a request and resolving its tenant context reads the user, their
 * memberships, the sub-account, its agency, the agency's plan and the caller's role — six
 * lookups that change a few times a month and were being fetched from Atlas on every single
 * call, one round trip each, before the handler ran. With the database a hundred-odd
 * milliseconds away that was most of the time a page took to load.
 *
 * The cost, stated plainly: this is per process. A write evicts the entry on the instance
 * that made it (see the hooks in `models/index.ts`), so the admin who flips a module, or
 * suspends someone, sees it at once — but another instance may serve the old value until
 * the TTL runs out. That bounds how long a revoked membership or a suspended user can keep
 * working on a multi-instance deployment: one TTL, and only on instances that had them
 * cached. Anything that cannot tolerate that delay must not read through this.
 */
const TTL_MS = 60_000;

/** Bounded so a long-lived process serving many tenants cannot grow this without limit. */
const MAX_ENTRIES = 5_000;

interface Entry {
  value: unknown;
  expiresAt: number;
}

const store = new Map<string, Entry>();

/** Loads in flight, so a burst of requests for one cold record makes one trip, not several. */
const loading = new Map<string, Promise<unknown>>();

/** Bumped by every eviction; a load that started before one must not store its result. */
let epoch = 0;

/** Read `kind:id` from the cache, or load it and remember the result. */
export async function cached<T>(kind: string, id: string, load: () => Promise<T>): Promise<T> {
  const key = `${kind}:${id}`;
  const hit = store.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value as T;

  const pending = loading.get(key);
  if (pending) return pending as Promise<T>;

  const startedAt = epoch;
  const promise = load()
    .then((value) => {
      // A miss is not remembered: "this account does not exist" must not outlive its
      // creation. Nor is a value read before a write that has since evicted it.
      if (value !== null && value !== undefined && startedAt === epoch) {
        if (store.size >= MAX_ENTRIES) store.clear();
        store.set(key, { value, expiresAt: Date.now() + TTL_MS });
      }
      return value;
    })
    .finally(() => {
      if (loading.get(key) === promise) loading.delete(key);
    });

  loading.set(key, promise);
  return promise;
}

/** Forget one record, or every record of a kind when the id is not known. */
export function evict(kind: string, id?: string): void {
  epoch++;
  // Whoever is waiting on a load keeps their promise; the next caller starts a fresh one.
  loading.clear();

  if (id !== undefined) {
    store.delete(`${kind}:${id}`);
    return;
  }
  for (const key of store.keys()) {
    if (key.startsWith(`${kind}:`)) store.delete(key);
  }
}
