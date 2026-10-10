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
- The in-app rate limits, room presence and Better Auth's rate-limit store are
  in memory. Running several server instances would need shared presence and
  rate-limit storage, and sticky WebSocket routing. None of that is configured.

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

## Secrets

- `.env`, `.env.*` (except `.env.production.example`) and `apps/server/.env`
  are gitignored, and `.dockerignore` keeps them out of image builds.
- The browser bundle only contains `VITE_API_URL`.
- Supply `BETTER_AUTH_SECRET`, database credentials and SMTP credentials
  through the host's secret store. Rotating `BETTER_AUTH_SECRET` signs everyone
  out and invalidates multiplayer tokens.
- Asset-generation keys (Meshy) are never needed by the running game and must
  not be added to the production environment.
