# Test results

Recorded 2026-10-10 on the cloud development VM: 4 CPUs, **no GPU**, with WebGL
running on SwiftShader (software rendering). Frame rates below reflect that
machine only. Performance on player hardware has not yet been measured.

## Movement (target: 30 m jog ≈ 8.6 s, sprint ≈ 5 s)

| Method | Walk | Jog | Sprint |
|---|---|---|---|
| Unit test, real `LocomotionController`, 30 m from standstill at 30 / 60 / 144 fps (`controller.test.ts`) | 20.03 s | 8.67 / 8.65 / 8.65 s | 5.13 / 5.13 / 5.14 s |
| Live browser, holding W (± Shift, C) on a straight 30 m stretch of Admiralty Way at about 10 fps | 20.09 s | 8.68 s | 5.13 s |
| Live browser, sprint autopilot over 381 m including corners | — | — | 5.88 m/s average |

Acceleration to jog takes about 0.16 s, and stopping takes about 0.13 s.
Walking and driving run in 120 Hz substeps inside each frame, and frames up to
1 s are simulated at full length, so slow devices keep full speed. (Until
2026-10-10 frames were clamped at 250 ms, which slowed movement below 4 fps;
one earlier run at 2–4 fps measured 2.6 m/s jog and 4.1 m/s sprint.) The unit
test now also covers 2, 4 and 10 fps and fails with the old clamp. Live check
after the change: sprinting along Adeola Odeku Street at 3.5 fps covered
5.90 m/s of path.

CPU profile (medium preset, 8 s): the main thread was 87% idle and game
`update()` cost about 2.5 ms per frame. The rest of each frame is the software
rasteriser.

## Automatic quality

While "Lower detail automatically when slow" is on (Phone → Settings, default
on), the game measures frame time over 2 s windows. After two windows averaging
over 33 ms (under about 30 fps), it drops one step. The steps are: resolution
×1.35, then shadows off, then view distance 760 m with denser fog, then
resolution ×1.35 again. Hardware scaling is capped at 2.25, because the low
preset at step 4 (2.7) turned faces and signs into blocks. After four windows under 20 ms it restores one step. It
waits 4 s after each change. One-off long frames are ignored, but a window made
mostly of frames over 0.5 s counts as slow.

- `adaptive-quality.test.ts`: 8 / 8 passed. Covers 60 fps unchanged, 10 / 1.5 / 1 fps stepping down to the floor, stalls and single slow windows ignored, recovery, and the 20–33 ms band holding.
- `e2e/adaptive-quality.spec.ts`: 1 / 1 passed (1.3 min). Uses a new account on the medium preset on this VM. It started at 1.1 fps and reached step 3 after 18.7 s (scaling up, shadows off, 760 m view). The HUD showed "auto detail −3". Switching the toggle off restored the exact preset values, which held for 12 s, and the choice survived a reload. The first run of this spec found that frames over 0.5 s were all discarded, so a device this slow never adapted. That was fixed before this pass.
- On this VM it still ran at only 1.5 fps at step 3, because SwiftShader is software rendering. How much a real phone or GPU gains has not been measured.

## Captions

Speech (danfo stop announcements) is subtitled in quotes. Meaningful sounds get
bracketed, italic captions when Subtitles is on: a car honking because you are
blocking its lane, and your car hitting something. Ambient horns and your own
horn are not captioned.

- `e2e/captions.spec.ts`: 1 / 1 passed (1.4 min). Uses dev hooks to step into a lane an ambient car will reach about 9 s later. The car stopped, honked, and the caption "[A car honks — you are blocking the road]" appeared.
- The first run passed, but its screenshot was solid dark red. The car had stopped behind the resident, and the follow camera, which already avoided danfos and buildings, was inside its body. The camera now also avoids ambient cars. The test checks six times, 250 ms apart, that the camera is outside every car, and the re-run passed.
- The impact caption was not exercised by a browser test.

## Automated suites

| Suite | Result |
|---|---|
| `npm test -w @lagos-living/server` (PostgreSQL integration, room unit and config tests) | 115 / 115 passed after the bridge shuttles and server-side contact and wall-crash detection (source tests only; compiled copies in `dist/` are excluded) |
| `npm test -w @lagos-living/shared` | 23 / 23 passed |
| Playwright `e2e/transit-districts.spec.ts` on its own | 1 / 1 passed (5.8 min) |
| **Full Playwright suite in one run**, after the danfo loops and session fix | **12 / 13 passed (42.8 min)**. The venues journey in `districts.spec.ts` failed one 1.2 km walk from Ikoyi to the mosque (3 × 90 s attempts at about 3 fps); run on its own straight after, it passed (7.0 min). Frame rate at the mosque was 3.4 fps with and without danfos drawn, so the new routes did not cause it. The walk helper now scales its timeout with distance. |
| **Full Playwright suite in one run**, after the walk-timeout change | **13 / 13 passed (42.2 min)** |
| Production smoke `e2e-prod/smoke.spec.ts` against a fresh compose stack, after the danfo loops and session fix | 1 / 1 passed (1.7 min). Images rebuilt; all nine migrations applied to an empty volume; server and web healthy. |
| Playwright `e2e/playable-loop.spec.ts` on its own, after multi-unit housing | 2 / 2 passed (8.1 min) |
| `apps/web` unit tests (`npm test -w @lagos-living/web`), after the push-out fix | 29 / 29 passed |
| `apps/web` `controller.test.ts`, `car-controller.test.ts` and `appearance.test.ts` | 17 / 17 passed |
| Playwright `e2e/accounts.spec.ts` on its own, after the 3D character looks | 5 / 5 passed (2.2 min) |
| **Full Playwright suite in one run** (accounts, districts, playable loop, safety, vehicles), after the 3D character looks | **12 / 12 passed (30.4 min)**: districts 13.2 min, playable loop 8.6 min, the rest under 5 min each. (After the milestone 8 changes: 12 / 12 in 29.1 min.) |
| Playwright `e2e/safety.spec.ts` on its own | 2 / 2 passed (2.3 min) |
| Playwright `e2e/districts.spec.ts` on its own | 2 / 2 passed (Link Bridge drive 7.0 min; venues 5.6 min). One earlier drive run failed when a 300 s leg deadline expired with the car still moving on the deck at 6 fps; each leg now has 540 s. |
| Production smoke `e2e-prod/smoke.spec.ts` | 1 / 1 passed against nginx plus the bundled server (1.1 min), and against the compose stack (1.2 min) |
| `npm run build` (server bundle and web) and `npm run typecheck` | passed |

### Playable loop (browser, real servers, LocalTester after a progress reset)

1. Fresh balance of ₦250,000. The HUD shows the street name and objective "Catch a danfo".
2. Walked to the nearest stop and waited for a danfo to stop. Board prompt: "Board danfo L1 · ₦300".
3. Boarded, got seat 1, and was charged ₦300 once. The bus panel was shown.
4. Requested a stop, was auto-alighted at the next stop, and pressing E again did not re-board ("You just stepped off this danfo"). Balance stayed at ₦249,700.
5. Collected a parcel at Swift Parcel Hub, walked to the customer and delivered it. Wage ₦6,300 was credited once.
6. Bought and ate food at Mama Titi's (hunger 95).
7. Opened the Adebayo Court sheet (rent ₦18,000 / 7 days, deposit ₦12,000, upfront ₦30,000, 3-day grace), which showed "N of 12 flats free to rent". Rented the offered flat and was charged exactly ₦30,000. The tenancy was assigned with its next due date.
8. Entered with the digital key. Location `home:<that flat's listing id>`.
9. Reloaded. Balance ₦225,400, tenancy, and all progress flags persisted.

### Danfos in Ikoyi and Victoria Island (browser, real servers, LocalTester after a progress reset)

1. Started at Grace Assembly in Ikoyi. Phone → Transport listed I1 Bourdillon Road Loop first and offered "Guide me to the nearest stop (I1)".
2. Walked to the nearest I1 stop and waited for an I1 danfo to stop there (the snapshot carried `routeId: bourdillon-loop`). The board prompt named I1; boarding charged ₦300 once, and the bus panel read "I1 · Bourdillon Road Loop".
3. Requested a stop and stepped off at the next stop, "Bourdillon Road · Lateef Jakande Avenue (Eastbound)", within 3 m of its alighting point. The balance stayed ₦300 lower.
4. Started at Island Community Hall in Victoria Island and repeated the ride on V1 Adeola Odeku Loop, stepping off at "Adeola Odeku Street · Akin Adesola (Westbound)". No page errors.

5. X1 over the Link Bridge, run on its own (1 / 1 passed, 5.9 min). Started at Swift Parcel Hub in Lekki. Phone → Transport listed "X1 Link Bridge Shuttle". Walked to "Admiralty Way · Ikoyi Bridge Roundabout (Westbound)", boarded once an X1 danfo stopped (₦300 charged once), and rode over the bridge. Stepped off at "Alexander Avenue · Bourdillon Road (Southbound)"; the HUD then read "Alexander Avenue · Ikoyi". No page errors.
6. X2 over Falomo Bridge, run on its own (1 / 1 passed, 5.2 min). Started at Grace Assembly in Ikoyi. Phone → Transport listed "X2 Falomo Bridge Shuttle". Walked to "Bourdillon Road · east of Falomo Roundabout (Westbound)", boarded once an X2 danfo stopped (₦300 charged once), and rode over the bridge. Stepped off at "Akin Adesola Street · Adeola Odeku Street (Southbound)"; the HUD then read "Akin Adesola Street · Victoria Island". No page errors.

Screenshots: `transit-ikoyi.png`, `transit-victoria-island.png`, `transit-link-bridge.png` and `transit-falomo-bridge.png` in `/opt/cursor/artifacts/screenshots/`.

The world build now has 16 danfos: three each on L1, V1, X1 and X2, and four on I1. The load-test figures below were measured with the earlier ten.

Room tests cover each loop lapping every stop in order, a Victoria Island fare charged against its own route and stop, an Ikoyi rider stepping off at the next Bourdillon Road stop, and snapshots that carry only the danfos within 900 m of the viewer (plus the one they ride). Shared tests check that every stop's alighting point is walkable and outside buildings, and that each loop closes. They also check the cross-district routes. X1's stops run Lekki, Ikoyi, Ikoyi, Lekki, and X2's run Ikoyi, Victoria Island, Victoria Island, Ikoyi. Every 5 m sample between stops is walkable, and X1 spends over 1 km on the Link Bridge deck each way. A one-off probe confirmed this check can fail: 40 m to the side of the route, the ground is blocked water for 263 samples (about 1.3 km) on X1 and 64 samples (about 320 m) on X2.

The first two runs of this test exposed a session race. When one account joined twice at nearly the same time (a reload, or React's development double mount), the older join could finish last and remove the newer session, which then got no snapshots and showed no error. Now the newest join wins, the older tab is told it was replaced and stops reconnecting, and a dropped session no longer saves its stale position over the new one. Room tests cover all three cases, and the race test fails without the fix.

### Vehicles (browser, real servers, LocalTester after a progress reset)

1. At Lekki Motors chose the Eko Hatch in navy and confirmed once. Charged ₦120,000 (balance ₦130,000); the car appeared at the lay-by outside, tagged "Your car".
2. Walked to the driver door, pressed E and drove to Ade Auto Works. The speedometer read 26 km/h in the captured frame; the sampled top speed exceeded 6.5 m/s (23 km/h), faster than sprinting.
3. Stopped, stepped out, and the car was saved as parked with more than 200 m on the odometer, within 40 m of the mechanic.
4. Phone → Vehicles → Insure 7 days charged ₦3,600 and showed the cover date.
5. The mechanic quoted ₦2,500 service plus the ₦2,000 insured excess for the car's knocks (60% condition) and restored it to 100%.
6. Reloaded: the car was within 0.5 m of where it was left, and no page errors were raised.

### Districts and streaming (browser, real servers, LocalTester after a progress reset)

1. Spawned in Lekki Phase 1 (HUD "Lekki Phase 1 · Eti-Osa"), bought an Eko Hatch and drove it with the test autopilot onto the Lekki-Ikoyi Link Bridge. The HUD read "Lekki-Ikoyi Link Bridge · Eti-Osa" midway over the lagoon, with parapets along both outer edges.
2. Drove on to Ruxton Street in Ikoyi ("Ikoyi · Eti-Osa"). The tile around the car (`-8_2`) had streamed in, and none of the tiles loaded at the Lekki spawn were still resident. Recorded: 16 tiles resident, 2,248 ms of cumulative tile building over the whole drive, 9 fps.
3. Parked, reloaded, and resumed in Ikoyi within 6 m of the car.
4. Venues: started at Ikoyi Reading Room (via the dev-only `spawn-at` route). "Read for a while" gave +8 energy. Grace Assembly then offered the same quiet time, but on the shared cooldown energy was unchanged.
5. Walked from Grace Assembly over Falomo Bridge into Victoria Island ("Victoria Island · Eti-Osa"), arrived at Al-Noor Mosque, and saw the same shared cooldown.
6. Island Community Hall: volunteered once for +₦1,500. After a reload, Phone → Community showed "You volunteered today" and listed all five venues; the balance was unchanged. The full map jumped to Victoria Island.
7. No page errors in either journey.

Tile builds on this software renderer cost about 100 ms each (16 tiles in 1.7 s at the Lekki spawn), down from 9.3 s after base geometry was merged to one mesh per material per tile and near detail was built lazily. The streaming budget builds at most one tile a frame once play starts, so a hitch of about that size is possible when a new tile arrives.

### Water and bridges

- Shared tests: the lagoon 80 m either side of the Link Bridge is blocked; a north-south cut across the bridge is one continuous walkable band of 18–28 m (both carriageways and footways) with no gap between them.
- Room tests: a resident jogging along the deck is accepted, and a step past the parapet onto the lagoon is corrected.
- Browser: walking straight at either parapet stops at the deck edge (measured deck at x = -1689: z 659.0 to 681.0).

### Community (`community-service.test.ts`, PostgreSQL)

- Visits only count at the venue; non-community places and the hall are refused for quiet visits.
- The library, a church, a mosque and a park each give exactly +8 from the same starting energy.
- One cooldown is shared by all quiet places; visits during it are allowed and give nothing; after 30 minutes it gives again; three simultaneous visits give energy once; energy never exceeds 100.
- Volunteering must happen at the hall, is refused below 15 energy, pays ₦1,500 once for three simultaneous requests (one `community_wage` transaction), replays return the first result, and a new Lagos day opens a new shift.
- The Lagos day rolls over at 23:00 UTC.

### Danfo room tests (`LagosRoom.test.ts`)

- Two simultaneous requests for the last seat: one seated, one told the bus is full, one charge.
- Full bus: refused, no charge.
- Triple-pressed board: one seat, one charge.
- Board while moving: refused.
- Payment failure mid-boarding: seat released, "not charged" notice.
- Re-board within 6 s of stepping off: refused.
- Permanent disconnect while riding: seat freed, journey ended as interrupted, position saved at the next stop.
- Reconnect in time: seat kept.

### Accounts and multiplayer

Localhost auto sign-in (LocalTester), registration with appearance persisting
across sign-out and sign-in, two newly registered residents both seeing
"2 online" (and one moving), unauthenticated room joins rejected, and password
recovery through Mailpit.

### Character looks in 3D

- Browser (`e2e/accounts.spec.ts`): the character studio's 3D preview loaded and
  relabelled the outfit as options changed. After saving deep skin, braids,
  ankara and glasses, the player's model wore that look, with braid and glasses
  meshes attached to its head, and wore it again after signing out and back in.
  When a second resident saved light skin, an afro, athleisure and a cap, the
  first resident's view of them changed to that look within 15 s, without a
  reload.
- Screenshots from the street (medium preset), checked by eye: all five skin
  tones, the four outfits, the five hairstyles and the three accessories sit on
  the head and follow the animation. The shirt recolours keep the fabric
  shading. Small leftovers of the original print remain at a few cuff and
  collar seams.
- Unit tests: recolour inputs for every outfit and tone, populated residents
  get valid, stable and varied looks, and stored looks are read safely.
  Profile-service tests cover save, reload, the live-room event and invalid
  stored data. Room tests cover a joiner's look reaching others, the
  rate-limited look list, and live changes.
- Cost at the Lekki spawn (medium preset, camera behind the player), measured
  against the same build with recolouring and head meshes switched off:
  - draw calls went from 120–122 to 125–127;
  - frames counted over 20 s, three interleaved runs each: 2.45–2.60 fps with
    the looks and 2.50–2.60 fps without, so no difference this machine can
    resolve;
  - the JavaScript profile is unchanged, and the main thread was about 88% idle
    in both.

  The per-frame CPU timer swings between about 20 and 57 ms from run to run on
  the software renderer, so it was not used. Cost on real GPUs has not been
  measured.

### Chat, moderation and fictional justice (milestone 8)

Browser (`e2e/safety.spec.ts`, two real browser contexts, a moderator and a newly registered resident):

1. The resident said "Hello neighbour! Call me on 0803 555 1234". The moderator, standing nearby, saw the line without the number, and the speaker saw their own line.
2. The moderator reported the line (reason and details) from the name menu, then blocked the speaker. The speaker's existing lines disappeared, and a new line from the speaker was not delivered to the moderator. After the moderator unblocked from Phone → Safety, the speaker's next line arrived again. (That blocks also work in the other direction is covered by room tests.)
3. In the moderation console (`/moderation`), the report showed the **original** unmasked text alongside the reporter's details. The resident record listed the blocked-period line too.
4. A 1-hour chat mute applied from that record reached the resident live (toast notice). The resident's next line was refused and never reached the moderator, and the report moved to "actioned" with the mute recorded on it.
5. A 24-hour suspension (with reason) removed the resident from the room at once, showing the suspension screen with the reason. After reload the screen stayed, and the multiplayer token request returned 403.
6. The audit tab listed the mute and suspension reasons.
7. Justice:
   - A careless-driving citation (₦2,500) was appealed from Phone → Justice; while under review it couldn't be paid.
   - A separate, newly registered moderator overturned it with a note, and the resident's phone showed "Overturned on appeal" and the note.
   - A second citation's Pay button was double-clicked. ₦2,500 was debited once, and the only citation was `paid`.

The browser test issues citations through the dev-only `/api/dev/citation` route. The real trigger is covered by room unit tests: a client-reported impact plus the server's own speed measurement both have to be at least 13.9 m/s (50 km/h), with a 10-minute cooldown. The server also checks every accepted driving update itself. It sweeps the car from its previous position to its new one against pedestrians on the street (1.3 m), other parked or driven cars (2.0 m centre distance) and danfos (2.3 m). At 50 km/h or more by its own measurement, it cites with `detectedBy: "server"` and the kind of thing struck, with no client report needed. Room tests cover:

- a pedestrian hit with no impact report;
- a parked car passed through between two updates;
- slow contact and a fast pass 4 m from a pedestrian, which are not cited;
- one citation, not two, when the server and the client both see the same crash.

With the server check disabled, the first two tests fail.

Building crashes are detected from the server's own measurements too. The server cites when three things hold:

- it measured the car at 50 km/h or more;
- the next update moves at under 3 m/s;
- a mapped building footprint lies within 3 m along the last direction of travel.

The cars brake at most 11 m/s². A car ending below 3 m/s would then have averaged about 11 m/s over the 1.5 s speed window, so stopping hard in front of a wall cannot meet the 13.9 m/s threshold. The tests drive at the starter home's front wall:

- 72 km/h into the wall is cited as `struck: "building"`, with no client report;
- an 11 m/s² emergency stop from the same speed, ending under 2.5 m from the wall, is not cited.

With the wall check disabled, the crash test fails. Server tests: 115 / 115. Kerbs are not modelled on the server, so kerb strikes still rely on the client's report. Citations remain a fictional-game nuisance, not an anti-cheat system.

Server tests (`safety-service.test.ts`, `justice-service.test.ts`, `LagosRoom.test.ts`, PostgreSQL):

- **Chat:** delivered only within 40 m, and not to or from blocked players. Five lines per 10 s, with at least 700 ms between lines; the rest are refused. Lines that can't be stored are not broadcast. Muted players are refused. Filtering masks blocked words (including letter swaps and stretched spellings), URLs, emails and runs of 7 or more digits.
- **Chat (filtering detail):** the shared filter tests check that ordinary Lagos chat (pidgin, place names) is left alone.
- **Reports:** a reporter can have one open report per target, and the evidence line must have been written by the reported player.
- **Moderation:**
  - Warn, mute and suspend emit live events, resolve the linked report, and are all audited.
  - Moderators can't act on themselves, on admins, or (unless admin) on other moderators.
  - Only admins change roles, and never their own.
  - Mutes require a duration.
  - Audit rows can't be updated or deleted (database trigger).
  - Retention: chat older than 30 days is purged, except a line an open report points at, which goes once the report is resolved.
- **Justice:**
  - Simultaneous crash reports produce one citation.
  - Concurrent and repeated payments charge once.
  - Other players can't pay or appeal someone else's fine.
  - The driver can't decide their own appeal, and a decided appeal can't be decided again.
  - An overturned fine is void; an upheld one is payable again with at least a day to pay.
  - Appeals close after the due date.
  - An overdue fine blocks buying a car.
  - The justice log is append-only.
- **Room:**
  - A crash is cited only when the server also measured the car at speed: not for a hard crash the client claims and the server didn't see, and not for a gentle bump after fast driving.
  - Snapshots carry only the nearest players (the viewer is always included) and omit default fields, which the shared schema fills back in.

Screenshots: `m8-chat`, `m8-report-dialog`, `m8-moderation-reports`,
`m8-suspended`, `m8-moderation-audit`, `m8-justice-appeal` and
`m8-moderation-appeal` in `/opt/cursor/artifacts/screenshots/`.

### Load test (milestone 8)

`npm run load-test -w @lagos-living/server` (see [operations](OPERATIONS.md#load-testing)).
Bots are real accounts that join the real room through a real token, start
spread over 120 m of the danfo loop, jog it at 10 position updates per second,
and chat every 20 s. Every figure is what the bots received:

| Bots (hold) | Joined | Snapshot rate | Gap p99 / max | Snapshot size (JSON → msgpack) | Downstream per bot | Players visible | Corrections | Chat p95 | Server CPU mean / max | Server RSS |
|---|---|---|---|---|---|---|---|---|---|---|
| 10 (60 s) | 10 | 20 Hz | 51 / 55 ms | 3.3 KB JSON | — | 10 | 0 | 4 ms | 2.1% / 20% | 149 MB |
| 25 (60 s) | 25 | 20 Hz | 52 / 101 ms | 6.7 KB JSON | — | 25 | 0 | 4 ms | 3.5% / 38% | 160 MB |
| 40 (30 s), before compaction | 40 | 20 Hz | 55 / 101 ms | 10.1 KB → 6.4 KB | 126 KB/s | 40 | 0 | 5 ms | 5.1% / 54% | 158 MB |
| 40 (30 s), after compaction | 40 | 20 Hz | 52 / 58 ms | 6.3 KB → 4.0 KB | 78 KB/s | 40 | 0 | 4 ms | 4.1% / 51% | 161 MB |
| **100 (60 s)**, one room | 100 | 20 Hz | 53 / 102 ms | 6.3 KB → 4.0 KB | 78 KB/s | 40 (nearest) | 0 | 5 ms | 10.3% / 69% | 180 MB |
| **100 (60 s)**, re-run with 10 danfos on three loops | 100 | 20 Hz | 59 / 101 ms | 6.4 KB → 4.1 KB | 79 KB/s | 40 (nearest) | 0 | 9 ms | 11.1% / 85% | 224 MB |

In the 100-bot run, joins took 88 ms at the median (154 ms max), and
server-to-bot snapshot age was 3 ms at p99. Bots sent 67,393 position updates
and none were corrected. Their 336 chat lines produced 26,907 deliveries.

"Compaction" means omitting player fields left at their defaults and sending
at most the 40 nearest players. A 60-bot run under the earlier 40-player room
cap opened a second room: two separate cities. That is why one room now holds
100.

CPU is a percentage of one core, sampled from `/proc` once a second. The
maxima are single samples during the join ramp.

Caveats:

- The bots ran on the same 4-core VM as the server and talked over localhost, so network latency and loss are absent.
- One server process ran one room, against the development server (`tsx`, no Better Auth rate limit).
- Bots don't render, so client frame rate under load is not measured.
- The 100-bot run supports the claim that this VM handled 100 bots in one room at 20 Hz for 60 s. It does not show what real players on real networks would get, or what any particular host can carry.

The bundled production server was also loaded with 8 bots, which all joined.
Joins took up to 22 s because sign-ins were rate-limited per IP and every bot
shares this machine's address. Snapshots ran at 20 Hz with gaps of 51 ms at
p99, and RSS stayed at 116 MB.

### Production build (milestone 8)

- `npm run build`: the web build splits Babylon (2.04 MB, 472 KB gzipped), React (219 KB) and game code (356 KB) into separate hashed chunks. The entry chunk shrank from 447 KB to 230 KB, and lazily loaded shader chunks stay lazy (316 output files before, 317 after).
- The bundled server ran with production-only dependencies. It refused to start with the development auth secret, returned 404 for `/api/dev/*`, and rate-limited the fourth bad sign-in from one forwarded IP while a second IP was unaffected.
- `e2e-prod/smoke.spec.ts` passed twice:
  - against the bundle plus nginx serving the production build (1.1 min);
  - against `docker-compose.prod.yml` built from scratch (1.2 min; details in [operations](OPERATIONS.md#what-has-been-verified)).

## Bugs found and fixed during this pass

- Re-running the world build deleted and recreated the tiles directory. The running Vite dev server then answered every tile request with `index.html`, the client silently stored each tile as empty, and the world loaded with no buildings. The X1, X2, caption and vehicle runs on 2026-10-10 were affected; they passed but were re-run with the full world in one run of `transit-districts`, `captions` and `vehicles`: **5 / 5 passed (24.0 min)**. Times: I1+V1 4.8 min, X1 7.1 min, X2 6.7 min, captions 1.4 min, vehicles 4.1 min. The build now rewrites tiles in place. The client retries a failed tile twice (2 s, then 4 s later) before giving it up as empty, and logs a warning each time. `e2e/tile-retry.spec.ts` refuses the spawn tile twice and checks that every loaded tile's building count matches the files on disk (1 / 1 passed, 17.8 s). Against the old client code it fails.
- Collision push-outs became walking speed. Squeezed between a parked car and an obstacle, a resident was flung at 41 m/s, the server corrected every update, and the vehicles test failed walking to the mechanic. Only velocity into the obstacle is now removed. A unit test reproduces the 40.8 m/s squeeze without the fix.

- React StrictMode's double mount crashed the first engine mid-start, and a missing `StandardMaterial` side-effect import stopped the game loading.
- Room tick-rate units were wrong, so danfos moved about 1/1000th of their intended speed and never reached stops.
- A second fare could be charged by pressing E right after auto-alighting.
- The minimap threw on every frame for the new dealership and mechanic place kinds; the glyph table is now typed by place kind.
- Cars parked on the danfo's lane; dealership and mechanic kerbs now sit in a lay-by.
- A dev progress reset was overwritten by the live session's saved position.
- Palm fronds were culled because of a stale thin-instance bounding box.
- The HDR skybox rendered black or fully fogged on software GPUs; it was replaced by a gradient dome.
- Reset-password links were hijacked by dev auto sign-in.
- The spawn camera started inside buildings and buses.
- Streaming: newly created tile files were served as `index.html` by an already-running Vite dev server until it was restarted.
- Bridge ways each drew their own deck and parapets, putting a wall between the Link Bridge carriageways. The 10 m water grid also let residents and cars drift several metres past the deck edge onto the lagoon. Decks are now merged, with exact deck strips for movement.
- Falomo Bridge is a flyover drawn at street level, and its parapets walled off Falomo Roundabout underneath. Parapets now only stand over water.

## Evidence

Screenshots are in `/opt/cursor/artifacts/screenshots/`: junction sign,
minimap, current-location display, street, danfo at a stop, For Rent board,
rental sheet, and home interior (medium preset), plus `m6-dealership-sheet`,
`m6-driving` and `m6-mechanic-sheet` from the vehicle test, and `m7-link-bridge`,
`m7-ikoyi-street`, `m7-library-sheet`, `m7-community-hall` and `m7-map` from the
district tests. The earlier miniature-scale
"before" view is `/opt/cursor/artifacts/before-street-old-miniature.png`.

### Several server processes

Two server processes (ports 2571 and 2572) on this VM shared one local Redis
(`redis:7-alpine` in Docker, bound to 127.0.0.1) and the development Postgres.
`npm run cluster-check -w @lagos-living/server` passed all six checks:

- A player joining through each process landed in the same room.
- Each player's snapshots included the other.
- A `PUT /api/character` through each process reached the room as a `look`
  message.
- Starting a delivery at Swift Parcel Hub through each process passed the
  "near the door" check, so both processes knew where the player stood.

Running through both processes makes at least one of each pair of checks
cross the process boundary, wherever the room is hosted. With the relay
switched off (incoming messages dropped), rooms were still shared but the look
timed out and the delivery was refused with 409, so the checks depend on the
relay. `cluster.test.ts` (2 tests, no Redis) covers each event being delivered
exactly once, shared positions and progress resets, and a late removal from a
process the player has left not erasing their newer position. That last test
fails when the ownership guard is removed. The bundled server also started and
answered `/api/health` with `REDIS_URL` set. Not tested: more than two
processes, other hosts, a reverse proxy routing to each process's
`PUBLIC_ADDRESS`, or Redis restarts.

Rate limits are shared through Postgres:

- **Sign-in limit:** two production-mode bundled processes (ports 2581 and
  2582) got wrong-password sign-ins from one forwarded IP, alternating between
  them. Attempts 1 to 3 got 401; attempts 4 and 5 got 429, although attempt 4
  was only the second to reach its process. With Better Auth's memory storage
  swapped back in, all five got 401.
- **Per-player limit:** with two development processes, 27 alternating
  `PUT /api/character` requests from one player were counted together.
  Requests 26 and 27 got 429, though each process saw about 13. The bodies were
  deliberately invalid (400), and the limit applies before validation.
- **Unit tests:** `request-rate.test.ts` (3 tests, PostgreSQL) covers the limit
  and the next refusal, 40 concurrent requests from two connection pools
  allowing exactly 25, a new window once the old one passes, and purging.

## Not yet verified

- Frame rate on real GPUs and phones, and tile-streaming hitches on them.
- More than two concurrent *browser* players. 100 bot clients were measured in one room on this VM (see the load test above), but not over real networks, on other hosts, or with rendering clients. The room cap is 100, and snapshots carry the nearest 40.
- A public game server, TLS proxy or managed database. The production images and compose stack were only run on this VM. The web client alone is on Netlify (https://silver-elf-acde6c.netlify.app, deployed by the owner). After `netlify.toml` was added, a browser check found the home page and a deep link both return 200. With no `VITE_API_URL` set, the site shows the "game server not configured" screen, so sign-in and multiplayer can't be tested there yet.
- Citation evasion for kerb strikes, which the server does not model. Pedestrian, car, danfo and building contact is detected on the server.
- Touch controls on a physical device (layout is implemented and responsive).
- Several server processes beyond two on one VM, behind a reverse proxy, or across hosts.