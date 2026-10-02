# LandCaller CRM

Modular, multi-tenant CRM for land-investing teams — replacing Zoho Suite and GoHighLevel.
Runs at `crm.landcaller.com`.

- **[docs/PLAN.md](docs/PLAN.md)** — architecture, tenancy model, module system, roadmap
- **[docs/DEPLOY.md](docs/DEPLOY.md)** — Hostinger VPS deployment

---

## Stack

| Layer | Choice |
|---|---|
| Frontend | Next.js 15 (App Router), React 19, Tailwind v4 |
| Backend | Express 4 + Mongoose 8 |
| Database | MongoDB Atlas (managed; replica set by default) |
| Queues | Redis + BullMQ *(v2)* |
| Telephony | Twilio *(v2)* |
| Hosting | Docker Compose + nginx on a Hostinger VPS |

## Layout

```
apps/
  web/        Next.js frontend
  api/        Express API
packages/
  shared/     Module catalog, permissions, entity types — read by BOTH apps
docker/       Dockerfiles + nginx site config
docs/         PLAN.md, DEPLOY.md
```

## Getting started

```bash
pnpm install

cp .env.example .env
# Generate secrets — the API refuses to boot on placeholders.
echo "JWT_ACCESS_SECRET=$(openssl rand -hex 48)"  >> .env
echo "JWT_REFRESH_SECRET=$(openssl rand -hex 48)" >> .env
```

The database is **MongoDB Atlas** — there is nothing to run locally. Create a cluster,
add your IP under Network Access, and put the connection string in `.env`:

```
MONGODB_URI=mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/landcaller?retryWrites=true&w=majority
```

Use a separate database name (or a separate cluster) for development so a `pnpm seed`
never wipes production data — the seed script deletes and rebuilds its tenant.

Redis is only needed once the queue-backed modules land:

```bash
docker compose up -d redis   # optional for now
```

Then:

```bash
pnpm seed     # creates the LandCaller agency + 2 sub-accounts + sample data
pnpm dev      # web on :3000, api on :4000
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
pnpm dev          # both apps
pnpm build        # build everything
pnpm typecheck    # all packages
pnpm test         # unit tests, plus API route tests against an in-memory MongoDB
pnpm seed         # reset + reseed dev data
```

The API route tests boot the real Express app against `mongodb-memory-server`, so they need
no Atlas cluster and no `.env`. The `mongod` binary is downloaded once, the first time the
tests run, into `node_modules/.cache` — so the first run needs a network connection and
takes a few minutes longer.

---

## The two ideas worth understanding

### 1. Modules are data, not folders

A module is one manifest in [`packages/shared/src/modules/catalog.ts`](packages/shared/src/modules/catalog.ts)
declaring its permissions, nav entries and dependencies. Both apps read it:

- the API mounts `/api/v1/<key>` and gates it with `requireModule(key)`
- the web app builds its sidebar and route guards from the same entry

So disabling a module in Settings genuinely closes its API surface — it does not just
hide a link. Effective module set is resolved as:

```
plan  ∩  agency toggles  ∩  account toggles  +  account grants  −  account denies
```

The agency is a **ceiling**, never a contributor: a sub-account can never enable
something its agency does not sell, whatever its own toggles say.

### 2. Tenant isolation is enforced by a plugin, not by discipline

MongoDB has no row-level security, so isolation lives in
[`apps/api/src/core/tenancy/`](apps/api/src/core/tenancy/). A mandatory Mongoose plugin
injects the current tenant filter into **every** query from `AsyncLocalStorage` request
context, and a query that runs with no context **throws** rather than returning
unscoped rows.

Opting out requires an explicit, greppable `.bypassTenantScope()`. A developer who
forgets about tenancy gets a correctly scoped query; they cannot accidentally get a leak.

## Status

**v1 (built):** core tenancy · contacts · pipelines · email
**v2 (in the catalog, not yet built):** telephony · campaigns · reporting · calendars ·
automations · forms · billing · white-label

v2 modules appear in the catalog as `status: 'planned'` so the toggle UI, plan builder
and upsell path are real and testable before the modules exist.
