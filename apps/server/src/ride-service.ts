import { pool } from "./database.js";
import { creditWallet, debitWallet, ensureWallet, withTransaction } from "./economy-service.js";

/**
 * Takes the fare up front and records the ride as open in the same transaction; replays of the same booking key are
 * rejected by the transaction key index.
 */
export async function chargeRide(userId: string, fare: number, label: string, idempotencyKey: string, rideId: string) {
  return withTransaction(async (client) => {
    await ensureWallet(client, userId);
    const balance = await debitWallet(client, userId, fare, "ride_fare", `Naija World Ride to ${label}`, `ride:${idempotencyKey}`, { label });
    await client.query("INSERT INTO ride_open (ride_id, user_id, fare, label) VALUES ($1, $2, $3, $4)", [rideId, userId, fare, label]);
    return balance;
  });
}

/** At most one refund per ride: the key `ride-refund:<id>` is unique per user. */
export async function refundRide(userId: string, rideId: string, amount: number, reason: string) {
  if (amount <= 0) return null;
  return withTransaction((client) => creditWallet(client, userId, amount, "ride_refund", `Naija World Ride refund · ${reason}`, `ride-refund:${rideId}`));
}

/** The ride was settled (arrived, cancelled or refunded), so a later restart has nothing to give back. */
export async function closeRide(rideId: string) {
  await pool.query("DELETE FROM ride_open WHERE ride_id = $1", [rideId]);
}

/**
 * Rides this player paid for that no room is running any more (the server restarted mid-ride). Each is refunded in
 * full and closed in one transaction; the per-ride refund key stops a second refund if two processes race.
 */
export async function refundOrphanedRides(userId: string, liveRideId: string | null) {
  const { rows } = await pool.query<{ ride_id: string; fare: number; label: string }>(
    "SELECT ride_id, fare, label FROM ride_open WHERE user_id = $1 AND ride_id IS DISTINCT FROM $2",
    [userId, liveRideId],
  );
  let total = 0;
  for (const row of rows) {
    const refunded = await withTransaction(async (client) => {
      const removed = await client.query("DELETE FROM ride_open WHERE ride_id = $1", [row.ride_id]);
      if (!removed.rowCount) return 0;
      if (row.fare > 0) {
        await creditWallet(client, userId, row.fare, "ride_refund", `Naija World Ride refund · ride to ${row.label} interrupted by a server restart`, `ride-refund:${row.ride_id}`);
      }
      return row.fare;
    }).catch((error) => {
      console.error("Orphaned ride refund failed", error);
      return 0;
    });
    total += refunded;
  }
  return total;
}
