#!/bin/sh
# Compressed pg_dump of the game database, keeping the newest $KEEP files.
# Usage: DATABASE_URL=postgresql://... scripts/ops/backup.sh [interval-seconds]
# With an interval it loops (run it in tmux); without one it takes a single backup.
set -eu
BACKUP_DIR="${BACKUP_DIR:-$(dirname "$0")/../../backups}"
KEEP="${KEEP:-48}"
mkdir -p "$BACKUP_DIR"
backup() {
  file="$BACKUP_DIR/lagos-$(date -u +%Y%m%dT%H%M%SZ).dump"
  # Custom format is consistent (one snapshot) and restorable table by table with pg_restore.
  if pg_dump --format=custom --no-owner --file="$file.partial" "$DATABASE_URL"; then
    mv "$file.partial" "$file"
    echo "$(date -u +%FT%TZ) backup $file ($(du -h "$file" | cut -f1))"
  else
    rm -f "$file.partial"
    echo "$(date -u +%FT%TZ) backup FAILED" >&2
  fi
  ls -1t "$BACKUP_DIR"/lagos-*.dump 2>/dev/null | tail -n +"$((KEEP + 1))" | xargs -r rm -f
}
if [ "${1:-}" = "" ]; then backup; exit 0; fi
while true; do backup || true; sleep "$1"; done
