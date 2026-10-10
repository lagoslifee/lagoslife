# Lagos Living

A browser-based multiplayer virtual-life game set in a geographically grounded,
gameplay-scaled Lagos.

Milestone 1 provides the runnable TypeScript monorepo, PostgreSQL-backed account
flow, modular character customisation data, and a Babylon.js browser scene.

## Quick start

Requirements: Node.js 22+, npm 10+, Docker with Compose.

```bash
cp .env.example .env
docker compose up -d postgres mailpit
npm install
npm run db:migrate
npm run dev
```

Open http://localhost:5173. The API and multiplayer server listen on
http://localhost:2567. Mailpit captures password-reset email at
http://localhost:8025.

## Commands

```bash
npm run dev          # web and server
npm run build        # production builds
npm run typecheck    # all TypeScript packages
npm test             # automated tests
npm run db:migrate   # apply PostgreSQL migrations
```

See [the implementation plan](docs/IMPLEMENTATION_PLAN.md),
[asset manifest](docs/ASSET_MANIFEST.md), and [operations guide](docs/OPERATIONS.md).
