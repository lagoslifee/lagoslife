# Operations

Nothing in this repository deploys itself. Public hosting, domains, managed
databases and email providers all cost money and need the owner's approval
before anyone sets them up.

## Local development

`docker compose up -d postgres mailpit`, `npm run db:migrate`, `npm run dev`
(see the [README](../README.md)). Secrets for local tools, such as the Meshy key,
live only in the gitignored `apps/server/.env`.

## Production build

| Piece | How it is built | Output |
|---|---|---|
| Server | `npm run build -w @lagos-living/server` bundles `index`, `migrate` and `staff` with esbuild, inlining `@lagos-living/shared`. Runtime dependencies stay external. | `apps/server/dist/*.js` (index about 250 KB), run with `node` and production dependencies only |
| Web | `VITE_API_URL=https://api.example.com npm run build -w @lagos-living/web` | Static files in `apps/web/dist` |

The web build puts Babylon (2.04 MB, 472 KB gzipped) and React (219 KB) in
their own content-hashed chunks, separate from the game code (356 KB) and the
entry chunk (230 KB). Releases that only change game code leave the Babylon
chunk cached. Shader and material chunks that Babylon loads on demand stay
separate and lazy.

`apps/web/nginx.conf` serves the build:

- Hashed `/assets/*-xxxxxxxx.js|css` files are served `immutable` for a year.
- Models, textures and world tiles keep stable names and revalidate after an hour.
- `index.html` is `no-cache`, and unknown paths (for example `/moderation`) fall back to it.
- JSON, JS, CSS and `.glb` are gzipped.

### Production configuration guards

With `NODE_ENV=production` the server refuses to start if:

- `BETTER_AUTH_SECRET` is the development default;
- `WEB_ORIGIN` or `BETTER_AUTH_URL` is not `https://` (plain-http localhost is allowed, for smoke tests).

It also defaults `DATABASE_SSL` to `require`, which verifies the database
certificate. Every `/api/dev/*` route answers 404 before authentication unless
the server is in development and reached on localhost. That covers automatic
sign-in, progress reset, spawn-at, staff grants and test citations.

## Netlify web client

`netlify.toml` builds the web client from the repository root
(`npm run build -w @lagos-living/web`), publishes `apps/web/dist`, and routes
unknown paths to `index.html`. Netlify serves static files only. The game
server (Express, Colyseus WebSockets, PostgreSQL) has to run on a host that
keeps Node processes alive, such as the compose stack below.

- In the Netlify site settings, set the environment variable `VITE_API_URL` to
  the game server's HTTPS origin and redeploy. Without it, the site shows a
  "game server not configured" screen. Don't put it in `netlify.toml`: values
  there override the dashboard. (It used to point at a Cloudflare quick tunnel
  to a development VM, which stopped working when that VM went away.)
- Set the server's `WEB_ORIGIN` to the Netlify site's origin, or the server
  rejects the requests.
- Sign-in cookies are set by the API origin. Browsers block cookies between
  unrelated sites (for example `*.netlify.app` and another provider's domain),
  so sign-in only works reliably when the web client and API share a parent
  domain: for example `play.example.com` on Netlify and `api.example.com` for
  the server. Guest mode (`VITE_GUEST_MODE` and `GUEST_MODE`) sends the
  session as `Authorization: Bearer` instead, so it works across unrelated
  domains.

## Vercel web client

`vercel.json` defines one Vercel service, `web`, rooted at `apps/web/`. It
installs and builds from the repository root (the client imports the shared
workspace package), publishes `apps/web/dist`, sends unknown paths to
`index.html` and sets the same headers as Netlify. Import the repository at its
root and Vercel reads the service from this file. Vercel only serves the client:
the game server keeps WebSockets and a PostgreSQL pool open, so it still runs
on its own host.

- While testing, the build command carries the quick-tunnel `VITE_API_URL`, and
  `scripts/ops/tunnel-watchdog.sh` rewrites it in both `netlify.toml` and
  `vercel.json` when the tunnel changes.
- Add the Vercel site to the server as `EXTRA_WEB_ORIGINS=https://<project>.vercel.app`
  (comma-separated for several) so CORS and sign-in accept it alongside
  `WEB_ORIGIN`. `https://*.vercel.app` covers every deployment and preview URL;
  without it, sign-up from Vercel fails with "Invalid origin".
- Keep Vercel access tokens out of the repository; add them as secrets in the
  host's dashboard.

## Render game server

`render.yaml` is a Render Blueprint for the server and a PostgreSQL 17
database, both on Render's free plan in Frankfurt (the closest region to
Lagos).

1. Render dashboard → **New** → **Blueprint**, connect this GitHub repository
   and apply it. Render builds `apps/server/Dockerfile`, generates
   `BETTER_AUTH_SECRET`, and wires `DATABASE_URL` to the database.
2. Each start runs `node dist/migrate.js` (already-applied migrations are
   skipped) and then the server. `BETTER_AUTH_URL` defaults to the service's
   `onrender.com` address.
3. Copy the service URL (for example `https://lagos-living-server.onrender.com`)
   into Netlify's `VITE_API_URL` and redeploy the Netlify site.
4. `WEB_ORIGIN` is `https://silver-elf-acde6c.netlify.app`. Change it in the
   service's environment if the web client moves.

Free-plan limits: the service sleeps after 15 minutes without traffic, and the
first visit after that waits about a minute for it to wake. A free Render
database expires 30 days after creation. For a lasting deployment, upgrade
both, or point `DATABASE_URL` at another managed PostgreSQL (keep
`DATABASE_SSL=require` for a database reached over the internet). Password-reset
email needs `SMTP_*` variables; guest mode doesn't use them.

## Single-host stack (`docker-compose.prod.yml`)

```bash
cp .env.production.example .env.production   # gitignored; fill every value
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

| Service | Role |
|---|---|
| `postgres` | PostgreSQL 17 on the compose network only (no published port), data in the `postgres_data` volume |
| `migrate` | One-off `node dist/migrate.js`. Starts after Postgres is healthy and must succeed before the server starts |
| `server` | API and Colyseus on `127.0.0.1:${SERVER_PORT:-2567}`. Runs as the `node` user, health check on `/api/health` |
| `web` | nginx on `127.0.0.1:${WEB_PORT:-8080}` serving the build for `API_ORIGIN` (a build argument) |

Both published ports bind to loopback. A TLS reverse proxy on the host (or a
managed load balancer) must provide:

- HTTPS for `WEB_ORIGIN`, forwarding to the web port;
- HTTPS **and WebSocket upgrade** for `API_ORIGIN`, forwarding to the server
  port, with read timeouts well above a minute so idle game sockets stay open;
- a client address in `X-Forwarded-For`. Better Auth rate-limits sign-in and
  sign-up per client IP and reads only that header. Without it, every player
  shares one bucket and the server logs a warning. Either overwrite the header
  with the client address, or append to it and list the proxy's address in
  `TRUSTED_PROXIES`. Don't expose the server port directly: a client could
  then forge the header.

Example nginx server block for the API:

```nginx
location / {
  proxy_pass http://127.0.0.1:2567;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $remote_addr;   # overwrite, not append
  proxy_read_timeout 3600s;
}
```

`DATABASE_SSL=disable` is only acceptable because the compose database is
reachable on the private compose network alone. With a managed database, set
`DATABASE_SSL=require`, use point-in-time recovery and give the application a
least-privilege role. Use URL-safe characters for `POSTGRES_PASSWORD`
(`openssl rand -hex 24`), because it is placed in a connection URL.

### What has been verified

On the development VM, with Docker 29.1 using the `vfs` storage driver:

- Both images built. The server image is 289 MB, runs as uid 1000, and contains no `.env` file.
- `up` against an empty volume applied all eight migrations, and `server` and `web` reported healthy.
- The production smoke test (below) passed against the containers in 1.2 min.
- `node dist/staff.js` inside the container granted a role and wrote the audit row.
- `pg_dump` and `pg_restore` round-tripped into a scratch database.

On this VM, containers on the compose network could only reach each other
after adding a forwarding rule for leftover legacy iptables state. That is a
quirk of the VM, not of the compose file. Nothing has been deployed to a public
host, and no TLS proxy configuration has been exercised.

## Smoke test against a built stack

`apps/web/e2e-prod/smoke.spec.ts` uses only the page, because production
bundles don't ship the development test hooks. Two new residents sign up (the
first via `/`, proving development sign-in is refused), both enter Lekki and see
each other online, and one hears the other's chat with the phone number masked.
The test then reloads to check the session survives, checks every
`/api/dev/*` route returns 404, and checks the cache headers.

```bash
SMOKE_WEB_URL=http://localhost:8080 SMOKE_API_URL=http://localhost:2567 \
  npm run test:e2e:prod -w @lagos-living/web
```

## Staff roles

The first admin has to be granted from a shell, because only admins can grant
roles in the console. The grant is recorded in the moderation audit log as a
`server console` action:

```bash
npm run staff:role -w @lagos-living/server -- <username> admin "Initial administrator"
docker compose -f docker-compose.prod.yml --env-file .env.production \
  exec server node dist/staff.js <username> moderator "<reason>"
```

`none` removes a role. After that, admins manage roles in the moderation
console's Staff tab (`/moderation`).

## Moderation data and retention

- Chat lines are stored before they are broadcast. If storing fails, the line
  isn't sent. Each row keeps the original text and the masked text players saw.
- Chat older than 30 days is deleted every 6 hours, except lines attached to an
  open report. Those stay until the report is resolved.
- `moderation_audit` and `justice_event` are append-only (a database trigger
  rejects updates and deletes) and have no foreign keys, so they survive
  account deletion.
- A suspension blocks API calls (403) and multiplayer tokens, and removes the
  player from the live room immediately. Mutes apply to the live room at once.
- Moderators can't act on themselves, on admins, or (unless they are admins)
  on other moderators. Nobody decides an appeal against their own citation.

## Load testing

`npm run load-test -w @lagos-living/server -- --bots 40 --duration 60 --ramp 10 --json /tmp/load.json`

Bots are real accounts (`LoadBotNN@lagosliving.local`). Each signs in, takes a
multiplayer token, joins the room, jogs the danfo loop at 10 position updates
per second and chats now and then. Only received data is measured: snapshot
rate and gaps, bytes, visible players, corrections, chat latency, plus server
CPU and RSS when `--server-pid` is given. `--cleanup` deletes the bot
accounts. The harness refuses non-local targets unless
`LOAD_TEST_ALLOW_REMOTE=1` is set; only use that against an environment you
are authorised to load. Against a production build, sign-ins are rate-limited
per IP, so bots wait out 429 responses and join times include those waits.
Measured results and caveats are in
[test results](TEST_RESULTS.md#load-test-milestone-8).

## Capacity and scaling limits

- One Node process runs one `lagos` room, capped at 100 players. A 101st
  player gets a second room instance, which is a separate city: players in
  different rooms don't see each other.
- Each snapshot carries at most the 40 nearest players within 180 m.
- Rate-limit counters live in Postgres: Better Auth's (production only) in its
  `rateLimit` table and the per-player limit on money-moving routes (25 per
  10 s) in `request_rate`. Every server process enforces the same counts;
  expired `request_rate` windows are purged hourly.

## Several server processes

Set `REDIS_URL` on every server process to share one Redis. Colyseus then
matchmakes across processes (`RedisPresence`/`RedisDriver`), and the server
relays its in-process events over Redis pub/sub. That covers vehicle changes,
appearance changes, blocks and sanctions, player positions and progress
resets. So an HTTP request handled by one process still reaches a room hosted
by another, and proximity checks (shops, the parcel hub, sleeping at home) see
players wherever their room runs. Without `REDIS_URL` nothing changes: one
process, events stay local.

- A room still lives in one process. Extra processes host extra rooms when one
  fills (each a separate city) and share the HTTP load; they don't make one
  room hold more than 100 players.
- Each process needs its own `PUBLIC_ADDRESS` (`host[:port][/path]`) that
  clients can reach directly, because a seat reservation sends the client to
  the process hosting the room. Behind a reverse proxy that means one route per
  process (for example `api.example.com/p1`). HTTP API requests can go to any
  process; sessions live in Postgres.
- Redis must not be public. `docker-compose.prod.yml` has a `redis` service
  under the `cluster` profile with no published port
  (`docker compose --profile cluster ...`); set
  `REDIS_URL=redis://redis:6379` for the server.
- `npm run cluster-check -w @lagos-living/server -- --a http://localhost:2571 --b http://localhost:2572`
  checks two running processes: same room, players see each other, and an HTTP
  change and a position check through each process. Results are in
  [test results](TEST_RESULTS.md#several-server-processes).

## Backup and restore

```bash
# Development compose
docker compose exec -T postgres pg_dump -U lagos -Fc lagos_living > backup.dump
# Production compose
docker compose -f docker-compose.prod.yml --env-file .env.production \
  exec -T postgres pg_dump -U lagos -Fc lagos_living > backup.dump
# Restore into a scratch database first, check it, then restore for real
docker compose -f docker-compose.prod.yml --env-file .env.production exec -T postgres createdb -U lagos restore_check
docker compose -f docker-compose.prod.yml --env-file .env.production \
  exec -T postgres pg_restore -U lagos -d restore_check < backup.dump
```

Rotating backups without Docker (keeps the newest 48 by default, `KEEP=` to change):

```bash
DATABASE_URL=postgresql://... scripts/ops/backup.sh          # one backup into ./backups
DATABASE_URL=postgresql://... scripts/ops/backup.sh 3600     # every hour, in tmux
```

## Crashes, restarts and recovery

- **Health.** `GET /api/health` answers while the process is up. `GET /api/health/deep` also pings the database
  (503 if it does not answer within 3 s) and reports instances, players, uptime, memory and errors since start.
- **Server crash log.** Uncaught exceptions and unhandled promise rejections are appended as JSON lines to
  `apps/server/logs/server.log` (`LOG_DIR` to change; rotated at 5 MB). An uncaught exception exits the process on
  purpose, because its state is unknown after one; a rejected promise is logged and the server keeps running.
- **Browser reports.** Clients post errors, WebGL context loss and recovery, disconnects (with close code and whether
  the phone was offline or backgrounded), sustained frame rates under 15 fps, and "previous session ended without
  closing" (a likely tab kill) to `POST /api/diagnostics`. They land in `apps/server/logs/client.log`, limited to
  30 reports per address per 10 minutes. Nothing personal beyond the account id and browser user agent is stored.
- **Controlled restarts.** Run the server under `scripts/ops/supervise.sh <command>`: it restarts after any exit and
  backs off up to 60 s if the process dies on start-up. Restarts are logged to `logs/supervisor.log`.
- **What a restart does not lose or repeat.** Money, tickets, bookings, rides, tows and purchases are written in single
  database transactions keyed by an idempotency key, so a request is either fully saved or not at all, and a client
  retry after a restart returns the original result instead of charging again. Positions are saved every few seconds and
  on leave, never on browser-close events. On rejoin, players are put back on their saved trip stage (in the air,
  at the arrival airport, in the hotel); a flight that landed while they were away puts them at the arrival airport.
  In-progress tows and rides are reloaded from the database. What *is* lost: the last few seconds of walking, NPC and
  traffic positions, and an unfinished boarding window (passengers who had boarded keep their seat and land normally).
- **Restore after a bad deploy or data loss.** Stop the server, restore the newest good dump into a scratch database,
  check it, then restore over the live one:

  ```bash
  createdb restore_check && pg_restore --no-owner -d restore_check backups/lagos-<time>.dump
  psql restore_check -c "select count(*) from player_profile"      # sanity check
  dropdb lagos_living && createdb lagos_living && pg_restore --no-owner -d lagos_living backups/lagos-<time>.dump
  ```

### Testing tunnel (Cursor VM + Netlify)

The test server is reached through a Cloudflare *quick* tunnel, which Cloudflare can drop at any time; the address
then stops working ("Could not enter Lagos" / guest session failed). `scripts/ops/tunnel-watchdog.sh <web-origin>`,
run in tmux, notices within about three minutes, starts a new tunnel, restarts the server with the new address and
pushes `netlify.toml` to `main`, after which Netlify rebuilds in about a minute. A named Cloudflare tunnel or the
Render server (`render.yaml`) avoids this entirely.

`cloudflared` connects from localhost, so the server must run with `TRUSTED_PROXIES=loopback`. Without it every
visitor looks like `::1`, and the per-address guest cap (60 an hour) turns everyone away once it fills.

### Testing money

`TEST_FUNDS=20000000` refills every wallet to ₦20,000,000 whenever the game reads it (after each purchase, on the
next refresh), so testers can buy anything (the dearest item, the Rolls-Royce Cullinan, is ₦15M). Each refill is a `test_funds` ledger entry. The VM test server runs with
it on; leave it unset (0) anywhere the economy should be real.

## Secrets

- `.env`, `.env.*` (except `.env.production.example`) and `apps/server/.env`
  are gitignored, and `.dockerignore` keeps them out of image builds.
- The browser bundle only contains `VITE_API_URL`.
- Supply `BETTER_AUTH_SECRET`, database credentials and SMTP credentials
  through the host's secret store. Rotating `BETTER_AUTH_SECRET` signs everyone
  out and invalidates multiplayer tokens.
- Asset-generation keys (Meshy) are never needed by the running game and must
  not be added to the production environment.
