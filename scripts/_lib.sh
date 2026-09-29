#!/usr/bin/env bash
# Shared helpers for the docsystem ops scripts. Sourced (not executed) by the others.
# Always operate from the repo root and route every compose call through `.env.production`.
set -euo pipefail

# Resolve repo root = the parent of this script's directory, and cd into it.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

ENV_FILE="${ENV_FILE:-.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"

# Colored logging.
_c() { printf '\033[%sm%s\033[0m\n' "$1" "$2"; }
info()  { _c '0;36' "→ $*"; }
ok()    { _c '0;32' "✓ $*"; }
warn()  { _c '0;33' "! $*"; }
err()   { _c '0;31' "✗ $*" >&2; }
die()   { err "$*"; exit 1; }

# `dc ...` == docker compose, always with our env file + compose file.
dc() { docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"; }

require_env_file() {
  [ -f "$ENV_FILE" ] || die "$ENV_FILE not found. Copy .env.production.example → $ENV_FILE and fill it (or run ./scripts/gen-secrets.sh)."
}

require_docker() {
  command -v docker >/dev/null 2>&1 || die "docker is not installed."
  docker compose version >/dev/null 2>&1 || die "docker compose v2 is required."
}

# Load a single KEY from the env file (strips surrounding quotes). Usage: v="$(env_get BASE_DOMAIN)"
env_get() {
  local key="$1"
  # last matching non-comment assignment wins
  grep -E "^${key}=" "$ENV_FILE" 2>/dev/null | tail -n1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"
}

# Ensure the host bind-mount dirs exist (compose won't create nested host paths for you on all engines).
ensure_dirs() {
  mkdir -p exports uploads storage data backups
}

# Catch config that would silently corrupt the DATABASE_URL or be rejected by the app at runtime.
validate_secrets() {
  local pw as
  pw="$(env_get MYSQL_PASSWORD)"
  as="$(env_get AUTH_SECRET)"
  case "$pw" in
    '')             die "MYSQL_PASSWORD is empty in $ENV_FILE." ;;
    *[!A-Za-z0-9]*) die "MYSQL_PASSWORD must be alphanumeric (it is embedded verbatim in DATABASE_URL). Regenerate: ./scripts/gen-secrets.sh --force" ;;
  esac
  [ "${#as}" -ge 32 ] || die "AUTH_SECRET must be ≥32 characters (got ${#as}). Regenerate: ./scripts/gen-secrets.sh --force"
}
