#!/usr/bin/env bash
# One-time Let's Encrypt bootstrap for all four hostnames (apex + www + dashboard + api) into a single
# SAN certificate at live/$BASE_DOMAIN. Safe to re-run; pass --force to reissue even if a cert exists.
#
# Flow (the classic nginx+certbot chicken-and-egg dance):
#   1. write a throwaway self-signed cert so nginx can start at all
#   2. start nginx (now serving the ACME challenge on :80)
#   3. delete the dummy, ask certbot for the real cert via webroot HTTP-01
#   4. reload nginx to pick up the real cert
source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

require_docker
require_env_file

FORCE=0
[ "${1:-}" = "--force" ] && FORCE=1

DOMAIN="$(env_get BASE_DOMAIN)";  [ -n "$DOMAIN" ] || die "BASE_DOMAIN not set in $ENV_FILE"
EMAIL="$(env_get CERTBOT_EMAIL)"; [ -n "$EMAIL" ]  || die "CERTBOT_EMAIL not set in $ENV_FILE"
STAGING="$(env_get CERTBOT_STAGING)"; STAGING="${STAGING:-0}"

DOMAINS=("$DOMAIN" "www.$DOMAIN" "dashboard.$DOMAIN" "api.$DOMAIN")
CERT_PATH="/etc/letsencrypt/live/$DOMAIN/fullchain.pem"
LIVE_DIR="/etc/letsencrypt/live/$DOMAIN"

# certbot -d flags
D_ARGS=()
for d in "${DOMAINS[@]}"; do D_ARGS+=(-d "$d"); done

STAGING_ARG=""
[ "$STAGING" = "1" ] && { STAGING_ARG="--staging"; warn "Using Let's Encrypt STAGING (certs will be UNTRUSTED)."; }

info "Bootstrapping SSL for: ${DOMAINS[*]}"

# Is there already a REAL (non-dummy) cert? certbot marks dummies as self-signed; we detect our marker CN.
if [ "$FORCE" -ne 1 ] && dc run --rm --entrypoint sh certbot -c "[ -f $CERT_PATH ] && ! openssl x509 -in $CERT_PATH -noout -issuer | grep -qiE 'CN *= *dummy'" 2>/dev/null; then
  ok "A certificate already exists for $DOMAIN. Use --force to reissue. Reloading nginx and exiting."
  dc up -d nginx
  dc exec nginx nginx -s reload 2>/dev/null || true
  exit 0
fi

# 1) Dummy self-signed cert so nginx can boot (issuer CN=dummy is our 'not real yet' marker).
info "Writing a temporary self-signed certificate so nginx can start…"
dc run --rm --entrypoint sh certbot -c "
  mkdir -p $LIVE_DIR &&
  openssl req -x509 -nodes -newkey rsa:2048 -days 1 \
    -keyout $LIVE_DIR/privkey.pem -out $LIVE_DIR/fullchain.pem \
    -subj '/CN=dummy'"

# 2) Start (or restart) nginx with the dummy cert in place.
info "Starting nginx…"
dc up -d nginx
sleep 3
dc exec nginx nginx -s reload 2>/dev/null || true

# 3) Remove the dummy and request the real certificate over HTTP-01.
info "Requesting the real certificate from Let's Encrypt…"
dc run --rm --entrypoint sh certbot -c "rm -rf /etc/letsencrypt/live/$DOMAIN /etc/letsencrypt/archive/$DOMAIN /etc/letsencrypt/renewal/$DOMAIN.conf"
dc run --rm --entrypoint certbot certbot certonly \
  --webroot -w /var/www/certbot \
  $STAGING_ARG \
  --email "$EMAIL" --agree-tos --no-eff-email \
  --rsa-key-size 4096 \
  --non-interactive \
  "${D_ARGS[@]}" \
  || die "certbot failed. Check that DNS A-records for ${DOMAINS[*]} point at THIS server and ports 80/443 are open."

# 4) Reload nginx with the real cert, and make sure the renewal daemon is running.
info "Reloading nginx with the real certificate…"
dc exec nginx nginx -s reload
dc up -d certbot

ok "SSL is live for ${DOMAINS[*]}. Renewal runs automatically (certbot every 12h, nginx reloads every 6h)."
