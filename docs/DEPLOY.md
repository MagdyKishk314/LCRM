# Deploying to the Hostinger VPS

Target: `crm.landcaller.com`, Ubuntu 22.04+ VPS, Docker Compose behind host nginx.

---

## 1. DNS

Point an A record at the VPS before requesting a certificate — certbot's HTTP-01
challenge fails otherwise.

```
crm.landcaller.com.   A   <your-vps-ip>
```

Verify with `dig +short crm.landcaller.com` before continuing.

## 2. MongoDB Atlas

The database is hosted by Atlas; nothing stores data on the VPS. Set this up first — the
API will not boot without a reachable cluster.

1. **Create the cluster.** Atlas → Build a Cluster. Pick a region close to the VPS;
   every query pays that round trip.
2. **Create a database user.** Database Access → Add New Database User, with the
   `readWrite` role on the `landcaller` database. Avoid `@ : / ? # [ ] %` in the
   password, or URL-encode it in the connection string.
3. **Allow the VPS.** Network Access → Add IP Address → the VPS's public IP.
   Do **not** use `0.0.0.0/0` — that exposes the cluster to the whole internet and
   leaves the password as the only thing between a scanner and every client's data.
4. **Copy the connection string.** Connect → Drivers → Node.js:

   ```
   mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/landcaller?retryWrites=true&w=majority
   ```

   The `/landcaller` path segment matters — without it the driver connects to the
   `test` database and the app silently starts empty.

Atlas clusters are replica sets already, so the transactions this app relies on work
with no extra configuration.

## 3. Host setup

```bash
ssh root@<your-vps-ip>

apt update && apt upgrade -y
apt install -y ca-certificates curl git nginx

# Docker
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
  https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" \
  > /etc/apt/sources.list.d/docker.list
apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# Firewall — only SSH and HTTP(S). App ports stay on loopback.
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable
```

## 4. Application

```bash
mkdir -p /opt/landcaller && cd /opt/landcaller
git clone <your-repo-url> .

cp .env.example .env
# Generate real secrets — the API refuses to boot on the placeholder values.
echo "JWT_ACCESS_SECRET=$(openssl rand -hex 48)"  >> .env
echo "JWT_REFRESH_SECRET=$(openssl rand -hex 48)" >> .env
nano .env   # fill in SMTP_* for the email module

docker compose build
docker compose up -d
docker compose ps         # api and web should be healthy
curl -s localhost:4000/health
```

## 5. nginx + TLS

```bash
cp docker/nginx/crm.landcaller.com.conf /etc/nginx/sites-available/
ln -sf /etc/nginx/sites-available/crm.landcaller.com.conf /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
mkdir -p /var/www/certbot

apt install -y certbot python3-certbot-nginx
certbot --nginx -d crm.landcaller.com --agree-tos -m ops@landcaller.com --redirect

nginx -t && systemctl reload nginx
```

Certbot installs a renewal timer automatically. Confirm with
`systemctl list-timers | grep certbot` and dry-run it once: `certbot renew --dry-run`.

## 6. Seed the first agency

The seed script refuses to run with `NODE_ENV=production`, which is correct — it
wipes and rebuilds its tenant. For the genuine first-run bootstrap, run it explicitly:

```bash
docker compose run --rm -e NODE_ENV=development api node apps/api/dist/seed.js
```

It prints the login for the agency owner. **Change that password immediately** — it is
a known value committed to this repository.

For any later production data work, write a one-off migration instead of re-seeding.

---

## Updating

```bash
cd /opt/landcaller
git pull
docker compose build
docker compose up -d          # rolling replace; nginx keeps serving
docker image prune -f
```

### Indexes and data migrations

The app does not change indexes or rewrite data on boot. When a release changes either,
run these after deploying the new code:

```bash
# Build new indexes and drop ones the schemas no longer declare. Safe to re-run.
docker compose run --rm api node apps/api/dist/scripts/sync-indexes.js

# One-off migration for the fix plan (Plans/FIX-PLAN.md). Dry run first — it reports what
# it would change and writes nothing — then apply.
docker compose run --rm api node apps/api/dist/scripts/migrate-fix-plan.js
docker compose run --rm api node apps/api/dist/scripts/migrate-fix-plan.js --apply
```

On Vercel there is no container to run them in. Run the same scripts from a machine whose
`.env` points at the production cluster:

```bash
pnpm --filter @landcaller/api sync-indexes
pnpm --filter @landcaller/api migrate:fix-plan            # dry run
pnpm --filter @landcaller/api migrate:fix-plan -- --apply
```

**The fix-plan migration is required once.** Until it has run, contacts created before the
release cannot be found by search, and existing static lists appear empty.

The Contacts II release (Plans/CONTACTS-PLAN.md) has its own one-off migration, run the same
way after `sync-indexes`:

```bash
docker compose run --rm api node apps/api/dist/scripts/migrate-contacts-ii.js          # dry run
docker compose run --rm api node apps/api/dist/scripts/migrate-contacts-ii.js --apply
# or, from a machine with .env pointed at production:
pnpm --filter @landcaller/api migrate:contacts-ii -- --apply
```

Until it has run, contacts from before the release have no normalised phone digits (so they
are not found by the duplicate check or matched by an import) and no parcels on the record.

## Backups

Handled by Atlas, not by us. Confirm the policy on the cluster rather than assuming it:

- **Atlas → Cluster → Backup.** M10 and above get continuous backup with
  point-in-time restore. **M0/M2/M5 shared tiers get snapshots only, and M0 gets none
  at all** — if the cluster is free-tier, there is no backup and that needs fixing
  before real client data lands in it.
- Set the retention window to at least 7 days.
- A backup you have never restored is a hypothesis. Once a quarter, restore a snapshot
  into a scratch cluster and point a local API at it to confirm the data is intact.

There is no `mongodump` cron on the VPS any more; the box holds no database.

## Operations

```bash
docker compose logs -f api          # tail the API
docker compose logs -f web
docker compose restart api
# DB shell: Atlas -> Cluster -> Connect -> mongosh, or the Atlas Data Explorer
```

## Sizing

Two vCPU / 4 GB handles the v1 workload comfortably. Revisit when the telephony module
lands — concurrent dialer sessions and call recording are the first thing that will
change the shape of this box, and Redis/BullMQ workers should move to their own service
at that point rather than sharing the API container.
