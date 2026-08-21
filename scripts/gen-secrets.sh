#!/usr/bin/env bash
# Create .env.production from the example with strong random secrets pre-filled. Never overwrites an
# existing .env.production (your secrets are precious) — pass --force to regenerate from scratch.
source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

FORCE=0
[ "${1:-}" = "--force" ] && FORCE=1

TARGET=".env.production"
EXAMPLE=".env.production.example"
[ -f "$EXAMPLE" ] || die "$EXAMPLE missing."
if [ -f "$TARGET" ] && [ "$FORCE" -ne 1 ]; then
  die "$TARGET already exists. Refusing to overwrite. Use --force to regenerate (this changes all secrets)."
fi

rnd() { openssl rand -hex "${1:-24}"; }              # hex → always URL/DSN-safe
AUTH_SECRET_V="$(rnd 32)"                            # 64 hex chars ≥ 32
MYSQL_ROOT_V="$(rnd 20)"
MYSQL_PW_V="$(rnd 20)"
ADMIN_PW_V="$(rnd 12)"

# Fill placeholders; leave BASE_DOMAIN/CERTBOT_EMAIL for the user to edit.
sed \
  -e "s|^MYSQL_ROOT_PASSWORD=.*|MYSQL_ROOT_PASSWORD=${MYSQL_ROOT_V}|" \
  -e "s|^MYSQL_PASSWORD=.*|MYSQL_PASSWORD=${MYSQL_PW_V}|" \
  -e "s|^AUTH_SECRET=.*|AUTH_SECRET=${AUTH_SECRET_V}|" \
  -e "s|^DOCSYSTEM_ADMIN_PASSWORD=.*|DOCSYSTEM_ADMIN_PASSWORD=${ADMIN_PW_V}|" \
  "$EXAMPLE" > "$TARGET"
chmod 600 "$TARGET"

ok "Wrote $TARGET (mode 600) with fresh secrets."
warn "Now EDIT $TARGET and set: BASE_DOMAIN, CERTBOT_EMAIL (and COOKIE_DOMAIN if not *.yuristsystem.uz)."
echo
echo "  Seed admin login : $(env_get DOCSYSTEM_ADMIN_USERNAME)"
# Don't print the password to the terminal/scrollback. It's in $TARGET; read it deliberately when needed:
echo "  Seed admin pass  : stored in $TARGET → run:  grep DOCSYSTEM_ADMIN_PASSWORD $TARGET"
echo "                     (change it in the UI after first login)"
