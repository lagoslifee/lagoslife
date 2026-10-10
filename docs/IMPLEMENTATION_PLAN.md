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
  tested touch controls. Final modular character replacement remains tracked.
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
- [ ] Milestone 8 — community systems, administration, fictional justice,
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
coordinates when the first moved. The room is capped at 32 by design, but only
two concurrent clients have been measured; no higher capacity is claimed.

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

## Deferred expanded scope

Daily-life, religious, community, and fictional court systems begin only after
core multiplayer, economy, housing, and vehicles are reliable. Each location
must ship with an interaction and persistent state; labels alone do not count.
Religious interaction will be optional and mechanically neutral. In-game law
and account moderation remain separate systems with independent audit trails.
