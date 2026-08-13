# Deployment — docsystem

Production runs as a small Docker Compose stack behind Nginx, serving three domains over HTTPS:

| Domain | Purpose |
|---|---|
| `yuristsystem.uz` (+ `www`) | the main application |
| `dashboard.yuristsystem.uz` | same app, lands on the Konveyer dashboard (`/konveyer`) |
| `api.yuristsystem.uz` | the programmatic/API origin (same app; CORS for `*.yuristsystem.uz`) |

## Architecture

```
                         Internet (443/80)
                               │
                        ┌──────▼───────┐   Let's Encrypt
                        │    nginx     │◄──────┐ (webroot HTTP-01,
                        │  TLS + proxy │       │  auto-renew)
                        └──────┬───────┘   ┌───┴────┐
              proxy_pass http://web:5200   │ certbot│
                               │           └────────┘
                        ┌──────▼───────┐
                        │     web      │  Next.js app — LEAN,
                        │  (port 5200) │  node-slim, NO chromium
                        └──────┬───────┘
        enqueue every PDF job  │ (JOB_MODE=worker)
        ┌──────────────────────┼───────────────────────┐
        │                      │                        │
 ┌──────▼──────┐        ┌──────▼───────┐        ┌───────▼────────┐
 │   worker    │        │    mysql     │        │  migrate (1x)  │
 │  chromium   │        │  8.4 (vol)   │        │ db push + seed │
 │ ALL PDFs    │        └──────────────┘        └────────────────┘
 └─────────────┘
   shared bind mounts: ./exports ./uploads ./storage ./data
```

- **Two images.** `web` is lean (`Dockerfile`, node-slim, **no chromium**) — it serves requests and the
  REST integrations (hippo/cabinet/billing are all plain `fetch`). `worker` carries chromium
  (`Dockerfile.worker`, Playwright base) and is the **sole** PDF renderer — both the heavy bulk batches
  AND the single-case docs (the per-case `gen-*` routes create a one-case job and stream the result).
- **worker** runs one instance (see [WORKER.md](WORKER.md)); the one-shot **migrate** reuses the worker
  image (it needs the prisma CLI + tsx), runs `prisma db push` + seed, then exits; web/worker wait for it.
- **certbot** obtains and renews the TLS certificate; nginx reloads every 6h to pick up renewals.

## Prerequisites

- A Linux server (2 vCPU / 4 GB RAM minimum — chromium is memory-hungry) with **Docker Engine + Docker
  Compose v2**.
- DNS **A-records** for all four names pointing at the server IP:
  `yuristsystem.uz`, `www.yuristsystem.uz`, `dashboard.yuristsystem.uz`, `api.yuristsystem.uz`.
- Ports **80** and **443** open to the internet.

## First deploy

```bash
# 1. Get the code onto the server (git clone, or rsync this directory to e.g. /opt/docsystem)
cd /opt/docsystem

# 2. Generate secrets + config, then edit the two domain/email lines
./scripts/gen-secrets.sh
$EDITOR .env.production        # set BASE_DOMAIN, CERTBOT_EMAIL (secrets are already filled)

# 3. Build, migrate, start everything, and obtain SSL certificates
chmod +x scripts/*.sh
./scripts/deploy.sh
```

`deploy.sh` builds the image, brings up MySQL, runs migrate+seed, starts web+worker, then bootstraps
Let's Encrypt for all four hostnames and starts nginx+certbot. When it finishes, open
`https://yuristsystem.uz` and log in with the seed admin (printed by `gen-secrets.sh`).

> **Tip:** test the SSL flow first with `CERTBOT_STAGING=1` in `.env.production` (staging certs are
> untrusted but have generous rate limits). Once it works, set `CERTBOT_STAGING=0` and run
> `./scripts/init-ssl.sh --force`.

## Everyday operations

| Task | Command |
|---|---|
| Deploy latest code | `./scripts/update.sh` |
| Follow logs (all / one) | `./scripts/logs.sh` · `./scripts/logs.sh web` |
| Re-run schema push + seed | `./scripts/seed.sh` |
| Backup DB + files | `./scripts/backup.sh` |
| Reissue SSL | `./scripts/init-ssl.sh --force` |
| Container status | `docker compose --env-file .env.production ps` |
| Stop / start all | `docker compose --env-file .env.production down` / `... up -d` |

Every manual `docker compose` call needs `--env-file .env.production` (the scripts add it for you).

Automate daily backups via cron:

```cron
0 3 * * *  cd /opt/docsystem && ./scripts/backup.sh >> backups/backup.log 2>&1
```

## Configuration (`.env.production`)

| Key | Meaning |
|---|---|
| `MYSQL_ROOT_PASSWORD` / `MYSQL_USER` / `MYSQL_PASSWORD` / `MYSQL_DATABASE` | database credentials (password must be alphanumeric — it goes into the DSN) |
| `AUTH_SECRET` | session-signing key, ≥32 chars, not a placeholder (enforced in prod) |
| `DOCSYSTEM_ADMIN_USERNAME` / `DOCSYSTEM_ADMIN_PASSWORD` | seed admin (first migrate only) |
| `COOKIE_DOMAIN` | `.yuristsystem.uz` → one login shared across all three subdomains |
| `COOKIE_SECURE` | `1` once HTTPS is live (Secure cookie); `0` during first HTTP bring-up |
| `BASE_DOMAIN` / `CERTBOT_EMAIL` / `CERTBOT_STAGING` | used by the SSL scripts (not the app) |
| `EIMZO_MODE` | `server` (default) = server signs via local E-IMZO; `client` = the user's browser signs (see below) |
| `NEXT_PUBLIC_EIMZO_API_KEY` | client mode only: NIC domain API-KEY (`domain,hash,…`) for a real domain; empty on localhost |
| `EIMZO_WS_URL` | server mode only: optional E-IMZO endpoint override (see below) |
| `WORKER_CONCURRENCY` | parallel chromium renders on the worker/backend; scale with CPU cores (default 5, e.g. 12 on a big-CPU server) for faster document batches |

## Known limitations

### E-IMZO on a server
E-IMZO signing has two modes, selected by **`EIMZO_MODE`**:

**`EIMZO_MODE=server` (default).** The Node server signs by talking to the **E-IMZO desktop app on
`127.0.0.1:64443`** — i.e. the same machine as the server. This is the current Windows/desktop
deployment and is **unchanged**. A remote Linux server has no local E-IMZO, so key signing,
firm-connect, OneID→cabinet and hippo key-login are unavailable server-side unless you bridge to a
machine that runs E-IMZO and set `EIMZO_WS_URL` to that bridge (e.g. an `stunnel`/SSH tunnel exposing
the desktop's `64443`). Everything else (imports, document generation, portfolio,
talabnoma/oferta/packet PDFs, invoices, dashboards) works normally regardless of mode.

**`EIMZO_MODE=client`.** Each operator's **browser** talks to **their own** local E-IMZO; the server
only ever receives the finished PKCS7 (the private key + PIN never leave the user's machine). This lets
signing work from a remote Linux server without any bridge — the operator just needs the E-IMZO desktop
app running locally. The key picker enumerates and signs in the browser (`/e-imzo/eimzo-browser.js`).
- On **localhost / dev** it works out of the box (E-IMZO's built-in origin allowlist covers localhost).
- On a **real domain** the browser needs a NIC-issued domain API-KEY: set
  `NEXT_PUBLIC_EIMZO_API_KEY="domain,hash,…"` (exposed to the browser at build time — it is a domain
  allowlist, not a secret). Without it, a non-localhost origin is rejected by E-IMZO.

Security note: in client mode the signer's cert fields arrive from the browser (untrusted). The server
does **not** store a firm's session on the client-claimed cert alone — after the external login succeeds
it reconciles the STIR that hippo (access_token claims) / cabinet (`/user/get`) report against the
firm's STIR and rejects a mismatch (`src/lib/eimzo-verify.ts`). Server mode's cert guard is unchanged.

### Migrating existing Windows data
Firm-doc / case-doc paths written on Windows are absolute `C:\…` strings a Linux container can't read.
A **fresh** server DB is fine; migrating an existing one requires re-pointing those paths to
`/app/exports/...` (see [WORKER.md](WORKER.md)).

## Troubleshooting

- **nginx won't start / "cannot load certificate"** — no cert yet. Run `./scripts/init-ssl.sh`.
- **certbot fails** — DNS A-records must point at this server and ports 80/443 must be open. Verify with
  `curl http://yuristsystem.uz/.well-known/acme-challenge/test` after placing a test file.
- **web unhealthy** — `./scripts/logs.sh web`; usually a bad `DATABASE_URL` (non-alphanumeric MySQL
  password) or `AUTH_SECRET` rejected as too short / a placeholder.
- **login doesn't persist across subdomains** — check `COOKIE_DOMAIN=.yuristsystem.uz`.
- **`docker compose` says a variable is not set** — you forgot `--env-file .env.production`.

## Local development

You don't need the full stack to develop — just a database:

```bash
docker compose -f docker-compose.dev.yml up -d      # MySQL on localhost:3307
# .env → DATABASE_URL="mysql://docsystem:docsystem@localhost:3307/docsystem"
npm run dev            # web on :5200
npm run worker         # (optional) heavy jobs in a second terminal
```
