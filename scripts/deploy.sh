#!/usr/bin/env bash
# First-time (or full) deploy on a fresh server. Idempotent — safe to re-run.
#   build image → bring up DB → migrate+seed → web+worker → SSL bootstrap → nginx+certbot
source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

require_docker
require_env_file
validate_secrets
ensure_dirs

info "Building the application image (this pulls the Playwright base on first run — a few minutes)…"
dc build

info "Starting MySQL…"
dc up -d --wait mysql || die "MySQL did not become healthy. Check: ./scripts/logs.sh mysql"

# Bringing up web/worker drives the dependency chain: compose runs the one-shot `migrate` service
# (prisma db push + seed) to successful completion FIRST, then starts web + worker. Single run, no hang.
info "Migrating + seeding, then starting web + worker…"
dc up -d --wait web worker || warn "web/worker did not report healthy yet — check ./scripts/logs.sh web"
info "Seed / migrate output:"
# Redact any password in a DATABASE_URL Prisma may echo on error, before it hits the console/logs.
dc logs --no-log-prefix migrate 2>/dev/null | sed -E 's#(mysql://[^:]*:)[^@]*@#\1***@#g' | tail -n 5 || true

# SSL: bootstrap on first deploy, otherwise just ensure the edge is up.
DOMAIN="$(env_get BASE_DOMAIN)"
if dc run --rm --entrypoint sh certbot -c "[ -f /etc/letsencrypt/live/$DOMAIN/fullchain.pem ] && ! openssl x509 -in /etc/letsencrypt/live/$DOMAIN/fullchain.pem -noout -issuer | grep -qiE 'CN *= *dummy'" 2>/dev/null; then
  info "Certificate present — starting nginx + certbot."
  dc up -d nginx certbot
  dc exec nginx nginx -s reload 2>/dev/null || true
else
  warn "No real certificate yet — running the SSL bootstrap."
  info "Make sure DNS A-records for ${DOMAIN}, www.${DOMAIN}, dashboard.${DOMAIN}, api.${DOMAIN} point HERE."
  ./scripts/init-ssl.sh
fi

echo
ok "Deploy complete."
dc ps
echo
echo "  Open:  https://${DOMAIN}   ·   https://dashboard.${DOMAIN}   ·   https://api.${DOMAIN}"
echo "  Logs:  ./scripts/logs.sh [service]     Update: ./scripts/update.sh     Backup: ./scripts/backup.sh"
