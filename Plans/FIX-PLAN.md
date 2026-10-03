# Fix plan — FIX-01 → FIX-24

Work order for the problems found in the codebase review of 2026-09-30. Same conventions as
[THE-PLAN.md](../THE-PLAN.md): one ID per change, a state column, and a "Verified" list that
is only filled in from things that were actually run.

**State: implemented, not deployed.** Every item below is built and covered by a test that
was run; see [Verified](#verified) for what was run and [Not verified](#not-verified) for
what was not. Nothing here has touched a real database — before it does, read
[Rolling it out](#rolling-it-out).

The findings came from reading the code. FIX-03 rested on how MongoDB treats a sparse
compound index and was reproduced before the index was changed — the second agency seat
failed with `E11000 … index: userId_1_accountId_1 dup key: { userId: …, accountId: null }`.

## Rolling it out

Three things change shape and need a step at deploy time, in this order:

1. **Deploy the code.**
2. **`sync-indexes`.** Builds the new indexes and drops two the schemas no longer declare:
   the sparse membership index (FIX-03) and the untenanted contact text index (FIX-15).
3. **`migrate:fix-plan`**, dry run first, then `--apply`. Until it has run, contacts that
   existed before the release **cannot be found by search** and existing static lists
   **appear empty**. It also sets drifted do-not-contact records to do-not-contact.

Commands for both deployments are in [docs/DEPLOY.md](../docs/DEPLOY.md#indexes-and-data-migrations).

Behaviour people will notice:

- **Search matches the start of a word.** "smi" finds Smith and "john smith" now finds John
  Smith, but "son" no longer finds Johnson. See FIX-15.
- **Signing out signs out every device** (D2).
- **Deleting a contact deletes its timeline and opportunities** (D4). The confirmation says so.
- **A paused or archived sub-account locks its own team out** (D3), and only the agency can
  change that status.
- **A new sending address must be confirmed** from a link mailed to it before it can send.
- **Ten wrong passwords for one account** locks sign-in for that account for up to 15 minutes.
- **Module toggles and role edits** can take up to 30 seconds to reach other server
  instances (D5).

## Order of work

| Phase | What | Why this order |
|---|---|---|
| 0 | Test harness | Every later fix needs a route-level test to prove it; none exist today |
| 1 | Security and correctness | Cross-account write, compliance (DNC), auth hardening |
| 2 | Data integrity | Orphans, silent data loss, a document-size ceiling |
| 3 | Performance | Per-request overhead and scans; safe only once phase 0 tests exist |
| 4 | Unfinished features and stale docs | Not bugs; scheduled last |

Phases 1 and 2 are independent of each other once phase 0 is done. Phase 3's FIX-17 must land
before FIX-16.

---

## Phase 0 — Test harness

| ID | Change | State |
|---|---|---|
| FIX-00a | Get the workspace running: `npm install`, `npm run typecheck` and `npm test` green as a baseline. No `.env` or Atlas database was needed in the end — the tests carry their own environment and database | done |
| FIX-00b | Add `mongodb-memory-server-core` (replica-set mode, for transactions; the `-core` package so no binary is downloaded during Docker or Vercel builds) and `supertest` to `apps/api`. One helper that boots `createApp()` against it and seeds two agencies, each with two accounts and one user per system role | done |
| FIX-00c | Tenancy plugin tests: every hook in `READ_HOOKS`, `insertMany`, `bulkWrite`, and the no-context throw. This is the isolation boundary and currently has only a manual script ([check-bulkwrite-isolation.ts](../src/server/scripts/check-bulkwrite-isolation.ts)) | done |
| FIX-00d | Turn lint back on in builds: remove `eslint: { ignoreDuringBuilds: true }` from [next.config.ts](../next.config.ts) once `npm run lint` is clean. ESLint was not installed at all, so this added it with Next's config. It found five things; one was a real bug — the "Agency console" link was shown to people who had chosen to enter as a sub-account member, because the variable written to hide it was never used | done |

The two-agency, two-account seed is what makes the phase 1 tests possible: each one is
"user from A attempts X on B and gets 403/404".

---

## Phase 1 — Security and correctness

### FIX-01 · Sub-account admin can edit sibling sub-accounts

**Where:** [core/index.ts](../src/server/modules/core/index.ts) — `GET /accounts/:id`,
`PATCH /accounts/:id`, `PUT /accounts/:id/modules`.

**Cause:** permissions resolve against the `X-Account-Id` account; the handler then acts on
`:id`, requiring only the same agency. `account_admin` holds `core:settings:*`, so it passes
the `PATCH` gate for any sibling.

**Fix:** one helper used by all three routes:

```ts
/** An account-scoped caller may only target the account its permissions were resolved for. */
function assertAccountTarget(ctx: TenantContext, targetId: string) {
  if (ctx.scope === 'account' && targetId !== ctx.accountId) throw notFound('Sub-account');
}
```

Agency and platform scope keep their current reach. 404 rather than 403, matching
[layout.tsx](../src/app/app/[accountId]/layout.tsx), which avoids confirming that an
account exists.

**Test:** account admin of A1 → `PATCH /accounts/A2` with `X-Account-Id: A1` returns 404 and
A2 is unchanged; agency owner doing the same succeeds.

### FIX-02 · Refused Google sign-ins are never audited

**Where:** [auth.routes.ts:194](../src/server/modules/core/auth.routes.ts#L194),
`auditLogSchema` in [models/index.ts](../src/server/models/index.ts).

**Fix:** make `AuditLog.userId` optional (an unauthenticated event has no actor), and replace
the three `.catch(() => undefined)` calls in this file with a catch that logs — an audit write
that fails should be visible, even if it must not fail the request.

**Test:** refused sign-in leaves one `auth.google.refused` row.

### FIX-03 · One agency-level membership per user (verify first)

**Where:** `membershipSchema.index({ userId: 1, accountId: 1 }, { unique: true, sparse: true })`.

**Step 1 — reproduce.** In the harness, create two agency-scoped memberships for one user in
two agencies. If the second insert succeeds, close this item with a note and stop.

**Step 2 — if it fails,** replace the index with two partial ones:

```ts
membershipSchema.index({ userId: 1, accountId: 1 },
  { unique: true, partialFilterExpression: { accountId: { $type: 'string' } } });
membershipSchema.index({ userId: 1, agencyId: 1, scope: 1 },
  { unique: true, partialFilterExpression: { scope: 'agency' } });
```

Run `npm run sync-indexes` against each environment; it drops the old
index. `resolveAgency` then needs a rule for a user with seats in two agencies — take
`X-Agency-Id` when present, as the platform branch already does.

### FIX-04 · Do-not-call state can drift and be bypassed

**Where:** [contacts/index.ts](../src/server/modules/contacts/index.ts) (`PATCH /:id`, bulk
`status` and `dnc`), [email/index.ts:78](../src/server/modules/email/index.ts#L78).

**Fix:**

- One exported predicate, `isDoNotContact(c) => c.dnc || c.status === 'do_not_call'`, used by
  the email send and by anything that later dials or texts. The current check requires both.
- One write helper that keeps the pair in step in every path: setting status `do_not_call`
  sets `dnc`; moving status away from it, or clearing `dnc`, clears the other (see decision D1
  for which status it returns to).
- Email send: when `contactId` is given, refuse if any `to`/`cc` address belongs to a
  do-not-contact contact in this sub-account, not only the named one.
- One-off script to reconcile existing rows where the two disagree, erring towards `dnc: true`.

**Test:** table of (dnc, status) × action, asserting the pair after each write and that send
is refused for every flagged combination.

**Found while fixing — the import was the worst offender.** Every imported row starts from
`status: 'new', dnc: false`, and a row that matched an existing contact wrote those defaults
over it. So re-running a skip-trace file put every do-not-call contact in it back on the dial
list. The same `$set` replaced the contact's whole address with whichever address columns
the file had, and replaced its tags with the file's. Now:

- an import may flag do-not-contact and never lifts it; any other status from the file is
  applied only to a contact that is not flagged, and only when the file actually states one;
- matched rows are updated by dot path and `$addToSet`, so they add to a record;
- two rows for one person in a file are merged field by field rather than the later row's
  defaults undoing the earlier row.

The do-not-contact check on send also covers every `to` and `cc` address whether or not a
contact is named, which is broader than the plan said and is what the rule should be.

### FIX-05 · No rate limiting; refresh tokens survive logout

**Where:** [auth.routes.ts](../src/server/modules/core/auth.routes.ts),
[app.ts](../src/server/app.ts).

**Fix:**

- `express-rate-limit` on `/auth/login`, `/auth/refresh`, `/auth/invite/*`, `/auth/google*`,
  keyed by IP and (for login) by email. The store must be shared, because the Vercel path runs
  many instances: a small TTL-indexed Mongo collection, not the in-memory default.
- `/auth/logout` verifies the refresh token and bumps `tokenVersion`, so a stolen refresh
  token dies with the session (decision D2: this signs out every device).
- `/auth/refresh` refuses suspended users.

**Test:** the Nth login attempt inside the window returns 429; a refresh token is rejected
after logout.

**As built** ([rate-limit.ts](../src/server/core/rate-limit.ts)): sign-in is limited to 10
attempts per account and 100 per address per 15 minutes; refresh to 30 a minute per token;
invite, Google and sender-confirmation endpoints to 60 per address per 15 minutes.

**Known limit.** The per-address limits depend on the API seeing the caller's address. On the
VPS it does — nginx sets `X-Forwarded-For` and the web app now passes it on. On Vercel the web
app calls the API through the platform's edge, which writes that header itself, so every
sign-in appears to come from the function. There, the per-account limit is the one that
works; the per-address limit is effectively a global cap of 100 sign-ins per 15 minutes. If
that is too low for the team, raise `loginByIp`.

The per-account limit also means someone can lock a colleague out for 15 minutes by failing
on purpose. Accepted; the alternative is unlimited guessing.

### FIX-06 · Membership role change skips the agency check

**Where:** `PATCH /agency/memberships/:id` in
[agency.routes.ts](../src/server/modules/core/agency.routes.ts).

**Fix:** lift the role checks out of
[invite-service.ts](../src/server/core/auth/invite-service.ts) into
`assertRoleAssignable(role, agencyId, allowedScopes)` and call it from both. Also refuse
suspending your own agency membership, as delete already refuses revoking it.

### FIX-07 · Opportunity edit skips validation

**Where:** `PATCH /pipelines/opportunities/:id`.

**Fix:** omit `pipelineId` and `stageId` from the patch schema — stage changes go through
`/move`, which validates and writes the timeline entry. If `contactId` is present, confirm the
contact exists in this tenant as create does.

### FIX-08 · Account status is cosmetic

**Where:** `resolveTenant` in [middleware.ts](../src/server/core/auth/middleware.ts).

**Fix:** after membership is chosen, an account-scoped member of a `paused` or `archived`
account gets 403 with a message naming the state. Agency and platform scope pass, or nobody
could un-archive it. `/auth/session` drops such accounts from `destinations` for
account-scoped users (decision D3 covers whether `paused` should be read-only instead).

---

## Phase 2 — Data integrity

| ID | Problem | Fix | State |
|---|---|---|---|
| FIX-09 | Deleting a contact orphans activities, opportunities and list membership | One `deleteContacts(query)` used by single and bulk delete, in a transaction: delete the contacts' activities and opportunities, remove list membership, write counts to the audit row. See decision D4 | done |
| FIX-10 | `PATCH /contacts/:id` with a partial `address` or `property` replaces the whole sub-object | Flatten nested input to dot paths and `contact.set(path, value)` instead of `Object.assign`. Same for `customFields` | done |
| FIX-11 | Static lists keep every member id in one document (16 MB ceiling, and a 400,000-element `$in`) | Move membership onto the contact: `listIds: [String]` with index `{ agencyId, accountId, listIds }`. List filter becomes `{ listIds: id }`, add-to-list becomes one `updateMany $addToSet`, `memberCount` becomes a count. Migration script copies `memberIds` across, then the field is dropped | done |
| FIX-12 | A card dragged out of the last stage stays `won` | In `/move`: leaving the last stage with status `won` sets `open` | done |
| FIX-13 | Import quota check-then-record is not atomic | Record first, then sum the window; if over the limit, delete the row just written and reject. Concurrent chunks can then both be refused, never both accepted | done |

FIX-11 touches `resolveContactQuery`, bulk `addToList`, the import's `listId` path and the
lists manager UI. It is the largest item in this phase and should be its own change.

---

## Phase 3 — Performance

### FIX-14 · Five sequential round trips before every handler

**Where:** `authenticate` + `resolveTenant`.

**Fix:** a small in-process TTL cache (30s) for `Account`, `Agency`, `Plan` and `Role` by id —
they change rarely and are read on every request. `User` and `Membership` stay uncached so
suspension and revocation remain immediate. Writes to the cached models evict their own entry
on the instance that made the write. Expected: 5 sequential trips → 2 on a warm instance.

Cost, to be accepted knowingly: a module toggle or role edit can take up to the TTL to reach
other instances (decision D5).

**Measure:** median latency of `GET /contacts?pageSize=1` before and after, against Atlas.

### FIX-15 · Contact search scans the tenant

**Where:** `buildContactQuery`, `buildSmartListQuery`, `GET /core/search`.

**Planned:** a tenant-prefixed text index. **Not built that way.** Text search matches whole
words only, and the search box queries as you type — "smi" finding nothing until the "th"
arrives would read as broken.

**As built** ([search.ts](../src/server/modules/contacts/search.ts)): each contact carries
`searchTokens` — the lowercased words of its name and company, its email, its APN with and
without separators, and its phone as digits (whole, without a leading 1, last seven, last
four). A search term becomes an anchored, case-sensitive prefix match on that array, which is
a range scan on `{ agencyId, accountId, searchTokens }`. Every word typed must match.

What changes for users: prefixes still work; first and last name together now work (they did
not before — no single field held both); any way of typing a phone works; a fragment from the
middle of a word ("son" for Johnson) no longer matches.

Tokens are rebuilt on every save, set explicitly on import, and backfilled for existing
contacts by `migrate:fix-plan`.

The `explain()` comparison on a 100,000-contact account was **not** done — there was no such
database to run it on. What was checked is that the planner chooses an index scan on
`searchTokens` and no collection scan.

### FIX-16 · Dashboard loads every open opportunity

**Where:** `GET /core/dashboard`.

**Fix:** `$group` by `stageId` for count and value. Depends on FIX-17.

### FIX-17 · The tenancy plugin does not cover `aggregate`

Not a live leak — the only aggregation today is on `Membership`, which is not tenant-scoped —
but the first aggregation on a scoped model would run unfiltered, and FIX-16 is about to add
one.

**Fix:** add a `pre('aggregate')` hook that prepends `{ $match: tenantFilter }` and throws
with no context, mirroring the query hooks. Test it in the FIX-00c suite.

---

## Phase 4 — Unfinished features and stale docs

These are gaps, not defects. Listed so they are tracked, sized roughly.

| ID | Item | Size | State |
|---|---|---|---|
| FIX-18 | Email pages read from the API instead of [mock/data.ts](../src/lib/mock/data.ts); Compose opens a working form; delete the mock file | M | done |
| FIX-19 | Email identity verification — there is no way to mark an identity verified outside the seed. Needs decision D6 | M–L | done |
| FIX-20 | Honour `templateId` on send (or remove it from the schema); send HTML alongside text | S | done |
| FIX-21 | Role CRUD endpoints and editor behind `core:role:manage` | M | done |
| FIX-22 | README says Express 5; the code is on `^4.21.2`. Correct the README | XS | done |
| FIX-23 | [THE-PLAN.md](../THE-PLAN.md) references `apps/api/api/index.ts`, which does not exist | XS | done |
| FIX-24 | Comment at [import-export.routes.ts:152](../src/server/modules/contacts/import-export.routes.ts#L152) says `bulkWrite` is deliberately unused, above code that uses it | XS | done |

---

### What was built for FIX-18 → FIX-21

- **Email (FIX-18).** The email and templates pages read from the API; the mock data file is
  gone. Compose sends for real, with a template picker and a sending-address picker, and a
  contact's page has an Email button that opens it addressed to them. Templates can be
  created, edited and deleted.
- **Sender verification (FIX-19).** Adding a sending address mails it a confirmation link;
  the address cannot send until someone opens the link and clicks confirm. Addresses can be
  re-sent a link, made default and removed. With no SMTP configured the link is shown to the
  admin instead, as invite links are. This proves control of a mailbox, not authority over a
  domain — SPF and DKIM are still the mail provider's to set up.
- **Templates on send (FIX-20).** `templateId` fills in whatever subject or body the request
  leaves out. Mail goes out as text plus an escaped HTML alternative.
- **Roles (FIX-21).** Custom roles can be created, edited and deleted from Settings → Roles.
  Two rules beyond the plan: role management is agency-level only, because a role applies in
  every sub-account that uses it; and nobody can put a permission in a role that they do not
  hold themselves. Built-in roles cannot be changed, and a role people hold cannot be deleted.

---

## Decisions taken

None of these was answered, so each went ahead on its recommendation. All are cheap to
reverse except D4, which deletes data.

| # | Question | Recommendation |
|---|---|---|
| D1 | When DNC is cleared on a contact whose status is `do_not_call`, what status does it return to? | `contacted` — they were reached, which is how they got flagged |
| D2 | Should logout end the session on every device? | Yes for now. Per-device sessions need a session id in the token and a store; defer until someone asks |
| D3 | Is a `paused` account blocked or read-only for its own members? | Blocked, same as `archived`. Read-only needs a write gate on every route |
| D4 | Does deleting a contact delete its opportunities, or refuse while any exist? | Delete, with counts in the audit row. Refusing makes bulk delete unusable |
| D5 | Is up to 30s of staleness on module toggles and role edits acceptable? | Yes. If not, cache only `Plan` and `Role` |
| D6 | How is a sending identity verified? | Depends on the mail provider. With plain SMTP: a confirmation link mailed to the address. With SES/Postmark/Resend: their domain verification API. **Built the plain-SMTP way**, since SMTP is what the app is configured for today |

---

## Verified

Run on 2026-09-30, against an in-memory MongoDB 8.2 replica set. Nothing below was run
against Atlas.

- `npm test`: **156 tests passing** — 25 shared, 120 API, 11 web. 90 of the API tests are
  new; 30 existed.
- `npm run typecheck` clean. `npm run lint` clean.
- `next build` compiles, lints, type-checks and generates every route.
- **Tenancy plugin** ([plugin.test.ts](../src/server/core/tenancy/plugin.test.ts)): every
  query hook, `insertMany`, `bulkWrite` and `aggregate` is scoped; a query with no context
  throws; a forged `agencyId`/`accountId` on create is overwritten.
- **FIX-01:** an account admin patching a sibling sub-account gets 404 and the sibling is
  unchanged; the agency owner doing the same succeeds; another agency's account is 404.
- **FIX-03:** one person holds agency seats in two agencies; a second seat in the same
  agency, or on the same sub-account, is still refused.
- **FIX-04:** all 180 combinations of (flag, status) × requested change leave the pair
  consistent; send is refused for a contact flagged by either signal alone, and for a
  flagged address in `to` or `cc` with no contact named.
- **Import:** a re-import with a plain status leaves a do-not-call contact flagged, keeps its
  street when the cell is blank, merges tags, and keeps list membership.
- **FIX-05:** the 11th wrong password returns 429, and so does the right one; another account
  signs in normally. A refresh token is rejected after sign-out. Replaying a dead token does
  not end a newer session.
- **FIX-08:** pausing a sub-account returns 403 to its member on the next request and 200 to
  the agency owner; reactivating restores access at once.
- **FIX-09:** deleting a contact, singly or in bulk, leaves no activities or opportunities
  behind; the audit row records the counts; another sub-account's contact is untouched.
- **FIX-13:** two uploads racing for the last megabyte are never both accepted, and the
  recorded total stays within the limit.
- **FIX-15:** the query planner uses an index scan on `searchTokens`, with no collection scan.
- **FIX-16/17:** dashboard totals match hand-computed figures and exclude another agency's
  opportunities in the same stages.
- **FIX-19:** an unconfirmed address cannot send; the link works once; a re-sent link
  invalidates the earlier one; an expired link is refused; the token hash is never returned.
- **FIX-21:** a role cannot contain a permission its author lacks; another agency cannot see
  or edit it; a role in use cannot be deleted.
- **Migration:** run against data written in the old shape — a list with `memberIds`,
  contacts with no tokens, two drifted do-not-contact records. Dry run reported 2 / 1 / 3 and
  changed nothing; `--apply` fixed all three; a second `--apply` found nothing to do.
- **The running app**, signed in as the seeded agency owner over HTTP: the email, templates
  and roles pages render from the API; search by name and by phone digits finds the contact;
  a new sending address is confirmed by link and not by merely opening the page; a message is
  sent and appears on the email page; a do-not-contact address is refused; the refresh token
  is dead after sign-out.

## Follow-up, 2026-10-02 — page navigation speed

Measured against the real Atlas cluster from the development machine, where one round trip
to the database costs **~135 ms**. Every page was paying for 15–20 of them in a row.

| | Before | After |
|---|---|---|
| Session call (`/core/auth/session`) | 1,690 ms (7 queries, one after another) | 530 ms (3, the rest parallel or cached) |
| Contacts page, until the skeleton can show | 1,290 ms | 640 ms |
| Contacts page, complete | 2,540 ms | 830 ms |
| Pipelines page, complete | 3,030 ms | 930 ms |
| Dashboard, complete | 1,800 ms | 1,120 ms |

What changed:

- **Session endpoint:** accounts, agencies and roles are fetched together instead of in
  sequence, agencies/roles/plans come through the FIX-14 record cache, and the user loaded
  by `authenticate` is reused rather than fetched again.
- **`getSession` is memoised per request** (`React.cache`), so the layout and the page
  share one call on a full load.
- **Pages fetch their data while the session loads** (`loadPage` in `lib/guard.tsx`)
  instead of after it. A 403 from the data is discarded when the access check fails, so
  the lock screen behaves as before.
- **`GET /pipelines/board`** returns the pipeline list and the selected board in one
  request; the page used to make two in a row.
- **Dev server:** editing `apps/api` now takes effect without a restart. The Express app
  was cached on `globalThis` and survived recompiles; and a recompile gives the API a fresh
  Mongoose instance, so the connection is now tied to the instance that owns it
  (`core/db.ts`) and the previous one is closed.

Still the biggest lever, and not a code change: **the cluster's region.** At 135 ms per
round trip the remaining time is almost all distance. A region near the users would cut
every figure above by roughly two-thirds again. Second: run the production build when not
developing — the "first visit" compile delays (4–7 s per page in dev) do not exist there,
and links are prefetched so the skeleton appears on click.

## Not verified

- **Nothing was run against Atlas**, and nothing was deployed. The first `sync-indexes` on a
  real cluster builds three new indexes on the contacts collection, among others, and drops
  the old text index; on a large collection that takes time.
- **No browser.** Pages were fetched over HTTP and checked for content. The new forms —
  compose, template editor, role editor, sending addresses, sender confirmation — were not
  clicked through. Their server actions call endpoints that are tested, but the forms
  themselves are the least-proven part of this work.
- **No performance measurement.** FIX-14's "5 round trips → 2" and FIX-15's index use are
  established by reading and by `explain()`, not by timing against Atlas.
- **Real mail.** SMTP was off throughout, so no message, HTML alternative or confirmation
  mail was actually delivered.
- **Docker.** `next build` with `output: 'standalone'` fails on this Windows machine at the
  final file-copy step, because creating symlinks needs a privilege the account lacks. It is
  unrelated to these changes and does not affect Linux or Vercel, but it means the Docker
  images were not built here.
- **The rate limiter across instances.** Tested in one process; the store is one atomic
  upsert per request, which is what makes it safe across several, but several were not run.
