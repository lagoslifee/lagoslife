# Lagos Living implementation plan

Last updated: 2026-10-10

The game is built as a TypeScript npm-workspace monorepo. React/Vite owns the
interface, Babylon.js owns rendering, Better Auth and PostgreSQL own account
state, Colyseus owns authoritative realtime simulation, and `packages/shared`
owns validated wire contracts.

## Progress

- [x] Inspect repository and available integrations.
- [x] Confirm current official architecture guidance.
- [x] Milestone 1 — local setup, account flow, character creation foundation,
  and browser-rendered scene.
- [x] Milestone 2 — temporary licensed humanoid, animation blending,
  accelerated movement, collision, third-person camera, graphics presets, and
  tested touch controls. Character looks (skin tone, outfit, hair, accessory)
  are shown on the 3D resident in the creator, on the player and on other
  players; final art for the hair and accessory meshes remains tracked.
- [x] Milestone 3 — licensed OSM Ikoyi starter section, visible attribution,
  authenticated authoritative movement, remote avatars, interpolation, and
  two-account browser verification.
- [x] Milestone 4 — durable transactional wallet, transaction history, Falomo
  shop, inventory, and server-verified neighbourhood delivery job.
- [x] Milestone 5 — transactional purchase/rental, protected interior access,
  saved furniture placement, guest invitations, and optional daily-life actions.
- [x] Playable vertical slice (Lekki Phase 1, 1:1 scale) — responsive
  locomotion, OSM street names on signs, maps and HUD, building/street kit,
  danfo route with seats and fares, delivery job, food, starter home, rental
  and purchase, phone UI, accessibility settings, save receipts, unstuck and
  test reset. See [test results](TEST_RESULTS.md).
- [x] Milestone 6 — vehicle ownership, garage, driving, service, and insurance.
- [x] Milestone 7 — streamed Ikoyi, Victoria Island, and Lekki Phase 1, joined
  by the Link Bridge and Falomo Bridge, with community venues.
- [x] Milestone 8 — community systems, administration, fictional justice,
  optimisation, load testing, and deployment configuration.

## Quality gates

Every milestone must keep `npm run build`, `npm run typecheck`, and `npm test`
green. Browser milestones also require an inspected desktop playthrough.
Mobile support remains provisional until device-profile performance testing.

### Milestone 2 verification note

Desktop keyboard and responsive touch controls are covered by browser automation,
including movement-state transitions and position changes. The cloud browser's
software-rendered high preset measured approximately 6 FPS, so this is not
evidence of acceptable mobile performance. Mobile support remains provisional;
real-device profiling and world/renderer optimisation are required before it
can be advertised as fully supported.

### Milestone 3 verification note

Two isolated browser accounts were verified in one room: both observed two
online residents and the second received changing server-authoritative
coordinates when the first moved. (The room cap was later raised to 100 and
measured with 100 bot clients; see the milestone 8 note.)

### Milestone 4 verification note

Automated PostgreSQL integration tests submit the same purchase concurrently
and prove one deduction and one inventory increment. Delivery tests prove that
remote completion is rejected, successful arrival pays once, and a repeated
claim does not pay again. Browser automation purchases an item, observes it in
inventory, and starts a persistent delivery through the real interface.

### Milestone 5 verification note

Integration tests prove one winner under concurrent purchase, time-limited
rental access, non-owner denial, explicit guest access, owner-only furniture
placement, idempotent placement, and persisted sleep/cook/clean state. Browser
automation acquires the Glover Court flat, places furniture, cleans the home,
reloads, re-enters, and observes the saved interior.

### Milestone 7 verification note

The world is now four district rectangles (Lekki Phase 1, the Link Bridge,
Ikoyi and Victoria Island). It holds 1615 OSM roads, 4950 footprints and the
lagoon, creek and channel water, streamed in 320 m tiles (see
[world data](WORLD_DATA.md)). The server registers every footprint and checks
each position update against open water, exact bridge decks and district
edges. Shared and room tests cover the bridge deck and corrections onto the
lagoon. Community venues (a library, a park, a church and a mosque with
identical, optional effects on one shared cooldown, plus a community hall
with one paid volunteer shift per Lagos day) have PostgreSQL integration tests
for location checks, neutrality, cooldowns, concurrency and idempotency.
Browser automation (`apps/web/e2e/districts.spec.ts`) drives from Lekki over
the Link Bridge into Ikoyi while tiles load and unload, and resumes there after
a reload. A second run walks from Ikoyi over Falomo Bridge into Victoria Island
and uses every kind of venue. Starting positions in far districts use a dev-only
`spawn-at` route. Victoria Island and Ikoyi have no danfo route yet, and
streaming hitches were only measured on the software renderer (about 100 ms per
tile).

### Milestone 8 verification note

- **Chat:** nearby chat (40 m) is stored before it is broadcast, filtered (the moderators' copy keeps the original text), rate-limited, and hidden in both directions by blocks.
- **Reports and moderation:** reports attach the reported line as evidence. Warn, mute and suspend are audited and take effect live. A suspension removes the player from the room at once and blocks API calls and multiplayer tokens. The audit and justice logs are append-only at the database level.
- **Justice:** careless-driving citations need both the client's impact report and the server's own speed measurement. Fines are paid once. One appeal is allowed, decided by a different moderator, and overdue fines block car purchases. Fines are kept separate from account moderation.
- **Tests:** PostgreSQL and room tests cover these rules, and `e2e/safety.spec.ts` runs two browser journeys with two accounts each.

The load-test harness ran 100 real bot accounts in one room on this VM for 60 s:

- snapshots held 20 Hz (p99 gap 53 ms), with no corrections;
- downstream was 78 KB/s per bot after snapshot compaction (nearest 40 players, default fields omitted), down from 126 KB/s at 40 bots before it;
- server CPU averaged 10% of one core.

The bots shared the server's machine and localhost, so this says nothing
about real networks or other hosts. One process runs one room, capped at 100.

Deployment configuration:

- server and web Dockerfiles, nginx with immutable caching for hashed chunks (Babylon has its own chunk), and `docker-compose.prod.yml` with one-off migrations and loopback-only ports;
- production guards on secrets, origins and dev routes;
- [operations notes](OPERATIONS.md).

The images were built and the compose stack ran from scratch on this VM, where
a page-driven production smoke test passed. Nothing was deployed publicly.
Remaining gaps: impacts are detected on the client, so a modified client can
avoid citations; horizontal scaling isn't configured; and no TLS proxy was
exercised.

### Milestone 6 verification note

PostgreSQL integration tests cover idempotent and concurrent car purchases,
unaffordable purchases, the three-car limit, the atomic key claim (one session drives at a time and
non-owners are refused), service and repair pricing, insurance stacking, towing
with and without cover, and garaging at a held home. Room tests cover the
vehicle speed envelope, limp mode, impact damage cooldowns, and parking when
the driver steps out or disconnects. Browser
automation (`apps/web/e2e/vehicles.spec.ts`) buys an Eko Hatch, drives it about
0.5 km along Admiralty Way to Ade Auto Works above sprint speed, parks, insures
it from the phone, pays for a service, and finds it in the same spot after
reload. The car is driven by a dev-only autopilot in that test; hand driving on
a keyboard was not separately measured. Remote players see parked and moving
cars through room snapshots, but only one browser drove in these runs.

### Vertical slice verification note

The full journey (ride → wage → food → rent → enter → reload) is automated in
`apps/web/e2e/playable-loop.spec.ts` and passed in a real browser. Movement
timings, danfo race tests and the remaining checks are in
[TEST_RESULTS.md](TEST_RESULTS.md). The cloud VM has no GPU (SwiftShader), so
frame rates measured here (1–10 fps) say nothing about player hardware.

## Architecture decisions

- Colyseus 0.18 was selected because its current API provides authoritative
  fixed-timestep input processing, state deltas, prediction, and interpolation.
- Better Auth uses PostgreSQL and scrypt-backed email/password authentication.
  Mailpit provides a complete local password-reset path without a paid service.
- Babylon.js ES modules are imported directly so Vite can tree-shake builds.
- Geography comes from attributed OpenStreetMap extracts at 1:1 scale. Map
  footprints are layout input, not claims that generated buildings are exact
  replicas.
- Movement is client-simulated (120 Hz substeps, frame-rate independent) and
  server-validated (speed envelope, bounds, building footprints) with
  corrections. Danfos are server-driven along route distance and predicted on
  the client between 20 Hz snapshots.

## Expanded scope

Each location must ship with an interaction and persistent state; labels alone
do not count. Religious venues (milestone 7) are optional and mechanically
neutral. In-game law (citations and appeals) and account moderation
(milestone 8) are separate systems with independent audit trails
(`justice_event` and `moderation_audit`).

Still deferred:

- a fictional court beyond moderator-decided appeals;
- danfo routes in Ikoyi and Victoria Island;
- real-device performance work;
- multi-instance scaling.
