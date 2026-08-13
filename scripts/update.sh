#!/usr/bin/env bash
# Redeploy the latest code with minimal downtime: pull (if a git remote exists) → rebuild image →
# re-run migrate → recreate web/worker → health check. nginx/mysql/certbot are left running.
source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

require_docker
require_env_file
ensure_dirs

# 1) Get the latest code if this checkout tracks a remote; otherwise assume the files are already
#    updated (rsync/scp workflow) and continue.
if git rev-parse --git-dir >/dev/null 2>&1 && [ -n "$(git remote 2>/dev/null)" ]; then
  info "Pulling latest code (git)…"
  git pull --ff-only || die "git pull failed (non-fast-forward?). Resolve manually, then re-run."
else
  warn "No git remote — skipping pull. Deploying the code currently on disk."
fi

info "Rebuilding the application images…"
# Rebuild BOTH images: web (Dockerfile) AND worker (Dockerfile.worker). They are SEPARATE images now —
# building only web would leave the worker (which runs all PDF generation) on stale code.
dc build

# Remove the previous (completed) migrate container so compose re-runs it with the new schema —
# otherwise its `service_completed_successfully` condition is already satisfied and it would be skipped.
info "Applying schema changes + seed…"
dc rm -sf migrate >/dev/null 2>&1 || true

info "Recreating web + worker with the new image (migrate re-runs first)…"
dc up -d --wait web worker || warn "web/worker not healthy yet — check ./scripts/logs.sh web"
# Redact any password in a DATABASE_URL Prisma may echo on error, before it hits the console/logs.
dc logs --no-log-prefix migrate 2>/dev/null | sed -E 's#(mysql://[^:]*:)[^@]*@#\1***@#g' | tail -n 5 || true

# nginx/certbot configs may have changed too — reload nginx if it's running and its config is valid.
if dc exec nginx nginx -t >/dev/null 2>&1; then
  dc exec nginx nginx -s reload >/dev/null 2>&1 || true
fi

info "Pruning dangling images…"
docker image prune -f >/dev/null 2>&1 || true

echo
ok "Update complete."
dc ps
