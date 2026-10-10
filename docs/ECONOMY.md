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

## Development reset

On localhost in development, Phone → Help → **Reset test progress** wipes the
signed-in player's wallet, inventory, jobs, journeys, tenancies and progress,
then re-grants the starting balance. The route is unavailable in production and
for non-localhost hosts.
