# Lagos Living

A browser-based multiplayer virtual-life game set in a 1:1 reconstruction of
Lekki Phase 1, Ikoyi and Victoria Island (Eti-Osa, Lagos), joined by the
Lekki-Ikoyi Link Bridge and built from OpenStreetMap data. It uses fictional game
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

**Your look.** Phone → Settings → Customise character opens the character
studio, with a 3D preview you can drag to turn. Skin tone, outfit, hairstyle and
accessory are saved to your account. Other residents see the change straight
away, without reloading.

**Driving.** Buy a car at Lekki Motors on Admiralty Way; it is parked outside
once the sale goes through. Walk up to it and press E to drive. W/S accelerate, brake and
reverse, A/D steer, Space is the handbrake and Q sounds the horn. Slow below
about 7 km/h and press E to step out; the car is parked where you leave it.
Phone → Vehicles finds, insures, tows and garages your cars, and Ade Auto Works
services and repairs them.

**Across the city.** Drive (or walk) west from Admiralty Way over the
Lekki-Ikoyi Link Bridge into Ikoyi, and on over Falomo Bridge to Victoria
Island. The world streams in 320 m tiles as you move, the HUD shows which
district you are in, and the full map (M) has buttons that jump to each district.
Each district has its own danfo loop at the same ₦300 fare: L1 on Admiralty
Way, I1 on Bourdillon Road in Ikoyi and V1 on Adeola Odeku Street in Victoria
Island. X1 Link Bridge Shuttle crosses the Lekki-Ikoyi Link Bridge between
Admiralty Way and Alexander Avenue. Phone → Transport lists every route and
guides you to the nearest stop. Victoria Island is reached from Ikoyi on foot
or by car over Falomo Bridge.

**Community.** Ikoyi Reading Room, Muri Okunola Park, Grace Assembly and
Al-Noor Mosque are quiet places. Spending time at any of them gives the same
+8 energy, on one shared 30-minute cooldown. Visiting is optional and no venue
gives more than another. Island Community Hall offers one volunteer shift per
Lagos day for ₦1,500. Phone → Community lists them all with directions.

**Chat and safety.** Press Enter to talk. Residents within 40 m hear you, and
a bubble shows over your head. Lines are limited to 200 characters and five per
10 seconds. Links, emails, phone numbers and slurs are masked. Click a name in
chat to report or block that resident; blocking hides chat both ways. Phone →
Safety lists your blocks, shows whether you are muted, and blocks or reports by
name. Moderator warnings appear as a notice you acknowledge before playing on.

Moderators and admins open the console at `/moderation`. It handles reports
(showing the original text of a reported line), resident records, warn, mute
and suspend actions, appeals, an append-only audit log, and staff roles (admins
only). Grant the first admin with `npm run staff:role` (see
[operations](docs/OPERATIONS.md#staff-roles)).

**Fictional justice.** Crashing at 50 km/h or more, when the server's own speed
measurement agrees, earns a careless-driving citation from the fictional Island
Traffic Wardens: ₦2,500 game naira, at most one per 10 minutes. Phone → Justice
lets you pay it, or appeal once within 72 hours; a different moderator decides
the appeal. Overdue fines stop you buying another car. Citations are in-game law
only and are separate from account moderation.

Keys can be rebound under Phone → Settings, alongside mouse sensitivity,
invert Y, subtitles, volumes, text size and graphics quality. Touch devices get
an on-screen joystick and buttons.

**First session.** The guide card walks you through the loop:

1. Catch a danfo on Admiralty Way. It costs ₦300; board only once it has
   stopped, press Q to request a stop, then step off.
2. Collect a parcel at Swift Parcel Hub and deliver it for a wage.
3. Buy and eat food at Mama Titi's.
4. Rent one of the 12 flats at Adebayo Court (₦30,000 upfront) at the red
   For Rent board, or buy one of the 6 houses at Okoro Terrace. The sheet
   shows how many units are still free.
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
npm run staff:role -w @lagos-living/server -- <username> <moderator|admin|none> "<reason>"
npm run load-test -w @lagos-living/server -- --bots 40 --duration 60   # local only
```

`docker-compose.prod.yml` builds production images for the server and web
(nginx) and runs migrations as a one-off step. Nothing is deployed
automatically; see [operations](docs/OPERATIONS.md).

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
