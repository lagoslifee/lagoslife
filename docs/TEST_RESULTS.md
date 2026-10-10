# Test results — playable vertical slice

Recorded 2026-10-10 on the cloud development VM: 4 CPUs, **no GPU**, with WebGL
running on SwiftShader (software rendering). Frame rates below reflect that
machine only. Performance on player hardware has not yet been measured.

## Movement (target: 30 m jog ≈ 8.6 s, sprint ≈ 5 s)

| Method | Walk | Jog | Sprint |
|---|---|---|---|
| Unit test, real `LocomotionController`, 30 m from standstill at 30 / 60 / 144 fps (`controller.test.ts`) | 20.03 s | 8.67 / 8.65 / 8.65 s | 5.13 / 5.13 / 5.14 s |
| Live browser, holding W (± Shift, C) on a straight 30 m stretch of Admiralty Way at about 10 fps | 20.09 s | 8.68 s | 5.13 s |
| Live browser, sprint autopilot over 381 m including corners | — | — | 5.88 m/s average |

Acceleration to jog takes about 0.16 s, and stopping takes about 0.13 s. Frames
longer than 250 ms are clamped to protect collision, so a device rendering
below 4 fps moves proportionally slower. On this VM at 2–4 fps that happened in
one run: 2.6 m/s jog and 4.1 m/s sprint. The 10 fps run above was not affected.

CPU profile (medium preset, 8 s): the main thread was 87% idle and game
`update()` cost about 2.5 ms per frame. The rest of each frame is the software
rasteriser.

## Automated suites

| Suite | Result |
|---|---|
| `npm test -w @lagos-living/server` (PostgreSQL integration and room unit tests) | 44 / 44 passed (source tests only; compiled copies in `dist/` are excluded) |
| `npm test -w @lagos-living/shared` | 6 / 6 passed |
| `apps/web` `controller.test.ts` and `car-controller.test.ts` | 13 / 13 passed |
| Playwright `e2e/vehicles.spec.ts` | 1 / 1 passed (3.8 min, run twice) |
| Playwright `e2e/playable-loop.spec.ts` | 2 / 2 passed (8.4 min) |
| Playwright `e2e/accounts.spec.ts` | 5 / 5 passed |
| `npm run build -w @lagos-living/web` and typechecks | passed |

### Playable loop (browser, real servers, LocalTester after a progress reset)

1. Fresh balance of ₦250,000. The HUD shows the street name and objective "Catch a danfo".
2. Walked to the nearest stop and waited for a danfo to stop. Board prompt: "Board danfo L1 · ₦300".
3. Boarded, got seat 1, and was charged ₦300 once. The bus panel was shown.
4. Requested a stop, was auto-alighted at the next stop, and pressing E again did not re-board ("You just stepped off this danfo"). Balance stayed at ₦249,700.
5. Collected a parcel at Swift Parcel Hub, walked to the customer and delivered it. Wage ₦6,300 was credited once.
6. Bought and ate food at Mama Titi's (hunger 95).
7. Opened the Adebayo Court listing (rent ₦18,000 / 7 days, deposit ₦12,000, upfront ₦30,000, 3-day grace). Rented it and was charged exactly ₦30,000. The tenancy was assigned with its next due date.
8. Entered with the digital key. Location `home:lekki-adebayo-flat-2`; the HUD shows "Adebayo Court".
9. Reloaded. Balance ₦225,400, tenancy, and all progress flags persisted.

### Vehicles (browser, real servers, LocalTester after a progress reset)

1. At Lekki Motors chose the Eko Hatch in navy and confirmed once. Charged ₦120,000 (balance ₦130,000); the car appeared at the lay-by outside, tagged "Your car".
2. Walked to the driver door, pressed E and drove to Ade Auto Works. The speedometer read 26 km/h in the captured frame; the sampled top speed exceeded 6.5 m/s (23 km/h), faster than sprinting.
3. Stopped, stepped out, and the car was saved as parked with more than 200 m on the odometer, within 40 m of the mechanic.
4. Phone → Vehicles → Insure 7 days charged ₦3,600 and showed the cover date.
5. The mechanic quoted ₦2,500 service plus the ₦2,000 insured excess for the car's knocks (60% condition) and restored it to 100%.
6. Reloaded: the car was within 0.5 m of where it was left, and no page errors were raised.

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

## Bugs found and fixed during this pass

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

## Evidence

Screenshots are in `/opt/cursor/artifacts/screenshots/`: junction sign,
minimap, current-location display, street, danfo at a stop, For Rent board,
rental sheet, and home interior (medium preset), plus `m6-dealership-sheet`,
`m6-driving` and `m6-mechanic-sheet` from the vehicle test. The earlier miniature-scale
"before" view is `/opt/cursor/artifacts/before-street-old-miniature.png`.

## Not yet verified

- Frame rate on real GPUs and phones.
- More than two concurrent players. No capacity is claimed; the room cap is 40.
- Touch controls on a physical device (layout is implemented and responsive).
- Audio subtitles beyond stop announcements.
