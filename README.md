# LandCaller CRM

Modular, multi-tenant CRM for land-investing teams — replacing Zoho Suite and GoHighLevel.
Runs at `crm.landcaller.com`.

- **[docs/PLAN.md](docs/PLAN.md)** — architecture, tenancy model, module system, roadmap
- **[docs/DEPLOY.md](docs/DEPLOY.md)** — Vercel and Hostinger VPS deployment
- **[THE-PLAN.md](THE-PLAN.md)** — work orders, newest first

---

## Stack

| Layer | Choice |
|---|---|
| App | Next.js 15 (App Router), React 19, Tailwind v4 |
| API | Express 4 + Mongoose 8, served **by the Next.js app** at `/api/v1` |
| Database | MongoDB Atlas (managed; replica set by default) |
| Queues | Redis + BullMQ *(v2)* |
| Telephony | Twilio *(v2)* |
| Hosting | Vercel, or Docker Compose + nginx on a VPS |

## Layout

One project, one `package.json`, one deployment.

```
src/
  app/          Next.js routes — pages, and /api/v1/[...path] which runs the Express app
  components/   UI
  lib/          Web-side helpers: API client, server actions, session
  server/       The API: Express app, models, modules, tenancy, auth, scripts
  shared/       Module catalog, permissions, filter vocabulary, entity types — used by both
docker/         Dockerfile + nginx site config (VPS only)
docs/           PLAN.md, DEPLOY.md
```

`src/server` is not a second service. The Express app it exports is mounted inside the
Next.js server by [src/app/api/v1/[...path]/route.ts](src/app/api/v1/[...path]/route.ts),
so the browser, the pages and the API share one origin, one process and one set of
environment variables.

## Getting started

```bash
npm install

cp .env.example .env
# Generate secrets — the app refuses to boot on placeholders.
echo "JWT_ACCESS_SECRET=$(openssl rand -hex 48)"  >> .env
echo "JWT_REFRESH_SECRET=$(openssl rand -hex 48)" >> .env
```

The database is **MongoDB Atlas** — there is nothing to run locally. Create a cluster,
add your IP under Network Access, and put the connection string in `.env`, **including the
database name**:

```
MONGODB_URI=mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/landcaller?retryWrites=true&w=majority
```

Use a separate database name (or a separate cluster) for development so `npm run seed`
never wipes production data — the seed script deletes and rebuilds its tenant.

Then:

```bash
npm run sync-indexes   # build the indexes
npm run seed           # creates the LandCaller agency + 2 sub-accounts + sample data
npm run dev            # http://localhost:3000
```

Seeded logins (**change before any real deployment**):

| Login | Role | Sees |
|---|---|---|
| `joe@landcaller.com` / `LandCaller2026!` | Agency owner | Both sub-accounts, all modules |
| `marcus@landcaller.com` / `LandCaller2026!` | Caller | One sub-account, no export, no settings |

The second sub-account (Summit) ships with the **email module disabled** on purpose, so
the module gate is observable immediately: its sidebar has no Email entry and
`/api/v1/email/*` returns 403 for it.

## Commands

```bash
npm run dev            # the app, with the API inside it
npm run build          # production build
npm start              # serve the production build
npm run typecheck
npm run lint
npm test               # every test; the API tests boot against an in-memory MongoDB
npm run seed           # reset + reseed dev data
npm run sync-indexes   # bring indexes in line with the schemas (safe to re-run)
npm run migrate:fix-plan -- --apply      # one-off data migrations; dry run without --apply
npm run migrate:contacts-ii -- --apply
```

The API tests need no Atlas cluster and no `.env`: they boot the real Express app against
`mongodb-memory-server`. The `mongod` binary is downloaded once, the first time the tests
run, into `node_modules/.cache`, so the first run needs a network connection.

---

## The two ideas worth understanding

### 1. Modules are data, not folders

A module is one manifest in [src/shared/modules/catalog.ts](src/shared/modules/catalog.ts)
declaring its permissions, nav entries and dependencies. Both halves read it:

- the API mounts `/api/v1/<key>` and gates it with `requireModule(key)`
- the pages build the sidebar and route guards from the same entry

So disabling a module in Settings genuinely closes its API surface — it does not just
hide a link. Effective module set is resolved as:

```
plan  ∩  agency toggles  ∩  account toggles  +  account grants  −  account denies
```

The agency is a **ceiling**, never a contributor: a sub-account can never enable
something its agency does not sell, whatever its own toggles say.

### 2. Tenant isolation is enforced by a plugin, not by discipline

MongoDB has no row-level security, so isolation lives in
[src/server/core/tenancy/](src/server/core/tenancy/). A mandatory Mongoose plugin
injects the current tenant filter into **every** query from `AsyncLocalStorage` request
context, and a query that runs with no context **throws** rather than returning
unscoped rows.

Opting out requires an explicit, greppable `.bypassTenantScope()`. A developer who
forgets about tenancy gets a correctly scoped query; they cannot accidentally get a leak.

## Status

**v1 (built):** core tenancy · contacts (with lists, filters, import/export, tasks,
appointments, history) · pipelines · email
**v2 (in the catalog, not yet built):** telephony · campaigns · reporting · calendars ·
automations · forms · billing · white-label

v2 modules appear in the catalog as `status: 'planned'` so the toggle UI, plan builder
and upsell path are real and testable before the modules exist.
