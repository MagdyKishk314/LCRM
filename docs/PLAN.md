# LandCaller CRM — Build Plan

Replacing Zoho Suite + GoHighLevel with an in-house, modular, multi-tenant CRM at `crm.landcaller.com`.

---

## 1. Decisions locked

| Area | Decision |
|---|---|
| Stack | MERN — MongoDB + Express + React (via Next.js) + Node |
| Language | TypeScript everywhere |
| Frontend | Next.js 15 App Router, React 19, Tailwind v4, shadcn/ui |
| Backend | Express 4 + Mongoose 8, under `src/server`, served by the Next.js app |
| Database | MongoDB Atlas (managed; replica set by default, so transactions work) |
| Cache / queues | Redis + BullMQ (email sending, imports, automations) |
| Telephony | Twilio, behind a provider adapter interface |
| Hosting | Hostinger VPS, Docker Compose + nginx + Let's Encrypt |
| Domain | `crm.landcaller.com` |
| Repo | one Next.js project, one `package.json` |

### Why a separate Express API instead of Next.js route handlers

The dialer, bulk list imports, email campaigns, and automation workflows are all long-running
and queue-driven. Those never belong in a Next.js request handler. Keeping the API standalone
also means the future mobile app and Zapier/webhook consumers hit one documented surface
rather than a set of internal Next endpoints. Next.js stays a pure frontend + BFF.

---

## 2. Tenancy model

Four levels, mirroring GHL but with an explicit platform tier:

```
Platform  (LandCaller HQ — super admins, plan definitions, global module catalog)
   └── Agency  (a reseller/brand: branding, plan, module entitlements, billing)
         └── Account  (a sub-account = one land investor client; GHL calls this a "Location")
               └── User  (via Membership; a user may belong to many accounts)
```

**Key rule:** `Agency` decides what a sub-account is *allowed* to have. `Account` decides what it
*actually* has turned on. Effective module set is always the intersection, never a union.

### Identity vs. membership

`User` is a global identity (one email, one password, one MFA secret). Access is granted by
`Membership` documents:

```ts
Membership {
  userId
  scope: 'platform' | 'agency' | 'account'
  agencyId?      // required for scope 'agency' | 'account'
  accountId?     // required for scope 'account'
  roleId
  permissionOverrides: { grant: string[], deny: string[] }
  status: 'active' | 'invited' | 'suspended'
}
```

This is what lets one LandCaller ops person work across 40 client sub-accounts with a single
login and an account switcher, while a client user sees exactly one.

### Data isolation (the critical part)

Mongo has no row-level security, so isolation is enforced in the app layer, in three
overlapping ways so that no single mistake leaks data:

1. **Every tenant-scoped document carries `agencyId` and `accountId`.** Compound indexes lead
   with them, so tenant-scoped reads are also the fast path.
2. **A mandatory Mongoose plugin** (`tenantScope`) hooks `pre` on every find/update/delete/count
   and injects the current tenant filter from `AsyncLocalStorage` request context. A query that
   runs outside a tenant context **throws** rather than returning unscoped rows. Escaping it
   requires an explicit, greppable `.bypassTenantScope()` — used only by platform admin tooling.
3. **A response-boundary assertion** in non-production builds re-checks that every document
   leaving a handler matches the request's tenant, and fails loudly in tests.

Rule 2 is the one that matters. It is written once, in `src/server/core/tenancy/`, and every
module inherits it for free.

---

## 3. Module system

Modularity is the headline requirement, so modules are real artifacts, not folders by
convention. A module is declared once in `src/shared` and consumed by both apps.

```ts
ModuleManifest {
  key: 'contacts'
  name: 'Contacts'
  description: string
  icon: string                    // lucide icon name
  version: string
  core: boolean                   // core modules cannot be disabled
  scope: 'agency' | 'account' | 'both'
  dependsOn: ModuleKey[]          // 'pipelines' dependsOn 'contacts'
  permissions: PermissionDef[]    // module owns its permission vocabulary
  nav: NavItem[]                  // rendered only when module is on AND permission held
  settings: ZodSchema             // per-account module settings, rendered generically
}
```

**Backend:** each module is a directory under `src/server/modules/<key>/` exporting a
router + models + manifest. `mountModules()` mounts routers under `/api/v1/<key>`, and a
`requireModule('<key>')` guard rejects requests to a module the current account has disabled —
so disabling a module in the UI genuinely closes the API surface, it does not just hide a link.

**Frontend:** `src/shared` exports the same manifests. The sidebar is generated from the
effective module set × the user's permissions. Module routes live under
`app/(app)/[accountId]/<key>/` and are guarded by the same effective-set check.

**Dependency + toggle rules:**
- Enabling a module auto-enables its `dependsOn` chain.
- Disabling a module blocks if another enabled module depends on it (with a clear error naming it).
- Disabling never deletes data — it hides and locks. Re-enabling restores everything.

### Entitlement resolution

```
effective(account) =
      plan.modules                     // what the agency's plan sells
   ∩  agency.enabledModules            // what the agency turned on
   ∩  account.enabledModules           // what this sub-account turned on
   ∪  account.moduleGrants             // explicit per-account additions (upsells)
   −  account.moduleDenies             // explicit per-account removals
```

Resolved once per request, cached in Redis keyed by `account:{id}:modules:v{n}`, busted on any
toggle change.

---

## 4. Permissions

Format: `module:resource:action` — e.g. `contacts:contact:read`, `pipelines:opportunity:delete`,
`email:campaign:send`. Wildcards allowed at each segment (`contacts:*:read`, `*`).

Seeded system roles (each agency may clone + customise):

| Role | Scope | Summary |
|---|---|---|
| `platform_admin` | platform | `*` — LandCaller HQ only |
| `agency_owner` | agency | Full agency + all sub-accounts, billing, module toggles |
| `agency_admin` | agency | Full agency + sub-accounts, no billing |
| `agency_user` | agency | Read across sub-accounts, write where assigned |
| `account_admin` | account | Full control of one sub-account incl. its users |
| `account_user` | account | Day-to-day CRM work |
| `caller` | account | Purpose-built: dialer queue, dispositions, contact notes — no exports, no settings |

`caller` matters commercially: it is the seat LandCaller gives its own cold callers working
inside a client's sub-account, and it deliberately cannot export a lead list.

Authorization on every request = `authenticated` → `member of account` → `module enabled` →
`permission held`. All four, in that order, in one composable middleware chain.

---

## 5. Module catalog

**v1 — shipping now**

| Module | Contents |
|---|---|
| `core` | Auth, users, agencies, sub-accounts, memberships, roles, module toggles, audit log, settings |
| `contacts` | Contact records, custom fields, tags, static + smart lists, saved filters, bulk actions, CSV import/export, full contact detail page with activity timeline |
| `pipelines` | Multiple pipelines, drag-drop stages, opportunities with value/owner/close date, per-stage automation hooks |
| `email` | Per-account sending identity, templates with merge fields, one-off + bulk send, open/click/reply tracking, threaded history on the contact |

**v2 — scaffolded in the registry, built next**

`telephony` (Twilio: click-to-call, power dialer, dispositions, recordings, two-way SMS) ·
`campaigns` (owner lists, skip-trace fields, DNC/TCPA litigator scrubbing, caller queues) ·
`reporting` (daily caller KPIs, campaign performance, agency rollups) ·
`calendars` · `automations` · `forms` · `billing` · `whitelabel`

The v2 modules exist in the catalog from day one as disabled entries so the toggle UI, the
plan builder, and the upsell path are all real and testable before the modules are written.

---

## 6. Data model (v1 collections)

```
users              agencies           accounts           memberships        roles
plans              moduleStates       auditLogs
contacts           contactFields      contactLists       tags
pipelines          opportunities
emailIdentities    emailTemplates     emailMessages
activities         tasks              files
```

`activities` is the single unified timeline — notes, calls, emails, SMS, stage changes, task
completions all write here with a `type` discriminator. One collection means the contact detail
page is one query, and every future module gets a timeline entry for free by writing to it.

---

## 7. Shared capabilities

A CRM this size grows several places to do the same thing. Inviting a user is already
reachable from three screens; contacts will be creatable from a list, a detail page, an
import and a form; email will send from a campaign, a contact and an automation.

**A capability offered in more than one place gets one implementation.** Not a convention —
a structure, with a test that fails when a screen reaches around it.

### Why, concretely

Inviting a user was built per screen and drifted within a week:

- **On the server**, both invite handlers rotated the invite token *before* checking for an
  existing membership. Re-inviting someone still pending destroyed the only working link
  and then returned a conflict, stranding them. The bug had to be found twice because it
  existed twice.
- **On the client**, each form rendered the one-time link itself. The sub-account form is
  mounted in a page header's action strip — `flex shrink-0` — so the link rendered squeezed
  against the right edge, effectively invisible. The other two screens looked fine, which is
  why it went unnoticed.

Both failures share a cause: the behaviour lived with the caller, so each caller could get
it wrong differently.

### The shape

| Layer | Rule | Invite example |
|---|---|---|
| API | One service holds the rules that must never differ. Routes are adapters: they decide *who may call* and *what this surface permits*, then hand over. | `core/auth/invite-service.ts` owns token issue, resend-vs-conflict, audit, and returning the link once. The two routes only set `allowedScopes` and audit names. |
| Web | One hook owns the side effects. Screens own layout and their own inline errors — nothing else. | `useInvite()` calls the action, shows the link, refreshes. Screens never import the invite actions. |
| Mount | Anything the user must not miss renders above the page, not inside the caller. | `<InviteProvider>` sits in the root layout, so no screen's layout can clip it and its state survives the `revalidatePath` the invite triggers. |
| Guard | A test asserts screens cannot bypass the shared path. | `src/lib/capabilities.test.ts` — add a row to `CAPABILITIES`, and a direct import fails the build with the fix in the message. |

### When it applies

Reach for this when **an operation has a step that is invisible if forgotten**: a one-time
secret to display, an audit entry, a quota to decrement, a webhook to fire. A screen that
forgets renders fine and passes review — the damage shows up later, in the screen nobody
tested.

It does not apply to plain reads, or to an operation genuinely offered once. `GET /users`
and `GET /audit` exist in both the per-account and agency routers and stay that way: they
aggregate differently and have no side effect to forget.

### Adding one

1. Move the rules into a service (API) or hook (web).
2. Make the routes/screens adapters over it.
3. Add a row to `CAPABILITIES` in `src/lib/capabilities.test.ts` naming the
   symbols only the owner may import.
4. Confirm the guard fails — temporarily import the restricted symbol from a screen and run
   `npm test`. A guard that cannot fail is not a guard.

---

## 8. Build order

| Phase | Deliverable |
|---|---|
| 0 | Monorepo, shared package, module registry, permission vocabulary |
| 1 | **Frontend** — app shell, auth screens, account switcher, module-driven nav, settings + module toggle UI |
| 2 | **Frontend** — Contacts (list/filters/detail), Pipelines (board), Email (compose/templates) against typed mock data |
| 3 | **Backend** — Express core: auth, tenancy plugin, RBAC, module gating, agencies/accounts/users CRUD |
| 4 | **Backend** — Contacts, Pipelines, Email APIs; swap frontend off mocks |
| 5 | Docker + nginx + TLS on the Hostinger VPS, seed script, first deploy |
| 6 | Zoho + GHL data migration scripts, parallel run, cutover |

Phases 1–2 before 3–4 is deliberate and matches the request: the frontend is built against a
typed contract from `src/shared`, so the API is written to satisfy an interface that
already exists rather than the reverse.

---

## 9. Migration off Zoho + GHL

- **GHL** → REST API export per sub-account: contacts, custom fields, opportunities, pipelines,
  conversations. Maps almost 1:1 onto this model, since the hierarchy was designed to match.
- **Zoho** → CSV/bulk API export: leads, contacts, deals, notes.
- Both land in an `imports` staging collection with a dry-run diff report before commit, and
  every imported document keeps `sourceSystem` + `sourceId` so a re-run is idempotent and
  a bad import is reversible.
- Run both systems in parallel for one billing cycle, reconcile daily counts, then cut over.

---

## 10. Risks

| Risk | Mitigation |
|---|---|
| Cross-tenant data leak | Mandatory tenancy plugin that throws without context; test suite asserts isolation per module |
| Module toggle drift between UI and API | One shared manifest source; API guard reads the same effective set the UI does |
| Email deliverability on a new domain | Dedicated subdomain, SPF/DKIM/DMARC, warm-up schedule, per-account sending caps |
| TCPA/DNC exposure in the dialer | Scrubbing is a hard gate in the campaign module, not an advisory flag; `caller` role cannot export |
| Single VPS as a failure point | Database is managed by Atlas (backups + failover are theirs); the VPS is stateless and its compose file is reproducible on any host |
