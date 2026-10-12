import {
  DELIVERY_FEE,
  DELIVERY_MENU,
  DELIVERY_SECONDS,
  HOME_DELIVERY_SECONDS,
  HOME_STAFF,
  PARCEL_REACH,
  PARTY_MS,
  REST,
  SEATED_MEAL_ENERGY,
  STAFF_TERM_MS,
  type FoodParcel,
  type HomeStaffRole,
  type HomeStaffState,
} from "@lagos-living/shared";
import { pool } from "./database.js";
import { debitWallet, EconomyError, ensureProfile, ensureWallet, withTransaction } from "./economy-service.js";
import { homePropertyOf } from "./fast-travel-service.js";
import { playerEvents } from "./player-events.js";
import { getPlayerPosition } from "./player-presence.js";
import { listingDoor, requirePropertyAccess } from "./property-service.js";

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

type ParcelRow = {
  id: string;
  item_id: string;
  destination: "here" | "home";
  property_id: string | null;
  drop_x: number;
  drop_z: number;
  drop_location: string;
  status: "on_the_way" | "collected" | "eaten";
  arrives_at: Date;
};

function toParcel(row: ParcelRow): FoodParcel {
  const item = DELIVERY_MENU.find((entry) => entry.id === row.item_id)!;
  return {
    id: row.id,
    itemId: item.id,
    name: item.name,
    emoji: item.emoji,
    shop: item.shop,
    destination: row.destination,
    propertyId: row.property_id,
    drop: [Number(row.drop_x), Number(row.drop_z)],
    dropLocation: row.drop_location,
    status: row.status === "eaten" ? "collected" : row.status,
    arrivesAt: row.arrives_at.toISOString(),
  };
}

/** Where the rider takes an order: the player's own spot, or the front door of their home. */
async function dropFor(userId: string, destination: "here" | "home") {
  if (destination === "here") {
    const position = getPlayerPosition(userId);
    if (!position) throw new EconomyError("The rider can't find you yet. Try again in a moment.", 409);
    return { x: position.x, z: position.z, location: position.location, propertyId: null };
  }
  const homeId = await homePropertyOf(userId);
  if (!homeId) throw new EconomyError("Set a home first (Phone → My Home), or have it delivered to where you are.");
  await requirePropertyAccess(userId, homeId);
  const { rows } = await pool.query<{ id: string; world_x: number; world_z: number }>(`SELECT id, world_x, world_z FROM property_listing WHERE id = $1`, [homeId]);
  if (!rows[0]) throw new EconomyError("Your home could not be found.", 404);
  const [x, z] = listingDoor(rows[0]);
  return { x, z, location: "street", propertyId: homeId };
}

/** Pharmacy and food orders: paid now, brought by a rider to `destination`, and taken from them when they arrive. */
export async function orderDelivery(userId: string, itemId: string, idempotencyKey: string, destination: "here" | "home" = "here") {
  const item = DELIVERY_MENU.find((entry) => entry.id === itemId);
  if (!item) throw new EconomyError("That item isn't on the menu.", 404);
  const existing = await pool.query<ParcelRow>(`SELECT * FROM food_parcel WHERE id = $1 AND user_id = $2`, [idempotencyKey, userId]);
  const drop = existing.rowCount ? null : await dropFor(userId, destination);
  return withTransaction(async (client) => {
    await ensureWallet(client, userId);
    await client.query(`SELECT 1 FROM wallet WHERE user_id = $1 FOR UPDATE`, [userId]);
    const replay = await client.query<ParcelRow>(`SELECT * FROM food_parcel WHERE id = $1 AND user_id = $2`, [idempotencyKey, userId]);
    if (replay.rows[0]) {
      const { rows } = await client.query<{ balance: string }>(`SELECT balance FROM wallet WHERE user_id = $1`, [userId]);
      return { balance: Number(rows[0]!.balance), parcel: toParcel(replay.rows[0]) };
    }
    const label = item.shop === "pharmacy" ? `Pharmacy delivery · ${item.name}` : `Food delivery · ${item.name}`;
    const balance = await debitWallet(client, userId, item.price + DELIVERY_FEE, "delivery_order", label, `delivery:${idempotencyKey}`, { itemId, destination });
    const seconds = destination === "home" ? HOME_DELIVERY_SECONDS : DELIVERY_SECONDS;
    const { rows } = await client.query<ParcelRow>(
      `INSERT INTO food_parcel (id, user_id, item_id, destination, property_id, drop_x, drop_z, drop_location, arrives_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW() + make_interval(secs => $9)) RETURNING *`,
      [idempotencyKey, userId, item.id, destination, drop!.propertyId, drop!.x, drop!.z, drop!.location, seconds],
    );
    return { balance, parcel: toParcel(rows[0]!) };
  });
}

/** Orders still on the way, waiting for you, or in your hands, from the last day. */
export async function openParcels(userId: string): Promise<FoodParcel[]> {
  const { rows } = await pool.query<ParcelRow>(
    `SELECT * FROM food_parcel WHERE user_id = $1 AND status <> 'eaten' AND ordered_at > NOW() - INTERVAL '1 day' ORDER BY ordered_at`,
    [userId],
  );
  return rows.map(toParcel);
}

/** True when the player is where the parcel was dropped: beside the drop point, or inside the home it went to. */
function atDrop(userId: string, parcel: ParcelRow) {
  const position = getPlayerPosition(userId);
  if (!position) return false;
  if (parcel.property_id && position.location === `home:${parcel.property_id}`) return true;
  return position.location === parcel.drop_location && Math.hypot(position.x - parcel.drop_x, position.z - parcel.drop_z) <= PARCEL_REACH;
}

/** Taking the parcel from the rider. Medicine is taken there and then; food stays in your hands to eat. */
export async function collectParcel(userId: string, parcelId: string) {
  return withTransaction(async (client) => {
    const { rows } = await client.query<ParcelRow & { early: boolean }>(
      `SELECT *, arrives_at > NOW() + INTERVAL '2 seconds' AS early FROM food_parcel WHERE id = $1 AND user_id = $2 FOR UPDATE`,
      [parcelId, userId],
    );
    const parcel = rows[0];
    if (!parcel) throw new EconomyError("That order was not found.", 404);
    if (parcel.status !== "on_the_way") throw new EconomyError("You already took that order.");
    if (parcel.early) throw new EconomyError("The rider isn't there yet.");
    if (!atDrop(userId, parcel)) throw new EconomyError(parcel.destination === "home" ? "Your order is waiting at your front door." : "Go back to where the rider dropped your order.");
    const item = DELIVERY_MENU.find((entry) => entry.id === parcel.item_id)!;
    await ensureProfile(client, userId);
    if (item.shop === "pharmacy") {
      await client.query(`UPDATE food_parcel SET status = 'eaten', collected_at = NOW(), eaten_at = NOW() WHERE id = $1`, [parcelId]);
      const needs = await client.query<{ hunger: number; energy: number }>(
        `UPDATE player_profile SET hunger = LEAST(100, hunger + $2), energy = LEAST(100, energy + $3), updated_at = NOW() WHERE user_id = $1 RETURNING hunger, energy`,
        [userId, item.hunger, item.energy],
      );
      return { parcel: { ...toParcel(parcel), status: "collected" as const }, taken: true, needs: needs.rows[0]! };
    }
    await client.query(`UPDATE food_parcel SET status = 'collected', collected_at = NOW() WHERE id = $1`, [parcelId]);
    const needs = await client.query<{ hunger: number; energy: number }>(`SELECT hunger, energy FROM player_profile WHERE user_id = $1`, [userId]);
    return { parcel: { ...toParcel(parcel), status: "collected" as const }, taken: false, needs: needs.rows[0]! };
  });
}

/** Eating a meal you've collected; sitting down at home for it adds a little energy. */
export async function eatParcel(userId: string, parcelId: string) {
  return withTransaction(async (client) => {
    const { rows } = await client.query<ParcelRow>(`SELECT * FROM food_parcel WHERE id = $1 AND user_id = $2 FOR UPDATE`, [parcelId, userId]);
    const parcel = rows[0];
    if (!parcel) throw new EconomyError("That order was not found.", 404);
    if (parcel.status === "on_the_way") throw new EconomyError("Take it from the rider first.");
    if (parcel.status === "eaten") throw new EconomyError("You've already eaten that.");
    const item = DELIVERY_MENU.find((entry) => entry.id === parcel.item_id)!;
    await ensureProfile(client, userId);
    const here = getPlayerPosition(userId)?.location ?? null;
    const profile = await client.query<{ seated: boolean }>(
      `SELECT rest_started_at IS NOT NULL AND rest_location = $2 AS seated FROM player_profile WHERE user_id = $1 FOR UPDATE`,
      [userId, here],
    );
    const seated = Boolean(profile.rows[0]?.seated && here && REST.locations.test(here));
    const energy = item.energy + (seated ? SEATED_MEAL_ENERGY : 0);
    await client.query(`UPDATE food_parcel SET status = 'eaten', eaten_at = NOW() WHERE id = $1`, [parcelId]);
    const needs = await client.query<{ hunger: number; energy: number }>(
      `UPDATE player_profile SET hunger = LEAST(100, hunger + $2), energy = LEAST(100, energy + $3), updated_at = NOW() WHERE user_id = $1 RETURNING hunger, energy`,
      [userId, item.hunger, energy],
    );
    return { name: item.name, seated, needs: needs.rows[0]! };
  });
}
