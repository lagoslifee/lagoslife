#!/bin/sh
# Keeps the game server running: restarts it after a crash, backing off when it fails repeatedly on start-up.
# Usage: scripts/ops/supervise.sh <command...>   e.g. scripts/ops/supervise.sh ~/lagos/run-server.sh https://example.netlify.app
# Every restart is appended to logs/supervisor.log. Money moves only in database transactions with idempotency keys,
# so a crash mid-request either committed fully or not at all; a retried request after restart is not charged twice.
set -u
LOG_DIR="${LOG_DIR:-$(dirname "$0")/../../apps/server/logs}"
mkdir -p "$LOG_DIR"
delay=2
while true; do
  started=$(date +%s)
  echo "$(date -u +%FT%TZ) start: $*" >> "$LOG_DIR/supervisor.log"
  "$@"
  code=$?
  ran=$(( $(date +%s) - started ))
  echo "$(date -u +%FT%TZ) exit $code after ${ran}s" >> "$LOG_DIR/supervisor.log"
  # A process that ran for a while gets an immediate restart; one that dies on start-up waits longer each time.
  if [ "$ran" -gt 60 ]; then delay=2; else delay=$(( delay * 2 > 60 ? 60 : delay * 2 )); fi
  sleep "$delay"
done
