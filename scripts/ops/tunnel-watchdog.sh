#!/bin/sh
# Testing setup only (a Cloudflare quick tunnel to a cloud VM). Quick tunnels can be dropped by Cloudflare at any time
# ("Tunnel not found"), which leaves the Netlify site unable to reach the server. Every 15 seconds this checks the
# public health URL; on "Tunnel not found" in the tunnel log, or after two failed checks in a row, it starts a new
# tunnel, restarts the game server with the new address, and pushes netlify.toml and vercel.json with the new
# VITE_API_URL to main so Netlify and Vercel rebuild the client (about a minute). Open tabs pick the new address up
# from /server.json and reload.
# Usage (in tmux): scripts/ops/tunnel-watchdog.sh <web-origin>
set -u
WEB_ORIGIN="$1"
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
unset TMUX
TM="tmux -f /exec-daemon/tmux.portal.conf"
url() { rg -o 'https://[a-z0-9-]+\.trycloudflare\.com' /tmp/tunnel.log 2>/dev/null | head -1; }
fails=0
while true; do
  current="$(url)"
  if [ -n "$current" ] && curl -sf -m 10 "$current/api/health" > /dev/null; then fails=0; else fails=$((fails + 1)); fi
  # A game server mid-restart fails the public check too; replacing a healthy tunnel then would only move the address.
  if [ "$fails" -gt 0 ] && ! curl -sf -m 5 http://localhost:2567/api/health > /dev/null; then fails=0; fi
  if tail -n 5 /tmp/tunnel.log 2>/dev/null | rg -q 'Tunnel not found'; then fails=2; fi
  if [ "$fails" -ge 2 ]; then
    echo "$(date -u +%FT%TZ) tunnel $current unreachable; replacing it"
    $TM kill-session -t game-tunnel 2>/dev/null
    mv /tmp/tunnel.log /tmp/tunnel.old.log 2>/dev/null
    $TM new-session -d -s game-tunnel "/tmp/cloudflared tunnel --no-autoupdate --url http://localhost:2567 2>&1 | tee /tmp/tunnel.log"
    for _ in $(seq 1 60); do [ -n "$(url)" ] && break; sleep 1; done
    next="$(url)"
    if [ -n "$next" ]; then
      $TM send-keys -t game-server C-c
      sleep 3
      $TM send-keys -t game-server "$REPO/scripts/ops/supervise.sh $HOME/lagos/run-server.sh $WEB_ORIGIN" C-m
      tree=/tmp/watchdog-main
      git -C "$REPO" fetch -q origin main && rm -rf "$tree" && git -C "$REPO" worktree prune && git -C "$REPO" worktree add -q "$tree" origin/main &&
        sed -i "s#https://[a-z0-9-]*\.trycloudflare\.com#$next#" "$tree/netlify.toml" "$tree/vercel.json" &&
        git -C "$tree" commit -qam "Point the Netlify and Vercel clients at the restarted game-server tunnel" &&
        git -C "$tree" push -q origin HEAD:main &&
        echo "$(date -u +%FT%TZ) now serving $next; Netlify is rebuilding"
      git -C "$REPO" worktree remove --force "$tree" 2>/dev/null
    fi
    fails=0
  fi
  sleep 15
done
