import {
  DELIVERY_FEE,
  DELIVERY_MENU,
  HOME_STAFF,
  PARTY_MS,
  STAFF_TERM_MS,
  type HomeStaffRole,
  type HomeStaffState,
} from "@lagos-living/shared";
import { pool } from "./database.js";
import { debitWallet, EconomyError, ensureProfile, ensureWallet, withTransaction } from "./economy-service.js";
import { playerEvents } from "./player-events.js";
import { requirePropertyAccess } from "./property-service.js";

export async function homeStaff(propertyId: string): Promise<HomeStaffState> {
  const { rows } = await pool.query<{ role: HomeStaffRole; paid_until: Date }>(
    `SELECT role, paid_until FROM home_staff WHERE property_id = $1 AND paid_until > NOW() ORDER BY role`,
    [propertyId],
  );
  return rows.map((row) => ({ role: row.role, paidUntil: row.paid_until.toISOString() }));
}

/** Active staff for many homes at once, for drawing gatemen and guards outside built houses. */
export async function staffByHome(propertyIds: string[]) {
  const byHome = new Map<string, HomeStaffRole[]>();
  if (!propertyIds.length) return byHome;
  const { rows } = await pool.query<{ property_id: string; role: HomeStaffRole }>(
    `SELECT property_id, role FROM home_staff WHERE property_id = ANY($1::text[]) AND paid_until > NOW()`,
    [propertyIds],
  );
  for (const row of rows) byHome.set(row.property_id, [...(byHome.get(row.property_id) ?? []), row.role]);
  return byHome;
}

/** Pays a week; hiring again before it runs out adds a week on top. Only the owner or tenant can hire. */
export async function hireStaff(userId: string, propertyId: string, role: HomeStaffRole, idempotencyKey: string) {
  const access = await requirePropertyAccess(userId, propertyId);
  if (!access.owner) throw new EconomyError("Only the owner can hire staff for this home.", 403);
  const staff = HOME_STAFF[role];
  return withTransaction(async (client) => {
    await ensureWallet(client, userId);
    await client.query(`SELECT 1 FROM wallet WHERE user_id = $1 FOR UPDATE`, [userId]);
    const replay = await client.query(`SELECT 1 FROM game_transaction WHERE user_id = $1 AND idempotency_key = $2`, [userId, `staff:${idempotencyKey}`]);
    if (!replay.rowCount) {
      await debitWallet(client, userId, staff.weekly, "home_staff", `${staff.name} · one week`, `staff:${idempotencyKey}`, { propertyId, role });
      await client.query(
        `INSERT INTO home_staff (property_id, role, hired_by, paid_until) VALUES ($1, $2, $3, NOW() + make_interval(secs => $4))
         ON CONFLICT (property_id, role) DO UPDATE
           SET hired_by = $3, paid_until = GREATEST(home_staff.paid_until, NOW()) + make_interval(secs => $4)`,
        [propertyId, role, userId, STAFF_TERM_MS / 1000],
      );
      if (role === "cleaner") await client.query(`UPDATE home_state SET cleanliness = 100, updated_at = NOW() WHERE property_id = $1`, [propertyId]);
    }
    const { rows } = await client.query<{ balance: string }>(`SELECT balance FROM wallet WHERE user_id = $1`, [userId]);
    return { balance: Number(rows[0]!.balance) };
  });
}

export async function dismissStaff(userId: string, propertyId: string, role: HomeStaffRole) {
  const access = await requirePropertyAccess(userId, propertyId);
  if (!access.owner) throw new EconomyError("Only the owner can dismiss staff.", 403);
  await pool.query(`DELETE FROM home_staff WHERE property_id = $1 AND role = $2`, [propertyId, role]);
  return { dismissed: true };
}

/** With a cleaner on staff the house never gets dirty. */
export async function applyCleaner(propertyId: string) {
  await pool.query(
    `UPDATE home_state SET cleanliness = 100 WHERE property_id = $1 AND cleanliness < 100
       AND EXISTS (SELECT 1 FROM home_staff WHERE property_id = $1 AND role = 'cleaner' AND paid_until > NOW())`,
    [propertyId],
  );
}

export async function partyUntil(propertyId: string) {
  const { rows } = await pool.query<{ party_until: Date | null }>(`SELECT party_until FROM home_state WHERE property_id = $1`, [propertyId]);
  const until = rows[0]?.party_until;
  return until && until.getTime() > Date.now() ? until.toISOString() : null;
}

/** Lights and music on for everyone inside; invited friends get a notice wherever they are. */
export async function startParty(userId: string, propertyId: string) {
  const access = await requirePropertyAccess(userId, propertyId);
  if (!access.owner) throw new EconomyError("Only the owner can throw a party here.", 403);
  const until = new Date(Date.now() + PARTY_MS);
  await pool.query(
    `INSERT INTO home_state (property_id, party_until) VALUES ($1, $2) ON CONFLICT (property_id) DO UPDATE SET party_until = $2`,
    [propertyId, until],
  );
  const [host, home, guests] = await Promise.all([
    pool.query<{ username: string }>(`SELECT username FROM "user" WHERE id = $1`, [userId]),
    pool.query<{ name: string }>(`SELECT name FROM property_listing WHERE id = $1`, [propertyId]),
    pool.query<{ guest_user_id: string }>(`SELECT guest_user_id FROM property_guest WHERE property_id = $1`, [propertyId]),
  ]);
  for (const guest of guests.rows) {
    playerEvents.emit("notice", guest.guest_user_id, "info", `🎉 ${host.rows[0]?.username ?? "A friend"} is throwing a party at ${home.rows[0]?.name ?? "their house"}! Phone → My Home → Visit for directions.`);
  }
  return { partyUntil: until.toISOString(), invited: guests.rowCount ?? 0 };
}

export async function stopParty(userId: string, propertyId: string) {
  const access = await requirePropertyAccess(userId, propertyId);
  if (!access.owner) throw new EconomyError("Only the owner can end the party.", 403);
  await pool.query(`UPDATE home_state SET party_until = NULL WHERE property_id = $1`, [propertyId]);
  return { partyUntil: null };
}

/** Pharmacy and food orders: paid now, the effect applies when the rider hands it over (the client shows the rider). */
export async function orderDelivery(userId: string, itemId: string, idempotencyKey: string) {
  const item = DELIVERY_MENU.find((entry) => entry.id === itemId);
  if (!item) throw new EconomyError("That item isn't on the menu.", 404);
  return withTransaction(async (client) => {
    await ensureWallet(client, userId);
    await ensureProfile(client, userId);
    await client.query(`SELECT 1 FROM wallet WHERE user_id = $1 FOR UPDATE`, [userId]);
    const replay = await client.query(`SELECT 1 FROM game_transaction WHERE user_id = $1 AND idempotency_key = $2`, [userId, `delivery:${idempotencyKey}`]);
    let balance: number;
    if (replay.rowCount) {
      const { rows } = await client.query<{ balance: string }>(`SELECT balance FROM wallet WHERE user_id = $1`, [userId]);
      balance = Number(rows[0]!.balance);
    } else {
      const label = item.shop === "pharmacy" ? `Pharmacy delivery · ${item.name}` : `Food delivery · ${item.name}`;
      balance = await debitWallet(client, userId, item.price + DELIVERY_FEE, "delivery_order", label, `delivery:${idempotencyKey}`, { itemId });
    }
    const needs = await client.query<{ hunger: number; energy: number }>(
      replay.rowCount
        ? `SELECT hunger, energy FROM player_profile WHERE user_id = $1`
        : `UPDATE player_profile SET hunger = LEAST(100, hunger + $2), energy = LEAST(100, energy + $3), updated_at = NOW() WHERE user_id = $1 RETURNING hunger, energy`,
      replay.rowCount ? [userId] : [userId, item.hunger, item.energy],
    );
    return { balance, item: { id: item.id, name: item.name, emoji: item.emoji, shop: item.shop }, needs: needs.rows[0]! };
  });
}
