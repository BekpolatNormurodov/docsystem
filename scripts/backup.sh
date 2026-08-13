#!/usr/bin/env bash
# Snapshot the database + all uploaded files into ./backups/. Run from cron for daily backups, e.g.
#   0 3 * * *  cd /opt/docsystem && ./scripts/backup.sh >> backups/backup.log 2>&1
source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

require_docker
require_env_file
ensure_dirs

TS="$(date +%Y%m%d-%H%M%S)"
DB="$(env_get MYSQL_DATABASE)"
OUT="backups"

info "Dumping database '$DB'…"
# Read the credentials from the mysql container's OWN env (never pass the password on the host argv),
# and use MYSQL_PWD so it isn't visible in the container process list either. Write to a .partial file
# and only rename on success, so an interrupted dump never leaves a truncated "good" backup.
TMP="$OUT/db-$TS.sql.gz.partial"
if dc exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysqldump -uroot --single-transaction --routines --databases "$MYSQL_DATABASE"' | gzip > "$TMP"; then
  mv "$TMP" "$OUT/db-$TS.sql.gz"
  ok "DB → $OUT/db-$TS.sql.gz"
else
  rm -f "$TMP"
  die "mysqldump failed — no partial backup kept."
fi

info "Archiving uploaded files (exports, uploads, storage, data)…"
tar czf "$OUT/files-$TS.tar.gz" exports uploads storage data 2>/dev/null || warn "some file dirs were empty/missing"
ok "Files → $OUT/files-$TS.tar.gz"

# Retention: keep the 14 most recent of each kind.
info "Pruning old backups (keeping 14 newest of each)…"
ls -1t "$OUT"/db-*.sql.gz 2>/dev/null    | tail -n +15 | xargs -r rm -f
ls -1t "$OUT"/files-*.tar.gz 2>/dev/null | tail -n +15 | xargs -r rm -f

ok "Backup complete ($TS)."
