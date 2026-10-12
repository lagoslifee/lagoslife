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
| Cars at Lekki Motors | Budget range: Eko Hatch ₦120,000, Tokunbo Saloon ₦180,000, Lagoon Pickup ₦300,000, Island SUV ₦420,000. Real-world range: Toyota Corolla ₦240,000 up to Rolls-Royce Cullinan ₦15,000,000 (20 models; prices in `packages/shared/src/vehicles.ts`). At most 3 per player |
| Car insurance | 3% of the price per 7 days (Eko Hatch ₦3,600); can't be bought again while more than a day of cover is left |
| Service at Ade Auto Works | ₦2,500 check-up plus repairs at 0.15% of the price per condition point; insured cars pay at most ₦2,000 towards repairs |
| Tow to Ade Auto Works | ₦4,000, free when insured |
| Volunteer shift (Island Community Hall, Victoria Island) | ₦1,500, once per Lagos calendar day (UTC+1); uses 10 energy and 5 hunger and needs at least 15 energy |
| Careless-driving citation (Island Traffic Wardens, fictional) | ₦2,500 game naira, due in 72 h. Issued for a crash at 13.9 m/s (50 km/h) or more, when the server's measured speed agrees, at most once per 10 minutes. Paid from Phone → Justice as a `fine_payment` transaction. One appeal while unpaid; overturned fines are void, upheld ones get at least 24 h to pay. Overdue fines block buying cars |
| Club cover (Admiralty Lounge ₦2,000, Eko Nights ₦3,500, Awolowo Rooftop Club ₦5,000) | Once per club per Lagos night (6 am to 6 am, UTC+1) for a wristband; re-entry that night is free |
| Club bar | Water ₦300 to small chops ₦2,500; raises hunger (up to +20) and energy (up to +10), served only at the bar inside |
| VIP table (Admiralty Lounge ₦40,000, Eko Nights ₦60,000, Awolowo Rooftop Club ₦80,000) | Three tables per club, one booking each per Lagos night. The owner invites up to 5 guests by name |
| Table bottles | Dom Pérignon ₦150,000, Clase Azul ₦120,000, Moët ₦60,000, Hennessy VS ₦45,000, sparkling grape juice ₦12,000, Chapman jug ₦8,000. Ordered by the owner or a guest from the table; a waiter carries them over |
| Police checkpoint (Lagos Police, fictional) | On Admiralty Way, Ozumba Mbadiwe, Awolowo Road and Ahmadu Bello Way, at most one stop per 15 minutes. Showing papers is free with insurance and a car at 30% condition or more; otherwise a ₦5,000 `no_papers` citation. Driving off: 50% get away, otherwise a ₦25,000 `evading_checkpoint` citation |
| Armed robbery (another resident) | Both on foot within 3 m. Takes 10% of the victim's balance, at most ₦20,000. The victim can run (50% chance to get away). Residents in their first hour and anyone robbed in the last 2 h can't be robbed. Anyone with hired guards is never robbed: their guards chase the robber off, nothing is taken, and the attempt still counts as the robber's one for the next 30 minutes; a robber waits 30 minutes between attempts. Within 60 m of a police station or checkpoint, officers see it and charge ₦50,000 at once |
| Police report (Lekki Police Division, Ikoyi Police Station, Bar Beach Police Station) | Free, within 24 h. If the server's own record matches, the robber is charged ₦50,000 (`armed_robbery`) and the stolen money is returned from the robber's wallet (as much as they have) |
| Security guards (Eko Shield Security, fictional) | Two guards ₦25,000 or four ₦45,000, for 24 h. They follow in a black Hilux, walk with you on foot, open your compound gate, and make you impossible to rob |
| Dubai tourist visa (Dubai Travel Consular Office — Game Roleplay, fictional) | 14-day single visit ₦20,000 or 30-day three visits ₦45,000. Fixed fee, about 8 s of processing, never randomly refused. One visit is used at Dubai immigration, once per trip |
| Lagos ⇄ Dubai return ticket (fictional airline) | Economy ₦95,000, Business ₦280,000 (wider seat, lounge, hot meal). Full refund within 10 minutes of buying, then 90% back until boarding, no refund after. Friends invited to the trip pay their own fare only when they accept |
| Dubai hotels (fictional) | Marina Sands Inn ₦6,000–₦11,000, JBR Palm Suites ₦15,000–₦26,000, Marina Crown Hotel ₦40,000–₦90,000 per night. One night is 2 real hours, paid up front, so nothing is charged while offline. Full refund before check-in; checkout refunds whole unused nights. Safe contents return to the inventory when the stay ends |
| Dubai food, tours and hire | Room service ₦1,200–₦7,500, rooftop ₦3,000–₦18,000, Marina dhow cruise ₦12,000, desert safari ₦25,000, hire cars ₦15,000–₦35,000 per hour (up to 3 h). Boutique outfits ₦12,000–₦22,000 unlock the outfit everywhere, souvenirs ₦3,500–₦14,000 |
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

- A club wristband is one row per player, club and Lagos night (unique index), and
  its charge is keyed `club:<player>:<club>:<night>`, so a double-clicked Pay
  charges once. Bar orders carry a per-order idempotency key and need the
  player's live position at the bar inside that club.

- A VIP table booking is unique per club, table and Lagos night, and bottle
  orders carry a per-order idempotency key; only the owner and named guests,
  standing at that table, can order.

- Checkpoint stops, hold-ups and their outcomes are decided by the game server
  from its own positions and timers; the client only answers. A robbery moves
  money between two locked wallets in one transaction, keyed by robbery ID, and
  a report is matched against the server's robbery record, so restitution is
  paid at most once.
- Hiring guards is keyed per confirmation and needs the player at the security
  office's door.

- Paying a citation locks the wallet and the citation row. A paid citation
  returns its earlier result instead of charging again, so a double-clicked
  Pay charges once. Fines are never deducted automatically, and a balance
  can't go negative to cover one.

- Visas, tickets, invitations, hotel bookings and extensions, room service,
  tours and car hire each carry a per-request idempotency key, so a repeated or
  double-clicked request charges once. Ticket cancellation and checkout lock the
  booking row, so a refund is paid once. Flights run on the game server's clock;
  reconnecting mid-flight puts the player back in the same seat without a new
  flight or charge.

## Development reset

On localhost in development, Phone → Help → **Reset test progress** wipes the
signed-in player's wallet, inventory, jobs, journeys, tenancies, vehicles, community visits, club wristbands, police stops, robberies, reports, security hires and progress,
then re-grants the starting balance. The route is unavailable in production and
for non-localhost hosts. The same restriction applies to `POST /api/dev/spawn-at`,
which sets the next session's start to a place's kerb so far districts can be
tested without the drive.
