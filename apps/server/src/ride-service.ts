import { creditWallet, debitWallet, ensureWallet, withTransaction } from "./economy-service.js";

/** Takes the fare up front; replays of the same booking key are rejected by the transaction key index. */
export async function chargeRide(userId: string, fare: number, label: string, idempotencyKey: string) {
  return withTransaction(async (client) => {
    await ensureWallet(client, userId);
    return debitWallet(client, userId, fare, "ride_fare", `Lagos Living Ride to ${label}`, `ride:${idempotencyKey}`, { label });
  });
}

/** At most one refund per ride: the key `ride-refund:<id>` is unique per user. */
export async function refundRide(userId: string, rideId: string, amount: number, reason: string) {
  if (amount <= 0) return null;
  return withTransaction((client) => creditWallet(client, userId, amount, "ride_refund", `Lagos Living Ride refund · ${reason}`, `ride-refund:${rideId}`));
}
