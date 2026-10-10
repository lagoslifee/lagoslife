# Fictional economy

All balances are integer fictional game naira with no cash value. There are no
deposits, withdrawals, cryptocurrency, gambling, or real-money purchases.

New players receive `STARTING_NAIRA` (default ₦250,000). That is enough to rent
Adebayo Court (₦30,000 upfront) straight away or to buy Okoro Terrace
(₦235,000).

| Source or sink | Amount |
|---|---|
| Danfo fare (route L1) | ₦300 per boarding, charged once per journey |
| Delivery job (Swift Parcel Hub) | ₦3,000 + ₦14 per metre from the hub (₦6,300 in the recorded playtest), paid once on arrival |
| Food at Mama Titi's | Puff-puff ₦600, suya wrap ₦1,800, jollof and plantain ₦2,500 |
| Furniture | Lagoon Sofa ₦28,000, Island Double Bed ₦36,000 (enables sleeping) |
| Rent at Adebayo Court | ₦18,000 per 7 days, plus a ₦12,000 deposit |
| Okoro Terrace | ₦235,000 |
| Cars at Lekki Motors | Eko Hatch ₦120,000, Tokunbo Saloon ₦180,000, Lagoon Pickup ₦300,000, Island SUV ₦420,000 (at most 3 per player) |
| Car insurance | 3% of the price per 7 days (Eko Hatch ₦3,600); can't be bought again while more than a day of cover is left |
| Service at Ade Auto Works | ₦2,500 check-up plus repairs at 0.15% of the price per condition point; insured cars pay at most ₦2,000 towards repairs |
| Tow to Ade Auto Works | ₦4,000, free when insured |
| Volunteer shift (Island Community Hall, Victoria Island) | ₦1,500, once per Lagos calendar day (UTC+1); uses 10 energy and 5 hunger and needs at least 15 energy |
| Quiet places (Ikoyi Reading Room, Muri Okunola Park, Grace Assembly, Al-Noor Mosque) | Free. +8 energy, on one 30-minute cooldown shared by all four. Identical for every venue, and optional |

Bumps at 3 m/s or more cost condition (2.5 points per m/s above 2, at most 35
per impact). Below 30% condition a car runs at 55% of its top speed; at 0% it
won't start until it is towed and repaired. A routine service is due every
25 km.

## Transaction guarantees

- Every purchase, fare, rent payment and wage locks the player's wallet row.
- Balances have a database non-negative constraint.
- Purchases and rentals carry unique per-player idempotency keys. Fares are
  keyed by journey ID and wages by job ID, so repeats never double-charge or
  double-pay.
- Delivery completion verifies the player's live server-side position at the
  customer's door.
- The danfo room reserves a seat synchronously before charging. Only one of two
  simultaneous requests for the last seat is charged. A failed payment releases
  the seat. Boarding the same bus within 6 s of stepping off is refused to
  prevent accidental second fares.
- A volunteer shift is one row per player per Lagos day (unique index) and its
  wage is keyed `volunteer:<player>:<day>`, so simultaneous or repeated requests
  pay once. Quiet-place visits lock the player's profile, so simultaneous
  visits give energy once.
- Car purchases are keyed per confirmation, so a double-clicked Confirm buys one
  car. Entering a car claims it with a single conditional update, so two players
  can't drive the same car, and only its owner can.

## Development reset

On localhost in development, Phone → Help → **Reset test progress** wipes the
signed-in player's wallet, inventory, jobs, journeys, tenancies, vehicles, community visits and progress,
then re-grants the starting balance. The route is unavailable in production and
for non-localhost hosts. The same restriction applies to `POST /api/dev/spawn-at`,
which sets the next session's start to a place's kerb so far districts can be
tested without the drive.
