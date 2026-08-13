# docsystem

Debt-collection pipeline (talabnoma → Sanoat palatasi → Sud → MIB) for **yuristsystem.uz**.
Next.js 14 (App Router) + Prisma/MySQL. Heavy court-PDF rendering (talabnoma / oferta / to'liq paket)
runs in a separate chromium **worker**, so the web process stays lean.

## Production deploy

Full guide: **[DEPLOYMENT.md](DEPLOYMENT.md)**. TL;DR on a Linux server with Docker + Compose v2:

```bash
./scripts/gen-secrets.sh          # generate .env.production with strong secrets
$EDITOR .env.production            # set BASE_DOMAIN + CERTBOT_EMAIL
./scripts/deploy.sh                # build + DB + migrate/seed + web/worker + SSL
```

Serves **yuristsystem.uz**, **dashboard.yuristsystem.uz**, **api.yuristsystem.uz** over HTTPS.
`make help` lists every ops shortcut.

## Local development

```bash
docker compose -f docker-compose.dev.yml up -d     # MySQL on localhost:3307
# .env → DATABASE_URL="mysql://docsystem:docsystem@localhost:3307/docsystem"
npm run dev                                          # web on :5200
npm run worker                                        # (optional) heavy jobs in a 2nd terminal
```

## Layout

| Path | What |
|---|---|
| `Dockerfile` | lean **web** image (node-slim, no chromium) |
| `Dockerfile.worker` | **worker** image (Playwright/chromium) |
| `docker-compose.yml` | full stack: mysql · migrate · web · worker · nginx · certbot |
| `docker-compose.dev.yml` | just MySQL, for local dev |
| `docker/nginx/` | reverse proxy + TLS for the 3 domains |
| `scripts/` | deploy · update · init-ssl · backup · seed · logs · gen-secrets |
| `.github/workflows/ci.yml` | typecheck · tests · image build |
| `DEPLOYMENT.md` · `WORKER.md` | deploy guide · background-worker details |
