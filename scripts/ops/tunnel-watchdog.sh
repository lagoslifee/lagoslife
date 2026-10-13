#!/bin/sh
# Testing setup only (Cloudflare quick tunnels to a cloud VM). Quick tunnels can be dropped by Cloudflare at any time
# ("Tunnel not found"), so two run side by side: the site lists both (VITE_API_URL and VITE_API_FALLBACK_URL, also in
# /server.json) and open tabs move to the other one the moment theirs stops answering. Every 15 seconds this checks
# each tunnel's public health URL; on "Tunnel not found", or after two failed checks in a row, it replaces that tunnel
# and pushes netlify.toml and vercel.json with both addresses to main so Netlify and Vercel rebuild the client.
# The game server keeps running throughout: its BETTER_AUTH_URL does not depend on the tunnel addresses.
# Usage (in tmux): scripts/ops/tunnel-watchdog.sh
set -u
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
unset TMUX
TM="tmux -f /exec-daemon/tmux.portal.conf"
url() { rg -o 'https://[a-z0-9-]+\.trycloudflare\.com' "$1" 2>/dev/null | head -1; }
healthy() { [ -n "$1" ] && curl -sf -m 10 "$1/api/health" > /dev/null; }

# $1 tmux session, $2 log file
start_tunnel() {
  $TM kill-session -t "$1" 2>/dev/null
  mv "$2" "$2.old" 2>/dev/null
  $TM new-session -d -s "$1" "/tmp/cloudflared tunnel --no-autoupdate --url http://localhost:2567 2>&1 | tee $2"
  for _ in $(seq 1 60); do [ -n "$(url "$2")" ] && break; sleep 1; done
  echo "$(date -u +%FT%TZ) $1 now serving $(url "$2")"
}

publish() {
  live="$(url /tmp/tunnel.log)"
  standby="$(url /tmp/tunnel-b.log)"
  [ -n "$live" ] && [ -n "$standby" ] || return
  tree=/tmp/watchdog-main
  git -C "$REPO" fetch -q origin main && rm -rf "$tree" && git -C "$REPO" worktree prune && git -C "$REPO" worktree add -q "$tree" origin/main &&
    sed -E -i "s#(VITE_API_URL=)[^ \"]*#\1$live#; s#(VITE_API_FALLBACK_URL=)[^ \"]*#\1$standby#" "$tree/vercel.json" &&
    sed -E -i "s#(VITE_API_URL = \")[^\"]*#\1$live#; s#(VITE_API_FALLBACK_URL = \")[^\"]*#\1$standby#" "$tree/netlify.toml" &&
    { git -C "$tree" diff --quiet || {
      git -C "$tree" commit -qam "Point the Netlify and Vercel clients at the game-server tunnels" &&
        git -C "$tree" push -q origin HEAD:main &&
        echo "$(date -u +%FT%TZ) published $live (standby $standby); the site is rebuilding"
    }; }
  git -C "$REPO" worktree remove --force "$tree" 2>/dev/null
}

[ -n "$(url /tmp/tunnel.log)" ] || start_tunnel game-tunnel /tmp/tunnel.log
[ -n "$(url /tmp/tunnel-b.log)" ] || start_tunnel game-tunnel-b /tmp/tunnel-b.log
publish

fails_a=0
fails_b=0
while true; do
  changed=0
  # A game server mid-restart fails both public checks; replacing healthy tunnels then would only move the addresses.
  if curl -sf -m 5 http://localhost:2567/api/health > /dev/null; then
    if healthy "$(url /tmp/tunnel.log)"; then fails_a=0; else fails_a=$((fails_a + 1)); fi
    if healthy "$(url /tmp/tunnel-b.log)"; then fails_b=0; else fails_b=$((fails_b + 1)); fi
    tail -n 5 /tmp/tunnel.log 2>/dev/null | rg -q 'Tunnel not found' && fails_a=2
    tail -n 5 /tmp/tunnel-b.log 2>/dev/null | rg -q 'Tunnel not found' && fails_b=2
    if [ "$fails_a" -ge 2 ]; then
      echo "$(date -u +%FT%TZ) game-tunnel $(url /tmp/tunnel.log) unreachable; replacing it"
      start_tunnel game-tunnel /tmp/tunnel.log
      fails_a=0
      changed=1
    fi
    if [ "$fails_b" -ge 2 ]; then
      echo "$(date -u +%FT%TZ) game-tunnel-b $(url /tmp/tunnel-b.log) unreachable; replacing it"
      start_tunnel game-tunnel-b /tmp/tunnel-b.log
      fails_b=0
      changed=1
    fi
    [ "$changed" = 1 ] && publish
  else
    fails_a=0
    fails_b=0
  fi
  sleep 15
done
