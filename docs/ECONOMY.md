# Fictional economy

All balances are integer fictional game naira with no cash value. There are no
deposits, withdrawals, cryptocurrency, gambling, or real-money purchases.

New players receive the configurable `STARTING_NAIRA` grant. Wallet creation,
purchases, inventory changes, job completion, rewards, and transaction history
are owned by PostgreSQL and executed server-side.

## Transaction guarantees

- Every purchase locks the player's wallet row.
- Balances have a database non-negative constraint.
- Purchase idempotency keys are unique per player.
- A purchase and its inventory increment commit in one transaction.
- Only one active job is allowed per player.
- Job completion locks the job and wallet, verifies authoritative live position,
  and uses the job ID as the unique reward key.
- Repeated completion returns the existing outcome without another reward.

The initial shop and prices are migration-seeded configuration. The first job
is a delivery from the Alfred Rewane spawn area to a nearby mapped service road.
