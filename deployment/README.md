# UNSPIN deployment runbook (Vultr + PostgreSQL)

Status: **documentation and configuration only. Nothing here has been deployed.** Commands are
for an operator to run on infrastructure they own. Every step that creates an account,
spends money, or exposes a public endpoint is the operator's decision.

## Topology

```
Internet ──HTTPS──> nginx (TLS, rate limits, body cap) ──> next start :3000 (unspin-web)
                                                         │
                         PostgreSQL (private / allow-listed) <── unspin-worker (npm run worker)
                                                         │
                    /var/lib/unspin/blobs (persistent volume)  or  private S3-compatible bucket
```

- One Vultr Cloud Compute instance (Ubuntu 24.04 LTS) runs nginx, the web process, and the worker.
- PostgreSQL is either Vultr Managed Database for PostgreSQL (private VPC network) or a
  Tiger Data service (see below). Never expose PostgreSQL on a public port without TLS and an
  IP allow list.
- Source files live on a Vultr Block Storage volume mounted at `/var/lib/unspin`, or in a
  private Vultr Object Storage bucket (`UNSPIN_STORAGE_MODE=s3`).

## Pre-deployment gates (do not open the site publicly until all hold)

1. HTTPS only (nginx below redirects HTTP; `NODE_ENV=production` makes the guest cookie `Secure`).
2. Ownership enforcement: every repository call is owner-scoped (tested against memory and real
   PostgreSQL in `src/server/storage/*.test.ts`).
3. Persistent storage: `DATABASE_URL` set and migrated; blob root on a persistent volume (or S3).
   `GET /api/v1/health` must show `persistence.durable: true` and `status: "ok"`.
4. Abuse and cost controls (next section) configured. Guests are anonymous, so a public site lets
   anyone start extractions: **do not publish an unmetered model proxy.**
5. Backups scheduled and one restore rehearsed.

## Cost and abuse controls

| Control | Where | Status |
| --- | --- | --- |
| Upload size cap 10 MiB | app (`LIMITS.maxUploadBytes`) + nginx `client_max_body_size 11m` | app implemented; nginx config here |
| Per-IP request rate limits (stricter on uploads/extractions) | nginx `limit_req` (`nginx/unspin.conf`) | config provided |
| Global concurrency cap on model calls | `UNSPIN_JOBS_MODE=worker` + `npm run worker -- --concurrency=2`; requests only enqueue | implemented (worker) |
| Bounded retries per job | worker `--max-attempts=3`; provider retries bounded in `LIMITS.providerMaxAttempts` | implemented |
| Provider budget | Google Cloud console: per-day/per-minute quota on the Generative Language API key, billing budget alert, key restricted to the server's IP | operator action |
| Per-owner extraction quota (e.g. N per guest per day) | app | **not implemented — requested from the coordinator** |
| Bot protection on guest creation | app/edge | **not implemented** |

Until per-owner quotas exist, keep the deployment unlisted or behind an allow list (nginx
`allow`/`deny` or HTTP basic auth) and keep provider quotas low.

## Environment

Set in `/etc/unspin/unspin.env` (mode 0600, owner root). Names are the frozen ones in `.env.example`.

| Variable | Required | Notes |
| --- | --- | --- |
| `NODE_ENV=production` | yes | Secure cookies |
| `DATABASE_URL` | yes | `postgres://USER:PASSWORD@HOST:PORT/DB?sslmode=require` — with the installed `pg` 8.x, `require` verifies the server certificate. Never use `sslmode=no-verify`. |
| `UNSPIN_STORAGE_MODE` | no | `filesystem` (default with a database) or `s3` |
| `UNSPIN_STORAGE_ROOT` | filesystem | `/var/lib/unspin/blobs` (outside the app directory and `public/`) |
| `UNSPIN_S3_ENDPOINT`, `UNSPIN_S3_REGION`, `UNSPIN_S3_BUCKET`, `UNSPIN_S3_ACCESS_KEY_ID`, `UNSPIN_S3_SECRET_ACCESS_KEY` | s3 | HTTPS endpoint, e.g. `https://ewr1.vultrobjects.com`, region `ewr1`. Bucket must be private (no public ACL/policy). Path-style requests. |
| `UNSPIN_JOBS_MODE=worker` | recommended | Web requests enqueue; the worker runs jobs |
| `APP_BASE_URL` | yes | `https://your.domain` |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | for extraction | server-only; never `NEXT_PUBLIC_` |
| `AUTH0_*` | optional | Accounts are not active until the Auth0 SDK is integrated |

## First deployment

```bash
# As root on a fresh instance
apt-get update && apt-get install -y nginx certbot python3-certbot-nginx postgresql-client
useradd --system --home /opt/unspin --shell /usr/sbin/nologin unspin
mkdir -p /opt/unspin /var/lib/unspin/blobs /etc/unspin
chown -R unspin:unspin /opt/unspin /var/lib/unspin && chmod 700 /var/lib/unspin /var/lib/unspin/blobs
# Mount the Vultr Block Storage volume at /var/lib/unspin first (add it to /etc/fstab).

# Node 24 LTS (matches .nvmrc / engines) for the unspin user, e.g. via nvm or NodeSource.

# Code. Run npm ci WITHOUT NODE_ENV=production: the build and the worker (tsx) need devDependencies.
sudo -u unspin git clone <repo> /opt/unspin/app && cd /opt/unspin/app
sudo -u unspin npm ci
sudo -u unspin npm run build

# Database schema (idempotent; records applied files in schema_migrations)
sudo -u unspin env $(cat /etc/unspin/unspin.env | xargs) npm run db:migrate

# Services
cp deployment/systemd/unspin-web.service deployment/systemd/unspin-worker.service /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now unspin-web unspin-worker

# TLS + reverse proxy
cp deployment/nginx/unspin.conf /etc/nginx/sites-available/unspin && ln -s ../sites-available/unspin /etc/nginx/sites-enabled/
# edit server_name, then:
certbot --nginx -d your.domain
nginx -t && systemctl reload nginx

# Firewall: only 22 (restricted to your IP), 80, 443
ufw allow from <your-ip> to any port 22 && ufw allow 80 && ufw allow 443 && ufw enable
```

## Health and readiness

- `GET /api/v1/health` returns capability booleans and `status: "ok" | "degraded"`; it never
  includes secrets or connection strings. `persistence.ready` is a `SELECT 1` probe plus a
  writable-blob-root (or S3 `HEAD bucket`) check; it never throws.
- A database outage makes data endpoints return `503 persistence_unavailable` (retryable)
  rather than 500, and `health.status` becomes `degraded`.
- Monitor: `curl -fsS https://your.domain/api/v1/health | jq -e '.health.status == "ok"'`
  every minute from an external checker; alert on two consecutive failures.
- Worker liveness: `systemctl is-active unspin-worker` and `journalctl -u unspin-worker`. Jobs stuck
  in `queued` with an active worker indicate a worker/database problem.

## Upgrades

```bash
cd /opt/unspin/app && sudo -u unspin git pull && sudo -u unspin npm ci && sudo -u unspin npm run build
sudo -u unspin env $(cat /etc/unspin/unspin.env | xargs) npm run db:migrate   # forward-only
systemctl restart unspin-worker   # SIGTERM: finishes in-flight jobs for up to 25 s
systemctl restart unspin-web
```

Migrations are forward-only and must stay backward compatible with the previous web/worker build
for the few seconds between steps (add columns/tables first; drop in a later release). An applied
migration file must never be edited; the runner refuses a changed checksum.

## Worker behavior

- Claims the oldest queued job (or a running job whose lease expired) with `FOR UPDATE SKIP LOCKED`;
  multiple workers never claim the same job.
- 30 s lease, renewed by heartbeats; a crashed worker's job is reclaimed after expiry.
- A job that has already used `--max-attempts` attempts is failed with a retryable error instead of
  being run again; a cancellation requested while no worker held it is honored before re-running.
- On start it fails orphaned *inline* jobs (running, no lease, untouched for longer than the
  provider timeout + 5 min) so the UI does not wait forever after a web-server crash.
- Memory mode cannot use a worker (separate process, separate memory): the worker exits with code 2
  unless `DATABASE_URL` is set.

## Backup and recovery

`deployment/scripts/backup.sh` (run nightly from cron as root):

1. `pg_dump --format=custom` of the database to `/var/backups/unspin/db-<timestamp>.dump`.
2. `tar` of the blob root (filesystem mode). For S3 mode, enable bucket versioning/replication at the
   provider instead.
3. Keeps 14 days locally; copy off-instance (e.g. to a separate private bucket) with your tool of choice.

Managed PostgreSQL (Vultr/Tiger Data) also provides automated backups/point-in-time recovery; the
dump is an independent copy.

Restore (rehearse before launch):

```bash
systemctl stop unspin-web unspin-worker
pg_restore --clean --if-exists --no-owner -d "$DATABASE_URL" /var/backups/unspin/db-<ts>.dump
tar -C /var/lib/unspin -xzf /var/backups/unspin/blobs-<ts>.tar.gz
systemctl start unspin-worker unspin-web
curl -fsS https://your.domain/api/v1/health
```

Database and blobs are backed up separately, so a restore can contain a source row whose blob is
missing (the app reports "The stored source file is no longer available") or an orphan blob (harmless;
it is never addressable without its row).

## Supabase as the PostgreSQL provider

UNSPIN does not use the Supabase JS client, Auth, or Storage. Substitute only `DATABASE_URL`.

- Copy a Postgres URI from the project **Connect** panel ([current connection docs](https://supabase.com/docs/guides/database/connecting-to-postgres)).
- Use the **direct** connection (`:5432` on `db.<project>.supabase.co`) for migrations and for the Node web/worker processes. Those processes need session-level features (migration advisory lock, `FOR UPDATE SKIP LOCKED` job claims). Transaction pooler (`:6543`) is the wrong mode for that.
- On IPv4-only networks, use Supavisor **session** mode (`:5432` on `*.pooler.supabase.com`) instead of the direct IPv6 endpoint.
- Keep `sslmode=require` (or `verify-full` with the dashboard CA). Never `sslmode=no-verify`.
- Leave `UNSPIN_STORAGE_MODE=filesystem` (or configure the existing S3 adapter). Do not point blob storage at Supabase Storage without a new adapter.
- `npm run db:migrate` is unchanged. Schema uses ordinary PostgreSQL tables.

## Tiger Data as the PostgreSQL provider

- Create a Tiger Data (Timescale) service and use its connection string as `DATABASE_URL` with
  `sslmode=require`. Restrict access with the provider's IP allow list to the Vultr instance's
  egress IP if your plan offers it.
- The schema uses only ordinary PostgreSQL tables and needs no extension; `npm run db:migrate` runs
  unchanged on Tiger Data.
- Do **not** convert sources/datasets/versions/provenance/history/jobs to hypertables: they are not
  time-series. A hypertable is appropriate only for genuinely dated observations (e.g. recovered
  daily price series) and only together with a real product query (matching windows, aggregation)
  whose performance is measured on real data.
- Pool sizing: each web/worker process opens at most 10 connections; keep the total under the plan's
  connection limit.

## Data handling

See `deployment/DATA_POLICY.md` for deletion, retention, export encoding, identity, and sharing rules.
