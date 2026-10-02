# The Plan

Current work orders, newest first. [docs/PLAN.md](docs/PLAN.md) is the overall architecture.

- [Contacts II — CNT-13 → CNT-46](Plans/CONTACTS-PLAN.md) — built, not yet deployed
- [Fix plan — FIX-01 → FIX-24](Plans/FIX-PLAN.md) — built, not yet deployed
- [Deploying to Vercel — IMP-09 → IMP-15](#deploying-to-vercel--imp-09--imp-15) — built, not yet deployed
- [Sign in with Google — SSO-01 → SSO-12](#sign-in-with-google--sso-01--sso-12) — built, awaiting Google credentials
- [Import limits — IMP-01 → IMP-08](#import-limits--imp-01--imp-08) — IMP-08 outstanding
- [Pipelines II & the contact record — LOG-01 → LOG-08, PIP-09 → PIP-22](#pipelines-ii--the-contact-record--log-01--log-08-pip-09--pip-22) — planned
- [Invites — INV-01 → INV-06](#invites--inv-01--inv-06) — complete
- [Pipelines — PIP-01 → PIP-08](#pipelines--pip-01--pip-08) — complete
- [Agency console — AGY-01 → AGY-12](#agency-console--agy-01--agy-12) — complete
- [Contacts module — CNT-01 → CNT-12](#contacts-module--cnt-01--cnt-12) — complete
- [Core module — CORE-01 → CORE-12](#core-module--core-01--core-12) — complete

---

# Deploying to Vercel — IMP-09 → IMP-15

**Goal:** the whole project runs on Vercel — web and API — with the 50 MB import intact.

## What had to change, and why

Vercel runs functions, not servers. Two limits made this more than a config exercise:

| Limit | Conflict | Resolution |
|---|---|---|
| Request body ≈ 4.5 MB | The import posted a whole CSV (up to 50 MB) through a Next server action | The browser parses the file and uploads it in chunks — **largest chunk measured: 226 KB** |
| Function duration ≈ 60s | A 100,000-row import measured 2.7–6.5 minutes in one request | Each chunk is its own request — **slowest chunk measured: 4.5s** |
| No persistent process | `apps/api` is an Express server calling `app.listen()` | The web app serves the same `createApp()` from `apps/web/src/app/api/v1/[...path]/route.ts` (see "One project, one origin" below); `src/index.ts` still serves the VPS |
| Cold starts open new pools | `maxPoolSize: 20, minPoolSize: 2` per instance would exhaust Atlas | Pool sizing and failure behaviour now depend on `process.env.VERCEL` |

## The import, rebuilt

`parseCsv` and `suggestMapping` were pure functions with no imports, so they moved to
`@landcaller/shared` and now run in the browser. Three consequences, all improvements:

- **Preview needs no network at all.** It used to upload the entire file to get back a
  header, a sample and a suggested mapping. The mapping step is now instant, and the hourly
  quota is spent only on data that is actually written.
- **Commit uploads 2,000 rows at a time**, with a real progress bar — each chunk reports
  back before the next is sent, so the bar reflects rows genuinely written.
- **A failed chunk is resumable.** The import already matched on `sourceId`, so re-running
  the same file updates rather than duplicating. The wizard says how far it got and that
  re-running is safe, instead of leaving a silent partial import.

Chunks are sent **sequentially, not in parallel** — two chunks describing the same person in
flight at once would each see "not there yet" and insert a duplicate.

The row cap moved from 100,000 to 400,000 as a result. It existed to keep one request inside
a proxy timeout; with no request growing with the file, what limits it now is browser heap
while parsing, and it sits above what a 50 MB file holds so the file size stays the limit a
user actually meets.

## One project, one origin

Vercel initially took this as two projects — one per app — which meant two domains, CORS
between them, and two sets of environment variables to keep in step. It is now **one**.

The Next app serves the API itself. `apps/web/src/app/api/v1/[...path]/route.ts` runs the
same `createApp()` Express application through a small adapter that translates between Web
`Request`/`Response` and Node's `IncomingMessage`/`ServerResponse`. Express is untouched:
same routes, same middleware, same mount point. `apps/api/src/index.ts` still serves it on a
VPS, and both entry points build the app from the same function, so the deployments cannot
drift.

Same-origin is worth having for its own sake — no CORS preflight, no second domain, and the
refresh cookie no longer has to be lifted across origins.

| Setting | Value |
|---|---|
| Root directory | `apps/web` |
| Framework | Next.js (detected) |
| Install command | default — Vercel finds the pnpm workspace at the repository root |
| Build command | default (`next build`) |
| Output directory | default (`.next`) |

Config lives in [apps/web/vercel.json](apps/web/vercel.json). Delete the second Vercel project.

**Why `apps/web` and not the repository root:** Vercel detects Next.js by reading the
`package.json` in the Root Directory, and `next` is a dependency of `apps/web`, not of the
workspace root. With the root as Root Directory the build fails with "No Next.js version
detected". Setting Root Directory to `apps/web` is the supported arrangement for a pnpm
workspace: install still runs at the workspace root, and files outside the Root Directory
(`packages/shared`, `apps/api`) are available to the build.

## Environment variables

One project, so one place to set them. Vercel injects `VERCEL` and `VERCEL_URL` itself.

| Variable | Note |
|---|---|
| `MONGODB_URI` | Atlas connection string |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | Generate fresh ones; do not reuse local values |
| `APP_URL` | `https://<domain>` — builds invite links |
| `NEXT_PUBLIC_APP_URL` | `https://<domain>` — also where the API is reached |
| `CORS_ORIGINS` | `https://<domain>` |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Optional; without them the button is hidden |
| `GOOGLE_REDIRECT_URI` | `https://<domain>/api/session/google/callback` |

`NEXT_PUBLIC_API_URL` is deliberately **unset**. Setting it points the app at a separate
Express deployment, which is what a split or VPS setup wants — leaving it unset serves the
API from this deployment. The same is now true locally, so `pnpm dev` needs only the web
process; the API dev server remains for VPS parity.

**Atlas Network Access must allow `0.0.0.0/0`.** Serverless functions have no fixed egress
IP, so an allow-list of specific addresses fails intermittently and confusingly. If that is
unacceptable, the VPS deployment keeps a fixed IP.

**Add the production redirect URI to the Google Cloud console** before expecting sign-in to
work, exactly as registered for localhost.

## What Vercel costs you here

Worth stating plainly, since it did not go away:

- **A 50 MB import takes ~12 minutes of wall time** (roughly 165 chunks at 4.5s). No single
  request is long, so nothing times out, but the tab has to stay open. A background queue —
  IMP-08 — is what makes that disappear, and it needs a worker Vercel cannot host.
- **Cold starts.** The first request after idle pays a connection setup against Atlas.
- **Nothing is cached.** Every route in this app is `ƒ` — dynamic, per-request — because it
  is an authenticated CRM. Vercel's edge caching has nothing to work with.

The VPS path remains fully supported and unchanged: `src/index.ts`, `output: 'standalone'`,
and `docker-compose.yml` all still work, and the chunked import is an improvement there too.

## Work order

| ID | Feature | State |
|---|---|---|
| IMP-09 | `parseCsv` / `suggestMapping` moved to `@landcaller/shared`, preview runs in the browser | done |
| IMP-10 | Chunked commit endpoint, with offsets so error rows name the spreadsheet line | done |
| IMP-11 | Wizard parses locally, uploads sequentially, shows real progress, resumable on failure | done |
| IMP-12 | Express served from a Next catch-all route, with a cached connection on `globalThis` | done |
| IMP-13 | Connection pool and boot-failure behaviour depend on the runtime | done |
| IMP-14 | `vercel.json` and `.vercelignore` in `apps/web` (the Root Directory), conditional `output: standalone` | done |
| IMP-15 | Same-origin API by default, so no CORS and one set of environment variables | done |

## Verified

Against the live API, measured rather than assumed:

- 6,000 rows imported in chunks — 6,000 created, 13.1s total.
- **Largest chunk 226 KB** against a ~4.5 MB cap; **slowest chunk 4.5s** against a 60s
  budget. Roughly 20× and 13× headroom.
- Retrying a chunk reported 0 created, 2,000 updated — resumable, not duplicating.
- A retried chunk is not charged to the quota twice.
- A nameless row is skipped rather than failing its chunk; a chunk over 2,000 rows is refused.
- Through the merged route: GET and POST, JSON bodies, query strings, custom headers,
  `Authorization`, error envelopes with their status codes, 404s from Express, and
  `Set-Cookie` arriving intact with `HttpOnly` and its path — the header most likely to be
  mangled by an adapter, since it is the one that legitimately repeats.
- A full 225 KB import chunk through the merged route: 2,000 rows created in 4.2s.
- `pnpm -r typecheck` clean, 66 tests passing, the build succeeds.

Not verified: an actual deployment. Everything above ran locally, so the first deploy is
still the first deploy.
---

# Sign in with Google — SSO-01 → SSO-12

**Goal:** "Continue with Google" on the sign-in screen, and on an invite, without adding a
second idea of who a user is.

## The decision that shapes everything else

**OAuth lives in the Express API, not in NextAuth.**

NextAuth/Auth.js is the obvious reach, and it is the wrong fit here. It owns a session — and
a session in this system is not "who are you", it is "who are you, in which of your
memberships, with which permissions and which modules". That resolution lives in the API:
`pickMembership`, `strongestMembership`, `destinations`, the entitlement intersection, the
`tokenVersion` revocation, the audit trail. Adding NextAuth means either duplicating all of
that in the web app or bridging two session models — a second source of truth about identity,
in a multi-tenant CRM. That is the failure mode [docs/PLAN.md §7](docs/PLAN.md) exists to
prevent, and it is what "cleanly, without affecting scalability" is really asking about.

So Google slots in beside password and invite as a **third way to prove who you are**, feeding
the one path that already turns proof into a session:

```
password ─┐
invite   ─┼─→ issueSession(user)  →  access + refresh JWT  →  same two httpOnly cookies
Google   ─┘        (API)                                            (Next)
```

Everything downstream — `/choose`, tenancy, permissions, refresh, logout — is untouched.

## Flow

```
1  Browser    GET /login/google                    Next route handler
2  Next       sets state + PKCE verifier + nonce   one short-lived signed httpOnly cookie
3  Next       302 → accounts.google.com            authorization code flow + PKCE
4  Google     302 → /api/session/google/callback   with code + state
5  Next       verifies state, POSTs code to API    server-to-server
6  API        exchanges code, verifies ID token    iss, aud, exp, nonce, email_verified
7  API        resolves the user (see below)        no user is ever created here
8  API        issues access + refresh JWT          identical to password login
9  Next       sets lc_at + lc_rt, redirects        → / or /choose
```

Steps 8 and 9 are the existing code, called — not reimplemented.

## Scalability

The concern with OAuth is usually the per-login state. Three choices keep this flat:

| Concern | Choice | Why |
|---|---|---|
| `state` / PKCE verifier / nonce | one signed, httpOnly, 10-minute cookie | An in-memory store breaks the moment there are two API instances; a database store adds a write and a read to every *attempted* login, including abandoned ones. A cookie costs nothing and scales horizontally for free. |
| Session | unchanged — stateless JWT | No session table appears. Google verifies once, at login. |
| Google's public keys | cached in-process with TTL | ID token signature checks stay local; `google-auth-library` handles the JWKS cache. |
| Per-request cost | none | After step 8 a Google-authenticated request is byte-identical to a password-authenticated one. |

Net effect on steady-state load: nothing. The work happens once, at sign-in.

## Who is allowed in

**Google sign-in never creates a user.** This is a closed B2B CRM with no self-serve signup —
if it provisioned on first sign-in, anyone with a Google account would have a login. A Google
identity resolves against what already exists:

| Situation | Outcome |
|---|---|
| Linked identity for this Google subject | Sign in |
| No link, verified email matches an **active** user | Link on first use, then sign in, audited |
| No link, verified email matches an **invited** user | Accept the invite via Google — no password ever set |
| Email not verified by Google | Refuse |
| No matching user | Refuse: "ask your administrator for an invite" |
| User suspended | Refuse, same message as password login |

The invited case is worth calling out: someone invited today has to open a link and choose a
password. With this, they can click "Continue with Google" and be done, and the invite token
is consumed exactly as it is now — single use, cleared on acceptance.

## Account linking, and why the rules are strict

Automatic linking on email is the classic account-takeover route: an attacker creates a Google
identity carrying the victim's address at a provider that never verified it, signs in, and
owns the CRM account. Two rules close it:

- **`email_verified` must be true.** Google sets it false for some Workspace and alias
  configurations. No exceptions, no override.
- **The email must match an existing user exactly**, lowercased, as the login already does.

Given both, linking is safe here and is the right default: this is a CRM where an
administrator deliberately invited that address, so the address *is* the identity.

Unlinking exists, and is refused when it would leave someone with no way to sign in — a
Google-only user must set a password before unlinking, or they lock themselves out. Linking
and unlinking are both audited, and unlinking bumps `tokenVersion` so existing sessions die.

## Data model

```ts
identities: [{ provider: 'google', subject, email, linkedAt }]   // on User
```

A subdocument array rather than a separate collection: a user has a handful of identities,
they are always wanted alongside the user, and it keeps sign-in one query. A separate
collection earns its place when identities have their own lifecycle — many providers, SCIM
provisioning — and this can move later without touching callers, because the resolution sits
behind one function.

Unique index on `{ provider, subject }`, so one Google account cannot be attached to two users.

**`passwordHash` has to stop being required.** It is `required: true` today, which is why the
invite flow stores an unusable random hash as a placeholder. A Google-only user genuinely has
no password, so the field becomes optional and the invariant moves up: *a user must have at
least one credential* — a password or a linked identity. `verifyPassword` must also stop
assuming a hash exists; comparing against `undefined` currently escapes the constant-work
property that keeps password login from revealing which emails exist.

## What is deliberately not being built

- **No NextAuth**, for the reason above.
- **No session table.** Tokens stay stateless.
- **No self-serve signup.** Invitation remains the only way in.
- **No "sign in with Google" on the API's own origin.** The callback lands on the Next origin,
  where the session cookies live, exactly like password login.
- **No implicit flow.** Authorization code + PKCE, which is the current recommendation even
  for confidential clients.

## Configuration

`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` join the env schema, with
placeholders in `.env.example`. The redirect URI must be registered in Google Cloud Console
for both `http://localhost:3000` and `https://crm.landcaller.com`. The button only renders
when the client id is configured, so a deployment without it shows the password form
unchanged rather than a broken button.

## Work order

| ID | Feature | State |
|---|---|---|
| SSO-01 | `identities[]` on User, unique on `{provider, subject}`; `passwordHash` optional with a has-a-credential invariant | done |
| SSO-02 | `issueSession(user)` extracted, so password, invite and Google share one token/cookie path | done |
| SSO-03 | State + PKCE + nonce cookie, with expiry and single use | done |
| SSO-04 | `GET /login/google` — build the authorization URL and redirect | done |
| SSO-05 | `POST /core/auth/google` — code exchange, ID token verification, claim checks | done |
| SSO-06 | Resolution rules: linked → active+verified → invited → refuse, as the table above | done |
| SSO-07 | `/api/session/google/callback` — verify state, call the API, set cookies, redirect | done |
| SSO-08 | "Continue with Google" on the sign-in and invite screens, hidden when unconfigured | done |
| SSO-09 | `GET /identities`, `DELETE /identities/:provider` with the lockout guard | API done, settings UI outstanding |
| SSO-10 | Audit: link, unlink, invite-accepted, and every refusal reason | done |
| SSO-11 | Tests — the resolution table, state cookie round trip, capability guards on both sides | done |
| SSO-12 | Env, `.env.example`, and the Cloud Console redirect URIs for both origins | env done, console pending |

## Verified

- The resolution table as pure logic — 10 cases including the takeover route (an unverified
  email matching a real user) and link-beats-email when a Google address changes.
- The state helpers — entropy, S256 challenge, malformed cookie, and that a length mismatch
  is rejected rather than throwing out of `timingSafeEqual`.
- `pnpm --filter @landcaller/api check:identities` against a real database: a provider-only
  user saves, an active user with no credential is refused, an invited one is exempt, two
  users cannot claim one Google account, users *without* identities do not collide on the
  sparse index, `verifyPassword` answers false without throwing, and unlinking the last
  credential is refused.
- Live: unconfigured Google fails as a clean 400 rather than a crash, and password login,
  its cookie flags, its identical wrong-password/unknown-email answers, and membership
  resolution are all unchanged by the `issueSession` refactor.
- Both capability guards fail when bypassed — confirmed by bypassing them.

## Left to do

- **Google Cloud credentials.** Nothing is exercised end to end against Google until a client
  id, secret and redirect URI exist. Until then `/core/auth/providers` reports `false` and the
  button does not render, which is the intended unconfigured state.
- **The settings screen for SSO-09.** The endpoints exist and are tested; there is no UI yet
  to see or remove a linked account.
- **Confirm `email_verified` for the LandCaller Workspace domain** before relying on this —
  see the risk below.

## Risks

- **`email_verified` is not universally true**, including for some Google Workspace domains.
  Users in that position will be told to sign in with a password instead. Worth confirming
  against LandCaller's own Workspace before rollout, since the team is the first audience.
- **One Google account, two CRM users** (a personal and a work address) is not a conflict —
  they are different identities — but *one address on two CRM users* cannot happen anyway, as
  `email` is already unique.
- **The `identities` array makes User writable from a new path.** It is a
  `select`-safe, non-secret field, but linking must go through one function so the uniqueness
  check and the audit entry cannot be skipped.
- **Google is now in the login path.** If it is unreachable, password login must still work —
  which it does, because the button is additive and the flow is separate. Worth an explicit
  test that the sign-in page renders and functions with the provider misconfigured.

---

# Import limits — IMP-01 → IMP-08

**Goal:** import files up to 50 MB, with a per-sub-account hourly ceiling so a large upload
limit is not also a large attack surface.

## The bug

`Body exceeded 1 MB limit.` A CSV posts through a Next server action, whose default body
limit is 1 MB — so the wizard's own 20 MB check never got a chance to run, and the error came
from the framework with nothing the app could say about it.

Four limits sat in the path and none agreed:

| Boundary | Was | Now |
|---|---|---|
| Browser check | 20 MB | 50 MB |
| Next server action | **1 MB** (default) | 72 MB |
| Express JSON body | 25 MB | 72 MB |
| Import row cap | 20,000 rows | 100,000 rows |

They now come from `packages/shared/src/limits.ts`. `next.config.ts` is the one place the
value has to be repeated — Next loads its config before workspace packages are transpiled —
so `limits.test.ts` fails the build if the two drift.

The transport limit is deliberately above the file limit: a CSV travels as a JSON string, and
escaping plus RSC encoding inflate it past the file's own size.

## The quota

100 MB per sub-account per hour, measured over a sliding window rather than a calendar hour.

- **Bytes, not requests.** The cost and the risk are both volume; ten 10 MB files are the
  same load as one 100 MB file.
- **Per sub-account**, so a compromised login inside one client cannot spend another
  client's headroom, or the agency's.
- **Identical content is charged once.** The wizard sends the CSV to preview it and again to
  commit it. Charging both would make a 100 MB quota mean 50 MB of real imports, contradicting
  the 50 MB file limit. Distinct payloads are charged in full, which is the case that matters.
- Rejections say what was used, what the limit is, and when to retry, and carry `retryAt` for
  the UI.

Usage rows live in `UsageEvent` with a TTL index, so nothing has to reset a counter — a reset
that fails leaves a tenant either throttled forever or not at all.

## Making 50 MB actually work

Raising the limit exposed that the import could not survive the files it now accepted. It ran
one `findOne` plus one write **per row**, two Atlas round trips each, at ~140 ms per round
trip. A 12,000-row file took 25 seconds to insert; re-importing it never returned.

Measured, then fixed:

| Change | Effect |
|---|---|
| Batch rows (2,000 per trip) instead of one at a time | round trips fall from 2/row to ~2/2,000 |
| `lean()` + projection on the match query | 4.42 → 0.88 ms/row; hydrating contacts with nested address and property subdocuments was the single largest cost |
| Index `{agencyId, accountId, sourceId}` | the existing index puts `sourceSystem` before `sourceId`, so a lookup by `sourceId` alone could only use the tenant prefix and then scanned |
| `bulkWrite` for the update path | one round trip per batch instead of one per row |

Result: **1.64 ms/row** for new contacts, **3.88 ms/row** for a re-import that matches every
row — down from ~14 ms/row and an unbounded update path.

### bulkWrite had to be made safe first

`bulkWrite` carries its own per-operation filters and documents, so none of the tenancy
plugin's hooks saw it: filters went untenanted and inserted documents would have landed with
no `agencyId` at all, skipping validation entirely. It is now rewritten by the plugin —
inserts stamped, filters narrowed — and `pnpm --filter @landcaller/api check:bulkwrite`
proves against a real database that a cross-tenant write does nothing, that an empty filter
stays inside the caller, and that no context at all throws.

## What 50 MB does not buy

A 50 MB contact CSV holds roughly 330,000 rows. At the measured rate that is 9–21 minutes in
one request. The row cap is therefore **100,000** — about 2.7 minutes for new data, 6.5 for a
full re-import — and a larger file is refused with its row count rather than accepted and
abandoned part-written.

So the 50 MB limit is real for wide files (many columns, fewer rows) and the row cap binds
first on narrow ones. Lifting it means moving the import to the queue, where it belongs.

## Deployment note

`server.requestTimeout` is raised to 15 minutes. **Any reverse proxy in front of the API
needs a matching `proxy_read_timeout`** — nginx defaults to 60 seconds, which would sever a
large import mid-write and leave the user with no result and a partly-written file.

## Work order

| ID | Feature | State |
|---|---|---|
| IMP-01 | One source of truth for every limit, with a drift test | done |
| IMP-02 | 50 MB uploads end to end: browser, Next, Express | done |
| IMP-03 | `UsageEvent` with a TTL index, and the sliding-window quota | done |
| IMP-04 | 100 MB/hour per sub-account, content-hash deduped, on preview and commit | done |
| IMP-05 | Batched import writes, lean match query, `sourceId` index | done |
| IMP-06 | Tenant-scoped `bulkWrite`, with an isolation check against a real database | done |
| IMP-07 | Request timeouts sized for a large import | done |
| IMP-08 | Move large imports to a background job, and lift the row cap | **not started** |

---

# Pipelines II & the contact record — LOG-01 → LOG-08, PIP-09 → PIP-22

**Goal:** opportunities behave the way they do in GoHighLevel — always anchored to a contact,
created from either the board or the contact record, with explicit status and a configurable
pipeline — and everything that happens to a contact appears on that contact's page,
including things not built yet, like appointments.

## What already exists

More than the request assumes, which narrows the work considerably.

- **Multiple pipelines already work.** `Pipeline` is tenant-scoped with its own `stages[]`,
  and `POST /pipelines`, `PATCH /pipelines/:id`, `DELETE /pipelines/:id` are live. The
  toolbar creates and renames them, `StageEditor` edits stages, and the switcher moves
  between them. Stage ids are preserved across edits and a stage with cards in it cannot be
  deleted — the hard parts are done.
- **The contact link is already the model.** `Opportunity.contactId` is `required`, and
  `POST /opportunities` refuses a contact that does not exist. Tenant scoping means it must
  be a contact in the same sub-account. `Opportunity` is indexed on `{ contactId }`, and the
  contact detail endpoint already returns that contact's opportunities. One contact, many
  opportunities, in the same pipeline or different ones, is what the schema says today.
- **The contact timeline exists.** `Activity` is a single tenant-scoped collection indexed
  `{ contactId, occurredAt: -1 }`, and the contact page renders it.

## The gaps

### 1. The link is enforced on create and nowhere else

`PATCH /opportunities/:id` takes `opportunityBodySchema.partial()` — which includes
`contactId`, `pipelineId` and `stageId` — and does `Object.assign()` then `save()` with no
validation at all. The create path checks all three; the update path checks none. An update
can point an opportunity at a contact that does not exist, a pipeline that does not exist, or
a stage belonging to a different pipeline.

`DELETE /contacts/:id` and the bulk delete do not touch opportunities. Deleting a contact
leaves its opportunities on the board pointing at nothing — the board's contact join simply
returns fewer contacts than cards, and the card renders with no name.

Both are the same failure: the rule lives at one call site instead of with the data.

### 2. Nothing links a contact to a *new* deal

The board's opportunity form lists only contacts that already have an opportunity — its own
comment admits this: *"Adding a deal for a brand-new owner starts from their contact page."*
That page has no such button, and its Opportunities card is hidden entirely when the contact
has none. The documented route in does not exist.

### 3. The opportunity is thinner than GoHighLevel's

No detail view (PIP-08 was left endpoint-only), no way to mark won or lost despite the
`status` enum and `lostReason` field existing, no `source`, no owner assignment in the UI, no
column totals, no filters, no list view, and no way to move a deal to a different pipeline.

### 4. Activity logging is written by hand at each call site, and already has holes

| Activity type | Written by |
|---|---|
| `note`, `call`, `email`, `sms` | the composer, manually |
| `created` | contact create, opportunity create |
| `status_change` | contact status only |
| `stage_change` | opportunity move |
| `field_change` | **nothing** |
| `list_added`, `task` | **nothing** |

Editing a contact's phone, address or acreage logs nothing. `PATCH /opportunities/:id` logs
nothing at all — value, owner and close date all change silently. Five of eleven declared
types have no writer.

This is the per-call-site pattern [docs/PLAN.md §7](docs/PLAN.md) was written about, and it
will keep drifting: when calendars land, booking an appointment will log nothing unless
somebody remembers to add a line.

## GoHighLevel parity — the target behaviour

| Behaviour | GHL | Here today |
|---|---|---|
| An opportunity belongs to exactly one contact | required | ✅ required, validated on create |
| A contact has zero, one or many opportunities, across pipelines | yes | ✅ schema and index support it |
| Status is **explicit**: Open / Won / Lost / Abandoned | set by the user, independent of stage | ⚠️ enum exists, nothing sets it |
| Moving stages does not change status | correct | ✅ (nothing changes status at all) |
| Fields: name, contact, pipeline, stage, lead value, owner, source | all present | ⚠️ no `source`, owner not settable in UI |
| Board column shows count and total value | yes | ❌ |
| Kanban / list view toggle | yes | ❌ Kanban only |
| Filter by owner, status, source, date, search | yes | ❌ |
| Opportunity opens a detail panel | yes | ❌ |
| Move an opportunity to another pipeline | yes, stage re-picked | ❌ |
| Contact record lists its opportunities and creates new ones | yes | ⚠️ lists them, cannot create, hidden when empty |

**Correction to the earlier plan.** The previous draft proposed deriving status from the stage
(marking stages as won/lost). GoHighLevel does the opposite — status is an explicit control,
and an opportunity can be marked Won from any stage. Since the instruction is to copy GHL,
that item is reversed: status and stage stay independent, and the work is to add the explicit
control rather than to couple them. The reconciliation risk it carried disappears with it.

## Design

### Referential integrity belongs with the data

The update path gets the same validation as create, and both move into one
`resolveOpportunityTarget()` helper so a third writer cannot skip it — the same reasoning as
`contactFilterSchema`, which already exists so that list, export and bulk delete can never
disagree about which rows they are acting on.

Contact deletion has to make an explicit choice rather than leave orphans. Proposed: refuse
to delete a contact that has open opportunities, and name them in the error — deleting a
person should not silently destroy the deal attached to them. Bulk delete already requires
`expectedCount`; this becomes part of the same check.

### The activity spine

Two pieces, so a change logs itself:

- **`recordActivity()`** becomes the only writer of the collection. It reads the acting user
  from the tenant context (`TenantContext.userId`, already in `AsyncLocalStorage`), so no
  caller passes an actor and no caller can attribute a change to the wrong person.
- **A `trackChanges` Mongoose plugin** on `Contact` and `Opportunity` diffs a document on
  save and emits `field_change` entries from the modified paths. A route that edits a
  contact logs the edit by existing, not by remembering.

Two things the plugin cannot see, handled explicitly:

- `updateMany` / `deleteMany` skip document middleware. The import, bulk-edit and bulk-delete
  paths must log themselves — the same blind spot behind the bulk delete that wiped a
  sub-account with no audit entry to explain it.
- Meaning a diff cannot express: won, lost with a reason, deleted. These stay explicit calls
  with their own types.

A whitelist of tracked fields with human labels keeps the timeline readable and stops it
filling with `updatedAt` and `lastActivityAt` noise. `ActivityType` also gains reserved
entries for `appointment_*` and `task_*` now, so the calendars module writes to a timeline
that already renders them.

### One way to create an opportunity

The board and the contact record are two entry points to the same capability, so per
[docs/PLAN.md §7](docs/PLAN.md) they get one implementation: `useCreateOpportunity()` and a
shared `<OpportunityForm>`, with a row in `CAPABILITIES` so a third entry point cannot fork
it. From the contact record the contact is fixed and the pipeline is chosen; from the board
the pipeline is fixed and the contact is searched.

## New endpoints

| Method | Path | For |
|---|---|---|
| `POST` | `/opportunities/:id/status` | PIP-14 — won, lost with reason, abandoned, reopened |
| `PATCH` | `/opportunities/:id/pipeline` | PIP-17 — move to another pipeline, stage re-picked |
| `GET` | `/contacts/:id/opportunities` | PIP-11 — with pipeline and stage names resolved |
| `PATCH` | `/pipelines/:id/archive` | PIP-22 — retire a pipeline that has history |

## Work order

### A · The contact ↔ opportunity link

| ID | Feature |
|---|---|
| PIP-09 | `resolveOpportunityTarget()` — create and update validate contact, pipeline and stage identically |
| PIP-10 | Deleting a contact with open opportunities is refused and names them; no orphans |
| PIP-11 | Contact record: Opportunities section always visible, with pipeline, stage, value, status |
| PIP-12 | `useCreateOpportunity()` + shared `<OpportunityForm>`, one implementation, guarded |

### B · The opportunity, GHL-style

| ID | Feature |
|---|---|
| PIP-13 | Opportunity detail panel — name, value, owner, source, close date, contact link |
| PIP-14 | Explicit status: Won / Lost / Abandoned / reopen, with lost reason. Stage unaffected |
| PIP-15 | `source` on the model, set on create, shown and filterable |
| PIP-16 | Owner assignment from the UI |
| PIP-17 | Move an opportunity to another pipeline, choosing its stage there |
| PIP-18 | Contact picker searches every contact, not only those already on the board |

### C · The board

| ID | Feature |
|---|---|
| PIP-19 | Stage column headers show count and total value |
| PIP-20 | Filters: owner, status, source, date range, search |
| PIP-21 | List view toggle alongside Kanban |
| PIP-22 | Pipeline settings screen — name, stages, default, currency, archive |

### D · Activity spine

| ID | Feature |
|---|---|
| LOG-01 | `recordActivity()` — the single writer, actor resolved from tenant context |
| LOG-02 | `trackChanges` plugin on Contact and Opportunity — edits log themselves |
| LOG-03 | Tracked-field whitelist with labels, so entries read "Phone changed", not JSON |
| LOG-04 | Bulk, import and delete paths log explicitly — document middleware does not fire |
| LOG-05 | Events a diff cannot express: won, lost with reason, deleted, reassigned |
| LOG-06 | Timeline filters by type, with system changes collapsible |
| LOG-07 | API guard test — `Activity.create` outside the service fails the build |
| LOG-08 | `ActivityType` extended and reserved for calendars and telephony |

## Suggested order

**D first.** The activity spine is the only group everything else writes into — build it
first and groups A–C log themselves as they land, instead of each needing logging retrofitted.
Then **A** (integrity and the contact route in, which is the request's core), then **B**, then
**C** as polish.

## Risks

- **Timeline flooding.** Auto-logging every field change can bury the notes people actually
  read. Mitigated by the whitelist (LOG-03) and filters (LOG-06); if it still reads noisy,
  collapse consecutive edits by the same user within a few minutes into one entry.
- **History starts at deploy.** Existing contacts have no `field_change` past. The timeline
  will look thin on old records; nothing to backfill from.
- **Refusing to delete a contact with open opportunities is a real behaviour change** and may
  annoy someone clearing junk leads. The alternative — cascade-deleting the deal — destroys
  revenue history to tidy a contact, which is worse. Open to reversing if it proves wrong in
  practice.
- **Every change becomes a write.** Editing a contact goes from one write to two. Fine at
  current volume; worth revisiting if import ever routes through document middleware.

---

# Invites — INV-01 → INV-06

**Goal:** an invited user can actually sign in.

## The problem

Inviting someone created a user with `passwordHash: hash(randomUUID() + randomUUID())` and
`status: 'invited'`. That hash matches nothing by design, no email is configured, and there
was no password-reset screen — so every invited user was created into a dead end. The invite
form never asked for a password and never produced one.

## How it works

A one-time token, not a generated password. `generateInvite()` returns 32 random bytes
base64url-encoded; only its SHA-256 hash is stored on the user (`inviteTokenHash`,
`select: false`) alongside `inviteExpiresAt`. The raw token is returned to the admin exactly
once, as a link, and the admin passes it on by hand. A stolen database row yields nothing
usable.

Accepting sets the password, flips the user to `active`, clears the token — so the link
works once — and signs them straight in. Asking someone to re-type a password they chose a
second ago is friction for nothing.

`APP_URL` decides the link's host, so it points at the app rather than the API.

## Work order

| ID | Feature |
|---|---|
| INV-01 | Token generation, hashing and 7-day expiry (`core/auth/invites.ts`) |
| INV-02 | `GET /core/auth/invite/:token` — look up without consuming |
| INV-03 | `POST /core/auth/invite/accept` — set password, activate, sign in |
| INV-04 | `/invite/[token]` — the acceptance screen |
| INV-05 | `<InviteLink>` — the admin sees and copies the link, on all three invite forms |
| INV-06 | Re-inviting a pending user reissues; an active user is refused |
| INV-07 | One implementation, server and client — see [docs/PLAN.md §7](docs/PLAN.md) |

## What INV-06 fixed

Both invite handlers rotated the invite token *before* checking whether the membership
already existed. Re-inviting someone who was already pending therefore invalidated the link
the admin was still holding and then returned `409` — no new link, old link dead, user
stranded. The membership check now runs first: a pending user gets a genuine resend (`200`
with a fresh link, audited as `*.invite_resend`), and an active user is refused with `409`
and no token change, because handing them a password-setting link is a reset, not an invite.

## What INV-07 fixed

The link was rendered by each of the three invite forms. One of them mounts inside a page
header's action strip (`flex shrink-0`), so there the link rendered squeezed against the
right edge and was effectively invisible — an invite that looked like it did nothing.

Rendering it per screen was the mistake, not that screen's markup. There is now one owner
on each side:

- `core/auth/invite-service.ts` — the two routes became adapters. They decide who may call
  and which role scopes that surface permits; everything that must never differ lives in
  the service. The reorder from INV-06 had to be made twice; it now exists once.
- `lib/invite/provider.tsx` — `useInvite()` calls the action, shows the link in a dialog
  mounted at the root layout, and refreshes. Screens keep only their inline errors.

`apps/web/src/lib/capabilities.test.ts` fails the build if a screen imports the invite
actions directly, and names the fix in the failure. Verified by making it fail.

## Once SMTP exists

The link gets emailed and `<InviteLink>` becomes a convenience rather than the only route
in. Nothing else changes — the token, the acceptance screen and the single-use rule are
already the parts that matter.

---

# Pipelines — PIP-01 → PIP-08

**Goal:** many pipelines per sub-account, GoHighLevel-style — each with its own stages and
its own opportunities, switchable from the board.

## What already exists

The data model was built for this and never exercised. `Pipeline` is a tenant-scoped
collection, each row carrying its own `stages[]`; `Opportunity.pipelineId` points at one.
`GET /pipelines`, `POST /pipelines` and `GET /pipelines/:id/board` are live and tested.

**The gap is entirely frontend.** The board renders `generatePipeline()` — a single
hardcoded mock — so there is no picker, no way to create one, and drag-and-drop moves
cards in local state only: `PATCH /opportunities/:id/move` exists and is never called.

## New endpoints

| Method | Path | For |
|---|---|---|
| `PATCH` | `/pipelines/:id` | PIP-05 — rename, and edit the stage list |
| `DELETE` | `/pipelines/:id` | PIP-06 — remove a pipeline |

## Work order

| ID | Feature |
|---|---|
| PIP-01 | Board reads a real pipeline from the API |
| PIP-02 | Drag-and-drop persists, and rolls back if the request fails |
| PIP-03 | Pipeline switcher — move between pipelines, remember the last one in the URL |
| PIP-04 | Create a pipeline, with sensible starting stages |
| PIP-05 | Stage editor — add, rename, reorder, recolour, set win probability |
| PIP-06 | Delete a pipeline |
| PIP-07 | New opportunity, against a contact and a stage |
| PIP-08 | Edit an opportunity; mark won or lost |

## Decisions

- **Stage ids are permanent.** Renaming or reordering a stage keeps its `id`, because
  every opportunity references it. Regenerating ids on save would silently strand every
  card in the pipeline.
- **Deleting is refused while it would orphan something.** A pipeline with opportunities,
  or a stage with cards, cannot be deleted — the response says how many are in the way.
  Cascading the delete is the alternative, and quietly destroying a client's deal history
  to satisfy a tidy-up is not a trade worth making.
- **One default pipeline per sub-account.** Setting a new default clears the old one, so
  the board always has somewhere to land.
- **Moves are optimistic.** The card follows the cursor immediately and reverts if the
  server rejects it; waiting on a round trip for every drag makes the board feel broken.

## Done when

- [x] A sub-account can hold several pipelines, each with its own stages and cards
- [x] Switching pipelines is one click and survives a reload
- [x] A drag persists — reloading shows the card in its new stage
- [x] Stage edits never strand existing opportunities
- [x] Deleting is refused rather than orphaning, with the blocking count named
- [x] No pipeline screen imports from `lib/mock/data.ts`
- [x] `pnpm typecheck` and `pnpm test` pass; both apps build

**Status: complete.** Verified against the running stack.

### Two bugs this surfaced, both pre-existing

1. **The `toJSON` transform destroyed stage ids.** It ran `ret.id = ret._id` on every
   document *and subdocument*. Stages are declared `{ _id: false }` and carry their own
   string `id` — the one every opportunity references — so the transform overwrote it with
   `undefined`. The board could never have worked. Now guarded by an `_id !== undefined`
   check.
2. **Membership precedence was inverted.** `resolveTenant` sorted by scope *name*, and
   `account` sorts before `agency` — so an agency owner who also held a seat in a
   sub-account was silently downgraded to that seat inside it (54 permissions became 15).
   Both `resolveTenant` and the session endpoint now pick the **strongest** membership
   via a shared `strongestMembership` helper.

---

# Agency console — AGY-01 → AGY-12

**Goal:** one place where an agency operator runs every sub-account without switching into
each one — settings, modules, people, roles — plus the rollup view that only exists at
agency level.

Today `/agency/accounts` is a single flat roster: it lists sub-accounts, creates one, and
links out. Managing a client means *switching into* their sub-account and working inside it.
That is fine at 3 clients and unworkable at 40.

## The one architectural gap

Every agency-level read spans sub-accounts, and there is currently **no middleware that
establishes agency scope**. `resolveTenant` requires an `X-Account-Id` header and pins
`accountId`, so `/core/accounts` works around it by filtering memberships by hand.

The tenancy plugin already anticipates this:

```ts
if (accountScoped && ctx.accountId) filter.accountId = ctx.accountId;
```

With `agencyId` set and `accountId` left undefined, every query scopes agency-wide
automatically, still inside one tenant. The missing piece is a `resolveAgency` middleware
that builds that context — plus `runInAccountContext(id, fn)` for the cases where an
agency-scoped request needs to write into one specific sub-account.

**This also shrinks the backend work considerably.** An agency user is already a member of
every sub-account beneath them, so "edit sub-account X" can reuse the existing per-account
endpoints by sending `X-Account-Id: X`. Only genuinely cross-account operations need new
routes. The agency console is mostly a frontend problem.

## New endpoints

| Method | Path | Why it cannot reuse an existing route |
|---|---|---|
| `GET` | `/core/agency` | Agency record itself; no per-account equivalent |
| `PATCH` | `/core/agency` | Name, branding |
| `GET` | `/core/agency/overview` | Rollup across every sub-account in one query |
| `GET` | `/core/agency/users` | Every person in the agency and which accounts they touch |
| `POST` | `/core/agency/users/invite` | May grant **agency scope**, which the sub-account invite deliberately refuses |
| `PATCH`/`DELETE` | `/core/agency/memberships/:id` | Change or revoke access from outside the account |
| `GET` | `/core/agency/audit` | Audit spanning sub-accounts |

Reused as-is with `X-Account-Id` set to the target: `PATCH /core/accounts/:id`,
`PUT /core/accounts/:id/modules`, `GET /core/users`, `GET /core/roles`, `GET /core/dashboard`.

## Pages

A real shell at `/agency`, with its own sidebar, replacing the one-off header on the
current roster page.

| ID | Page | Route |
|---|---|---|
| AGY-01 | Agency shell + nav | `/agency` layout |
| AGY-02 | Overview — rollup KPIs, per-account table, attention list | `/agency` |
| AGY-03 | Sub-account roster — search, status filter, module chips | `/agency/accounts` |
| AGY-04 | Create sub-account | roster action |
| AGY-05 | Sub-account detail shell + tabs | `/agency/accounts/[id]` |
| AGY-06 | └ Overview — that client's KPIs and recent activity | `.../[id]` |
| AGY-07 | └ Settings — name, timezone, status, markets | `.../[id]/settings` |
| AGY-08 | └ Modules — the toggle console, from agency level | `.../[id]/modules` |
| AGY-09 | └ Team — members, invite, change role, revoke | `.../[id]/team` |
| AGY-10 | People — every user across the agency | `/agency/people` |
| AGY-11 | Audit log — agency-wide, filterable by account | `/agency/audit` |
| AGY-12 | Agency settings — name, branding, plan | `/agency/settings` |

AGY-07/08/09 deliberately reuse the components already built for
`/app/[accountId]/settings/*` rather than growing a second copy. Those are currently
co-located with their pages; they move to `components/settings/` and get imported from
both places. One toggle console, two entry points.

## Decisions

- **Agency scope is not a superuser bypass.** `resolveAgency` still pins `agencyId`, so
  every query stays inside one tenant. An agency operator cannot see another agency's data
  by any route, and the plugin enforces that rather than each handler remembering to.
- **Granting agency scope needs agency scope.** The sub-account invite refuses
  agency-scoped roles on purpose — that guard stays. The new agency invite may grant them,
  but only to a caller who already holds `core:user:invite` at agency scope, and it is
  audited.
- **No cross-account bulk destructive actions.** Pausing or archiving happens one
  sub-account at a time, from that account's own page. A console that can wipe 40 clients
  in one click is not worth the convenience.
- **Everything writes an audit entry.** The console's whole point is acting on accounts
  from outside them, which is exactly when "who changed this?" gets asked.

## Risks

| Risk | Mitigation |
|---|---|
| Blast radius — one screen touching every client | No cross-account writes; per-account confirmation; full audit trail |
| Agency-scoped role handed out casually | Separate endpoint, separate permission, audited, and the UI states plainly that it grants access to every sub-account |
| Component drift between agency and sub-account settings | Shared components, not copies — a fix lands in both |
| Rollup query cost as accounts grow | One aggregation per rollup, not N queries; revisit with a cached snapshot past ~50 accounts |

## Done when

- [x] An operator can change any sub-account's settings, modules and team without switching into it
- [x] Agency-wide reads are scoped by `resolveAgency`, not hand-filtered
- [x] Inviting a user to a specific sub-account works from the agency console
- [x] Granting agency scope is possible, guarded, and audited
- [x] Settings components exist once and serve both entry points
- [x] `pnpm typecheck` and `pnpm test` pass; both apps build

**Status: complete.** Verified against the running stack on Atlas.

### Changed during the build

- **No CRM figures in the console.** Contacts, qualified leads and pipeline were dropped
  from the overview, the roster and the sub-account detail — summing them across unrelated
  clients produces a number nobody acts on, and per-client figures belong in that client's
  own CRM. The console reports seats, status, modules and plan. Three aggregations came out
  of the overview endpoint with them.
- **No parallel per-account actions.** The shared `SettingsForm` and `ModuleToggles` call
  the existing `updateAccount` / `saveModules`, which now revalidate both trees. A second
  pair would have been another thing to keep in step for nothing.

### Known gap

**Per-sub-account subscriptions do not exist in the data model.** `Plan` links to `Agency`,
so every sub-account shows the same agency plan. Charging clients differently needs either
a `planId` on `Account` or the full `billing` module. The console says so rather than
implying otherwise.

## Out of scope

Billing and plan changes beyond display (`billing` module is v2) · white-label theming
(`whitelabel` module is v2) · cross-agency/platform admin · impersonating a sub-account user

---

# Contacts module — CNT-01 → CNT-12

**Goal:** the Contacts module works against the real API, at a scale that survives a real
account. No mock data left in contact paths.

## The one thing that must change architecturally

Filters, search and pagination currently run over a JavaScript array of 60 mock contacts.
A production sub-account holds tens of thousands. **All three move server-side**, driven by
URL search params, so:

- the server fetches only the page being viewed
- a filtered view is a shareable, reloadable URL
- Export and Bulk operate on *the whole filter result*, not the 25 rows on screen

This is the difference between a demo and something a caller can use against 12,000 owners.

## New endpoints

| Method | Path | For |
|---|---|---|
| `POST` | `/contacts/bulk` | CNT-03 — tag, untag, set status, mark DNC, add to list, delete |
| `GET` | `/contacts/export` | CNT-11 — CSV of the current filter result |
| `POST` | `/contacts/import/preview` | CNT-12 — parse, detect columns, suggest a mapping, report counts |
| `POST` | `/contacts/import/commit` | CNT-12 — apply the mapping, upsert, report results |
| `PATCH`/`DELETE` | `/contacts/lists/:id` | CNT-09 — edit and remove lists |

## Work order

| ID | Feature | Work |
|---|---|---|
| CNT-01 | Contact list | Server-fetched, paginated table |
| CNT-02 | Search & filters | Move to URL params → API query; debounced search box |
| CNT-04 | Pagination | Server-side, from the API's `Paginated<T>` envelope |
| CNT-05 | Contact detail | Real record; edit inline |
| CNT-06 | Activity timeline | Real activities from the detail response |
| CNT-07 | Activity composer | Save notes and logged calls through a server action |
| CNT-08 | Parcel panel | Real parcel data; editable with the record |
| CNT-10 | New contact | Working create form |
| CNT-03 | Bulk selection | Tag / status / DNC / delete against the selection **or** the whole filter |
| CNT-09 | Lists | Create, edit and delete smart + static lists |
| CNT-11 | Export | CSV download honouring active filters, gated on `contacts:contact:export` |
| CNT-12 | CSV import | New page: upload → map columns → preview → commit, idempotent on re-run |

## Decisions

- **Import is synchronous with a row cap** for v1. Large list pulls belong on a queue
  (BullMQ is already in the stack) — that is a follow-up, not this scope. The cap is
  enforced server-side so a 200k-row file fails fast with a clear message rather than
  timing out.
- **Import is idempotent.** Every imported contact keeps `sourceSystem` + `sourceId`, so
  re-running the same file updates rather than duplicating — the property that makes the
  Zoho/GHL migration safe to retry.
- **Bulk delete requires `contacts:contact:delete`** and, when targeting a whole filter
  rather than a selection, states the affected count before acting.
- **Export stays gated.** The `caller` role deliberately lacks `contacts:contact:export`;
  that is the whole reason the role exists.

## Done when

- [x] No contact screen imports from `lib/mock/data.ts`
- [x] Filtering is server-side and the URL is shareable
- [x] A caller cannot export, and the button is not shown to them
- [x] Re-importing the same CSV twice produces no duplicates
- [x] `/contacts/import` resolves — the nav link is no longer dead
- [x] `pnpm typecheck` and `pnpm test` pass; both apps build

**Status: complete.** Verified against the running stack.

### Notes from building it

- **Route ordering bit again.** `GET /export` is a single segment and was being swallowed
  by `GET /:id`, exactly as `/fields` was in the core scope. Import/export routes are now
  registered before the `/:id` block, with a comment saying why.
- **One filter builder, three consumers.** List, export and bulk all call
  `resolveContactQuery`, so a bulk delete can never act on a different set than the table
  displayed. This was worth the extra file.
- **Verification builds no longer break a running dev server.** `next build` and
  `next dev` share `.next`, so a build run alongside a dev server overwrites its chunks
  and the app 404s its own CSS. `NEXT_DIST_DIR=.next-verify pnpm build` avoids it.

### Follow-ups

- Import runs synchronously with a 20,000-row cap; larger pulls need the BullMQ queue
- Static list membership can be added in bulk but not removed one-by-one from the UI
- Smart-list criteria are limited to status / tag / DNC; acreage and county are stored
  but not yet exposed in the list builder

---

# Core module — CORE-01 → CORE-12

**Scope:** CORE-01 through CORE-12 from the feature inventory.
**Goal:** every core feature works against the real API. No mock data left in the core paths.

Companion docs: [docs/PLAN.md](docs/PLAN.md) is the overall architecture and roadmap.
This file is the current work order only.

---

## What "done" means

Today most core features render correctly but read `lib/mock/data.ts` and their buttons have
no handlers. Finishing this scope means three kinds of work:

1. **Wiring** — replace mock reads with real API calls (most items)
2. **Five missing endpoints** — dashboard stats, account update, user invite, global search, custom fields
3. **One missing page** — custom fields (CORE-12), currently a 404 from the sidebar

CORE-13 (audit log) is out of scope — it stays API-only.

---

## Phase 0 — Auth & data plumbing (prerequisite)

Nothing else can be wired until the frontend can authenticate and fetch. This is the only
genuinely new architecture in the whole scope.

**Token handling.** The access token must be readable server-side, because pages fetch data in
server components. So tokens live in `httpOnly` cookies on the Next origin, never in JS:

- `POST /api/session/login` (Next route handler) → calls Express login → sets `lc_at` + `lc_rt`
- `middleware.ts` guards `/app/*` and `/agency/*`: if `lc_at` is missing or expires within
  60s, it refreshes using `lc_rt` and sets the new cookie on the response. Middleware is used
  because a server component cannot set cookies; a route handler or middleware must.
- Refresh failure → redirect to `/login`

**Reads** happen in server components via `apiGet()`, which attaches the bearer token and the
`X-Account-Id` header from the route param.

**Writes** happen through server actions, so the token never reaches the browser, and
`revalidatePath()` refreshes the page afterwards.

| Deliverable | File |
|---|---|
| Typed fetch client + error mapping | `apps/web/src/lib/api/client.ts` |
| Server-side read helpers | `apps/web/src/lib/api/server.ts` |
| Login/logout/refresh route handlers | `apps/web/src/app/api/session/*` |
| Auth + refresh middleware | `apps/web/src/middleware.ts` |

---

## Work order

Sequenced so each step builds on a working one. Session first — everything renders from it.

### CORE-01 · Login
Real authentication. Form posts to the Next route handler, which calls Express and sets
cookies. Invalid credentials show an inline error rather than a redirect. Successful login
lands on the user's first sub-account. `/login` redirects away if already signed in.
**Needs:** nothing new server-side — `POST /core/auth/login` already exists.

### CORE-02 · Sub-account switcher
Populated from `GET /core/auth/session`. Switching navigates to the new account and the whole
shell re-resolves, because the new account has its own module set.

### CORE-03 · Module-driven navigation
Sidebar built from the session's `enabledModules` × `permissions` — both resolved server-side.
Turning a module off in CORE-08 must remove its nav entries after revalidation.

### CORE-11 · Module lock screen
Already correct; verify against real data that a disabled module and an unpermitted module
each render the right message.

### CORE-06 · Agency sub-account roster
Real list from `GET /core/accounts`. Adds a working **New sub-account** form
(`POST /core/accounts` exists), including the plan account-limit error surfaced to the user.

### CORE-08 · Module toggle console
Persist via `PUT /core/accounts/:id/modules`. The server revalidates dependencies and the
agency ceiling independently of the browser; surface its rejection messages inline. On success,
revalidate so the sidebar updates immediately.

### CORE-07 · General settings
Working form for name, timezone, status and target markets.
**Needs:** `PATCH /core/accounts/:id` — does not exist yet.

### CORE-09 · Team roster
Real members from `GET /core/users`, plus a working invite.
**Needs:** `POST /core/users/invite` — creates an invited user + membership, returns the invite.

### CORE-10 · Roles & permission matrix
Real roles from `GET /core/roles`, matrix rows still derived from the enabled modules'
manifests. Read-only is acceptable for this scope; custom role editing is a later item.

### CORE-05 · Sub-account dashboard
Real KPI tiles, pipeline-by-stage and recent activity.
**Needs:** `GET /core/dashboard` — one aggregate endpoint rather than four client round trips.

### CORE-04 · Topbar
Working sign-out, and a global search that actually returns results.
**Needs:** `GET /core/search?q=` across contacts and opportunities, tenant-scoped.

### CORE-12 · Custom fields
New page at `/settings/fields`, currently a dead nav link.
**Needs:** custom field CRUD. The `ContactField` model and the `contacts:field:manage`
permission already exist, so the endpoints live in the **contacts** module even though the UI
sits under Settings — the module owns the model. The nav entry's permission changes from
`core:settings:update` to `contacts:field:manage` to match.

---

## New endpoints in this scope

| Method | Path | For |
|---|---|---|
| `PATCH` | `/core/accounts/:id` | CORE-07 |
| `POST` | `/core/users/invite` | CORE-09 |
| `GET` | `/core/dashboard` | CORE-05 |
| `GET` | `/core/search` | CORE-04 |
| `GET/POST/PATCH/DELETE` | `/contacts/fields` | CORE-12 |

---

## Out of scope

Deliberately not touched here, to keep the change reviewable:

- Contacts, Pipelines and Email screens stay on mock data — they are `CNT-*`, `PIP-*`, `EML-*`
- The other two dead nav links (`/contacts/import`, `/email/campaigns`) stay dead
- Custom role creation and editing
- CORE-13 audit log UI

---

## Done when

- [x] No core screen imports from `lib/mock/data.ts`
- [x] Signing out and back in works; an expired access token refreshes without a visible failure
- [x] Toggling a module off in Settings removes it from the sidebar and 403s its API
- [x] Every sidebar link under Settings resolves to a real page
- [x] A user without a permission sees the lock screen, not a broken page
- [x] `pnpm typecheck` and `pnpm test` pass; both apps build

**Status: complete.** All twelve verified against the running stack.

### Two bugs found by running it

1. **Permission checks ran too late.** Pages fetched their data before the client-side
   `ModuleGate` could render, so a user missing a permission got a 500 from the 403'd fetch
   instead of the lock screen. Access is now checked server-side in
   [`lib/guard.tsx`](apps/web/src/lib/guard.tsx) *before* any data call — a page never
   makes a request it is not allowed to make.

2. **The session endpoint leaked a fallback.** `GET /session?accountId=X` returned 200 with
   the user's *first* account when they had no membership on X, so `/app/<other-account>`
   rendered the wrong account and then 500'd. It now returns 403, and the shell turns that
   into a 404.

### Follow-ups not in this scope

- Custom role creation and editing (CORE-10 is read-only)
- `CNT-12` CSV import and `EML-05` campaigns — still dead nav links
- CORE-13 audit log UI
- Contacts, Pipelines and Email screens are still on mock data
