# Lagos Living

A browser-based multiplayer virtual-life game set in a 1:1 reconstruction of
Lekki Phase 1, Lagos, built from OpenStreetMap data. It uses fictional game
naira only, with no real money.

## Quick start

Requirements: Node.js 22+, npm 10+, Docker with Compose.

```bash
cp .env.example .env
docker compose up -d postgres mailpit
npm install
npm run db:migrate
npm run dev
```

Open **http://localhost:5173**. The API and multiplayer server listen on
http://localhost:2567, and Mailpit captures password-reset email at
http://localhost:8025.

On localhost in development, the game signs you in automatically as
`LocalTester` and drops you into Lekki. Open http://localhost:5173/?manual=1 to
test registration, login, logout, or several separate accounts. Automatic
sign-in is disabled when `NODE_ENV` is not `development`.

## Playing

| Action | Default key |
|---|---|
| Move (jog 3.5 m/s) | W A S D |
| Sprint (6 m/s) | Shift |
| Walk toggle (1.5 m/s) | C |
| Look | Mouse (click to lock pointer, Esc to release) or drag |
| Zoom | Mouse wheel |
| Interact (board, step off, enter, buy, deliver) | E |
| Request danfo stop | Q |
| Phone / Map / Controls card | P / M / H |
| Hop | Space |

**Driving.** Buy a car at Lekki Motors on Admiralty Way; it is parked outside
when you sign. Walk up to it and press E to drive. W/S accelerate, brake and
reverse, A/D steer, Space is the handbrake and Q sounds the horn. Slow below
about 7 km/h and press E to step out; the car is parked where you leave it.
Phone → Vehicles finds, insures, tows and garages your cars, and Ade Auto Works
services and repairs them.

Keys can be rebound under Phone → Settings, alongside mouse sensitivity,
invert Y, subtitles, volumes, text size and graphics quality. Touch devices get
an on-screen joystick and buttons.

**First session.** The guide card walks you through the loop:

1. Catch a danfo on Admiralty Way. It costs ₦300; board only once it has
   stopped, press Q to request a stop, then step off.
2. Collect a parcel at Swift Parcel Hub and deliver it for a wage.
3. Buy and eat food at Mama Titi's.
4. Rent Adebayo Court (₦30,000 upfront) at the red For Rent board, or buy
   Okoro Terrace.
5. Go inside with your digital key. Progress saves automatically, and the HUD
   shows "Saved …".

If something goes wrong, use Phone → Help → **Get me unstuck**. On localhost,
Phone → Help → **Reset test progress** restarts from ₦250,000.

## Commands

```bash
npm run dev          # web and server (tsx watch)
npm run build        # production builds
npm run typecheck    # all TypeScript packages
npm test             # unit and PostgreSQL integration tests
npm run db:migrate   # apply PostgreSQL migrations
npm run test:e2e -w @lagos-living/web   # Playwright, needs the dev servers running
```

## Documentation

[Implementation plan](docs/IMPLEMENTATION_PLAN.md) ·
[Test results](docs/TEST_RESULTS.md) ·
[World data](docs/WORLD_DATA.md) ·
[Economy](docs/ECONOMY.md) ·
[Housing](docs/HOUSING.md) ·
[Asset manifest](docs/ASSET_MANIFEST.md) ·
[Operations](docs/OPERATIONS.md)

Map data © OpenStreetMap contributors, available under the
[Open Database License](https://www.openstreetmap.org/copyright).
