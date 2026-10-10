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
- [ ] Milestone 2 — production-quality modular humanoid, animation blending,
  movement, collision, third-person camera, and touch controls.
- [ ] Milestone 3 — licensed OSM starter section and authoritative multiplayer.
- [ ] Milestone 4 — durable economy, delivery job, wallet, shop, and inventory.
- [ ] Milestone 5 — property access, interiors, furniture, and daily life.
- [ ] Milestone 6 — vehicle ownership, garage, driving, service, and insurance.
- [ ] Milestone 7 — streamed Ikoyi, Victoria Island, and Lekki Phase 1.
- [ ] Milestone 8 — community systems, administration, fictional justice,
  optimisation, load testing, and deployment configuration.

## Quality gates

Every milestone must keep `npm run build`, `npm run typecheck`, and `npm test`
green. Browser milestones also require an inspected desktop playthrough.
Mobile support remains provisional until device-profile performance testing.

## Architecture decisions

- Colyseus 0.18 was selected because its current API provides authoritative
  fixed-timestep input processing, state deltas, prediction, and interpolation.
- Better Auth uses PostgreSQL and scrypt-backed email/password authentication.
  Mailpit provides a complete local password-reset path without a paid service.
- Babylon.js ES modules are imported directly so Vite can tree-shake builds.
- Geography will come from attributed OpenStreetMap extracts. Map footprints
  are layout input, not claims that generated buildings are exact replicas.

## Deferred expanded scope

Daily-life, religious, community, and fictional court systems begin only after
core multiplayer, economy, housing, and vehicles are reliable. Each location
must ship with an interaction and persistent state; labels alone do not count.
Religious interaction will be optional and mechanically neutral. In-game law
and account moderation remain separate systems with independent audit trails.
