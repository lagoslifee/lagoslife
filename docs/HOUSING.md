# Housing and daily life

All prices are fictional game naira.

| Home | Kind | Terms |
|---|---|---|
| Kayode Court Hostel | Starter accommodation (free) | Always available to every player. Private room with bed. |
| Adebayo Court | Affordable rental | ₦18,000 every 7 days plus a ₦12,000 refundable deposit, so ₦30,000 upfront. 3-day grace period. 16 storage slots. |
| Okoro Terrace | Purchase | ₦235,000, owned outright with no rent. |

## Renting flow

1. A red **For Rent** board stands at the door. Pressing E opens the listing:
   rent, deposit, billing interval, total upfront, grace period, storage and
   availability.
2. **Preview interior** enters a read-only copy (no furniture moves).
3. **Rent this flat → Confirm** validates funds and deducts the upfront total
   once. The deduction is protected by an idempotency key and a locked listing
   row. The server then assigns the tenancy, issues the digital key and records
   the next payment date. The player can set the flat as home.
4. The phone's **My Home** app shows the next due date, overdue and grace
   warnings, renewal, cancellation (with confirmation), set-as-home, furniture
   placement and pickup, and storage. A HUD reminder appears within 24 hours of
   the due date.
5. When the grace period lapses, the tenancy ends. Stored belongings and
   furniture records are kept for the player rather than deleted.

The server enforces access on every request. Two residents cannot rent the same
flat; the database lock resolves the race, and integration tests prove a single
winner.

## Daily life

- Hunger and energy are optional indicators. Food is bought at Mama Titi's Buka
  and eaten from the menu or the phone wallet. Sleeping at home requires a
  placed bed (`island-bed`).
- Furniture (`lagoon-sofa`, `woven-table`, `island-bed`) is bought from the
  furniture shop and placed from My Home.
- There is no punitive offline decay.
