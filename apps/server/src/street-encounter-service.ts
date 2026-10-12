import { AGBERO, AGBERO_SPOTS, type StreetIncident } from "@lagos-living/shared";
import { pool } from "./database.js";
import { debitWallet, ensureWallet, withTransaction } from "./economy-service.js";

export async function startEncounter(id: string, userId: string, spotId: string, vehicleId: string | null, ask: number, x: number, z: number) {
  await pool.query(
    `INSERT INTO street_encounter (id, user_id, spot_id, vehicle_id, ask, x, z) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, userId, spotId, vehicleId, ask, x, z],
  );
}

/**
 * Pays the tout once: the encounter row is locked and must still be pending, and the ledger key is per encounter,
 * so a repeated tap or a retry after a reconnect never charges twice.
 */
export async function payEncounter(userId: string, encounterId: string, amount: number) {
  return withTransaction(async (client) => {
    const row = await client.query(`SELECT outcome FROM street_encounter WHERE id = $1 AND user_id = $2 FOR UPDATE`, [encounterId, userId]);
    if (row.rows[0]?.outcome !== "pending") return { paid: false as const };
    await ensureWallet(client, userId);
    const balance = await debitWallet(client, userId, amount, "agbero_payment", "Roadside tout (agbero) · \"settle the boys\"", `agbero:${encounterId}`, { encounterId });
    await client.query(`UPDATE street_encounter SET outcome = 'paid', paid = $2, resolved_at = NOW() WHERE id = $1`, [encounterId, amount]);
    return { paid: true as const, balance };
  });
}

/** Settles any other way. A dent is added only if the encounter was still pending, and never past the cap. */
export async function resolveEncounter(
  userId: string,
  encounterId: string,
  outcome: "drove_off" | "police" | "guards" | "ignored",
  options: { dent?: boolean; vehicleId?: string | null; cctv?: boolean } = {},
) {
  return withTransaction(async (client) => {
    const updated = await client.query(
      `UPDATE street_encounter SET outcome = $3, dent = $4, cctv = $5, resolved_at = NOW(),
         reported_at = CASE WHEN $3 = 'police' THEN NOW() ELSE NULL END
       WHERE id = $1 AND user_id = $2 AND outcome = 'pending' RETURNING id`,
      [encounterId, userId, outcome, Boolean(options.dent), Boolean(options.cctv)],
    );
    if (!updated.rowCount) return false;
    if (options.dent && options.vehicleId) {
      await client.query(`UPDATE player_vehicle SET dents = LEAST($3, dents + 1), updated_at = NOW() WHERE id = $1 AND owner_user_id = $2`, [
        options.vehicleId,
        userId,
        AGBERO.maxDents,
      ]);
    }
    return true;
  });
}

export async function encounterIncidents(userId: string): Promise<StreetIncident[]> {
  const { rows } = await pool.query(
    `SELECT id, spot_id, outcome, paid, dent, cctv, reported_at, created_at FROM street_encounter
     WHERE user_id = $1 AND outcome <> 'pending' ORDER BY created_at DESC LIMIT 20`,
    [userId],
  );
  return rows.map((row) => ({
    id: String(row.id),
    spotName: AGBERO_SPOTS.find((spot) => spot.id === row.spot_id)?.name ?? "Roadside",
    outcome: row.outcome,
    paid: Number(row.paid),
    dent: Boolean(row.dent),
    reported: Boolean(row.reported_at),
    cctv: Boolean(row.cctv),
    at: new Date(row.created_at).toISOString(),
  }));
}

/** Whether this player can be approached: an account older than the new-player window, with encounters switched on. */
export async function encounterEligible(userId: string) {
  const { rows } = await pool.query<{ created: Date; enabled: string | null }>(
    `SELECT u."createdAt" AS created, p.settings->>'streetEncounters' AS enabled
     FROM "user" u LEFT JOIN player_profile p ON p.user_id = u.id WHERE u.id = $1`,
    [userId],
  );
  const row = rows[0];
  if (!row) return false;
  return row.enabled !== "false" && Date.now() - new Date(row.created).getTime() >= AGBERO.newPlayerMs;
}
