#!/usr/bin/env bash
# Manually re-run schema push + seed (admin + firms). Idempotent. Useful after editing FIRMS_SEED or to
# (re)create the admin. Does NOT reset an existing admin's password.
source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"
require_docker
require_env_file
info "Running prisma db push + seed…"
dc run --rm migrate
ok "Seed complete."
