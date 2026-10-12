import { BED_ITEM_IDS, furnitureItem, legacyCellPosition, nearestCell, placementProblem, propertyPlace, snapFloor, type PlacedPiece } from "@lagos-living/shared";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { pool } from "./database.js";
import {
  creditWallet,
  debitWallet,
  EconomyError,
  ensureProfile,
  ensureWallet,
  markProgress,
  withTransaction,
} from "./economy-service.js";
import { homeEvents } from "./home-events.js";
import { getPlayerPosition } from "./player-presence.js";

const LISTING_RANGE = 7;

export function listingDoor(listing: { id: string; world_x: number; world_z: number }): [number, number] {
  return propertyPlace(listing.id)?.door ?? [Number(listing.world_x), Number(listing.world_z)];
}

/** A player may sign at the listing's door or while previewing its interior. */
function requireAtListing(userId: string, listing: { id: string; world_x: number; world_z: number }) {
  const position = getPlayerPosition(userId);
  const door = listingDoor(listing);
  const atDoor =
    position?.location === "street" &&
    Math.hypot(position.x - door[0], position.z - door[1]) <= LISTING_RANGE;
  const previewing = position?.location === `preview:${listing.id}:${userId}`;
  if (!atDoor && !previewing) {
    throw new EconomyError("Visit the property's For Rent / For Sale sign to sign the agreement.", 409);
  }
}

export async function releaseBelongings(client: PoolClient, propertyId: string) {
  await client.query(`DELETE FROM furniture_placement WHERE property_id = $1`, [propertyId]);
  const stored = await client.query(
    `DELETE FROM property_storage WHERE property_id = $1 RETURNING user_id, item_id, quantity`,
    [propertyId],
  );
  for (const row of stored.rows) {
    await client.query(
      `INSERT INTO inventory_item (user_id, item_id, quantity) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, item_id) DO UPDATE SET quantity = inventory_item.quantity + EXCLUDED.quantity`,
      [row.user_id, row.item_id, row.quantity],
    );
  }
  await client.query(`DELETE FROM property_guest WHERE property_id = $1`, [propertyId]);
  await client.query(
    `UPDATE player_profile SET home_property_id = NULL WHERE home_property_id = $1`,
    [propertyId],
  );
}

/** Ends tenancies whose grace period has passed, preserving belongings. */
export async function settleExpiredTenancies() {
  const expired = await pool.query(
    `SELECT property_id FROM property_tenure WHERE expires_at IS NOT NULL AND expires_at <= NOW()`,
  );
  for (const { property_id: propertyId } of expired.rows) {
    await withTransaction(async (client) => {
      const locked = await client.query(
        `SELECT property_id FROM property_tenure
         WHERE property_id = $1 AND expires_at <= NOW() FOR UPDATE`,
        [propertyId],
      );
      if (!locked.rowCount) return;
      await releaseBelongings(client, propertyId);
      await client.query(`DELETE FROM property_tenure WHERE property_id = $1`, [propertyId]);
    });
  }
}

export async function listProperties(userId: string) {
  await settleExpiredTenancies();
  const profile = await pool.query(
    `SELECT home_property_id FROM player_profile WHERE user_id = $1`,
    [userId],
  );
  const homeId = profile.rows[0]?.home_property_id ?? null;
  const result = await pool.query(
    `SELECT listing.id, listing.name, listing.district,
            listing.address_label AS "addressLabel",
            listing.street_name AS "street", listing.description,
            listing.listing_type AS "listingType",
            listing.purchase_price AS "purchasePrice",
            listing.monthly_rent AS "rent",
            listing.deposit, listing.rent_interval_days AS "intervalDays",
            listing.grace_days AS "graceDays", listing.storage_slots AS "storageSlots",
            listing.world_x, listing.world_z,
            tenure.tenure_type AS "tenureType",
            tenure.owner_user_id = $1 AS "isMine",
            tenure.owner_user_id IS NULL AS available,
            tenure.next_payment_at AS "nextPaymentAt",
            tenure.expires_at AS "accessEndsAt",
            tenure.deposit_paid AS "depositPaid",
            EXISTS (
              SELECT 1 FROM property_guest guest
              WHERE guest.property_id = listing.id AND guest.guest_user_id = $1
            ) AS "hasGuestAccess"
     FROM property_listing listing
     LEFT JOIN property_tenure tenure ON tenure.property_id = listing.id
     WHERE listing.active = TRUE AND (
       listing.listing_type <> 'built' OR tenure.owner_user_id = $1
       OR EXISTS (SELECT 1 FROM property_guest guest WHERE guest.property_id = listing.id AND guest.guest_user_id = $1)
     )
     ORDER BY listing.monthly_rent`,
    [userId],
  );
  return result.rows.map(({ world_x, world_z, ...row }) => {
    const nextPaymentAt = row.nextPaymentAt ? new Date(row.nextPaymentAt) : null;
    return {
      ...row,
      isMine: Boolean(row.isMine),
      purchasePrice: Number(row.purchasePrice),
      rent: Number(row.rent),
      deposit: Number(row.deposit),
      depositPaid: Number(row.depositPaid ?? 0),
      upfrontRent: Number(row.rent) + Number(row.deposit),
      door: listingDoor({ id: row.id, world_x, world_z }),
      placeId: propertyPlace(row.id)?.id ?? null,
      isHome: homeId === row.id,
      overdue: Boolean(row.isMine && nextPaymentAt && nextPaymentAt.getTime() < Date.now()),
    };
  });
}

export async function acquireProperty(
  userId: string,
  propertyId: string,
  tenure: "owned" | "rented",
  idempotencyKey: string,
) {
  await settleExpiredTenancies();
  return withTransaction(async (client) => {
    await ensureWallet(client, userId);
    const wallet = await client.query(
      `SELECT balance FROM wallet WHERE user_id = $1 FOR UPDATE`,
      [userId],
    );
    const replay = await client.query(
      `SELECT id FROM game_transaction WHERE user_id = $1 AND idempotency_key = $2`,
      [userId, idempotencyKey],
    );
    if (replay.rowCount) return { balance: Number(wallet.rows[0].balance), replayed: true };
    const listing = await client.query(
      `SELECT id, name, purchase_price, monthly_rent, deposit, rent_interval_days, grace_days,
              listing_type, world_x, world_z
       FROM property_listing WHERE id = $1 AND active = TRUE FOR UPDATE`,
      [propertyId],
    );
    if (!listing.rowCount) throw new EconomyError("Property is unavailable", 404);
    const row = listing.rows[0];
    if (row.listing_type === "built") throw new EconomyError("This house belongs to the resident who built it.", 409);
    if (tenure === "owned" && row.listing_type === "rental") {
      throw new EconomyError("This property is offered for rent only.");
    }
    if (tenure === "rented" && row.listing_type === "sale") {
      throw new EconomyError("This property is offered for sale only.");
    }
    requireAtListing(userId, row);
    const occupied = await client.query(
      `SELECT owner_user_id FROM property_tenure WHERE property_id = $1`,
      [propertyId],
    );
    if (occupied.rowCount) throw new EconomyError("Another resident already holds this property", 409);

    let balance: number;
    if (tenure === "owned") {
      balance = await debitWallet(client, userId, Number(row.purchase_price), "property_purchase",
        row.name, idempotencyKey, { propertyId, tenure });
      await client.query(
        `INSERT INTO property_tenure (property_id, owner_user_id, tenure_type) VALUES ($1, $2, 'owned')`,
        [propertyId, userId],
      );
    } else {
      balance = await debitWallet(client, userId, Number(row.monthly_rent), "property_rent",
        `${row.name} · rent`, idempotencyKey, { propertyId, tenure });
      if (Number(row.deposit) > 0) {
        balance = await debitWallet(client, userId, Number(row.deposit), "property_deposit",
          `${row.name} · refundable deposit`, `${idempotencyKey}:deposit`, { propertyId });
      }
      await client.query(
        `INSERT INTO property_tenure
          (property_id, owner_user_id, tenure_type, next_payment_at, expires_at, deposit_paid)
         VALUES ($1, $2, 'rented',
                 NOW() + make_interval(days => $3),
                 NOW() + make_interval(days => $3 + $4), $5)`,
        [propertyId, userId, row.rent_interval_days, row.grace_days, row.deposit],
      );
    }
    await client.query(
      `INSERT INTO home_state (property_id) VALUES ($1) ON CONFLICT (property_id) DO NOTHING`,
      [propertyId],
    );
    await ensureProfile(client, userId);
    await client.query(
      `UPDATE player_profile SET home_property_id = COALESCE(home_property_id, $2) WHERE user_id = $1`,
      [userId, propertyId],
    );
    await markProgress(client, userId, tenure === "owned" ? "first_purchase_home" : "first_rental");
    return { balance, replayed: false };
  });
}

async function lockOwnTenancy(client: PoolClient, userId: string, propertyId: string) {
  const tenancy = await client.query(
    `SELECT tenure.tenure_type, tenure.next_payment_at, tenure.deposit_paid,
            listing.name, listing.monthly_rent, listing.rent_interval_days, listing.grace_days
     FROM property_tenure tenure JOIN property_listing listing ON listing.id = tenure.property_id
     WHERE tenure.property_id = $1 AND tenure.owner_user_id = $2 FOR UPDATE OF tenure`,
    [propertyId, userId],
  );
  if (!tenancy.rowCount) throw new EconomyError("You do not hold this property", 403);
  return tenancy.rows[0];
}

export async function renewTenancy(userId: string, propertyId: string, idempotencyKey: string) {
  await settleExpiredTenancies();
  return withTransaction(async (client) => {
    await ensureWallet(client, userId);
    await client.query(`SELECT balance FROM wallet WHERE user_id = $1 FOR UPDATE`, [userId]);
    const replay = await client.query(
      `SELECT balance_after FROM game_transaction WHERE user_id = $1 AND idempotency_key = $2`,
      [userId, idempotencyKey],
    );
    if (replay.rowCount) return { balance: Number(replay.rows[0].balance_after), replayed: true };
    const tenancy = await lockOwnTenancy(client, userId, propertyId);
    if (tenancy.tenure_type !== "rented") throw new EconomyError("Owned homes have no rent to renew.");
    const intervalMs = Number(tenancy.rent_interval_days) * 86_400_000;
    if (new Date(tenancy.next_payment_at).getTime() - Date.now() > intervalMs * 1.5) {
      throw new EconomyError("Rent is already paid well in advance.");
    }
    const balance = await debitWallet(client, userId, Number(tenancy.monthly_rent), "property_rent",
      `${tenancy.name} · renewal`, idempotencyKey, { propertyId });
    await client.query(
      `UPDATE property_tenure
       SET next_payment_at = GREATEST(next_payment_at, NOW()) + make_interval(days => $2),
           expires_at = GREATEST(next_payment_at, NOW()) + make_interval(days => $2 + $3)
       WHERE property_id = $1`,
      [propertyId, tenancy.rent_interval_days, tenancy.grace_days],
    );
    return { balance, replayed: false };
  });
}

export async function cancelTenancy(userId: string, propertyId: string, idempotencyKey: string) {
  return withTransaction(async (client) => {
    await ensureWallet(client, userId);
    await client.query(`SELECT balance FROM wallet WHERE user_id = $1 FOR UPDATE`, [userId]);
    const tenancy = await lockOwnTenancy(client, userId, propertyId);
    if (tenancy.tenure_type !== "rented") throw new EconomyError("Owned homes cannot be cancelled.");
    const refundable =
      new Date(tenancy.next_payment_at).getTime() >= Date.now() ? Number(tenancy.deposit_paid) : 0;
    let refunded = 0;
    if (refundable > 0) {
      await creditWallet(client, userId, refundable, "deposit_refund",
        `${tenancy.name} · deposit returned`, `${idempotencyKey}:refund`);
      refunded = refundable;
    }
    await releaseBelongings(client, propertyId);
    await client.query(`DELETE FROM property_tenure WHERE property_id = $1`, [propertyId]);
    return { cancelled: true, refunded };
  });
}

export async function setHome(userId: string, propertyId: string) {
  const held = await pool.query(
    `SELECT 1 FROM property_tenure WHERE property_id = $1 AND owner_user_id = $2`,
    [propertyId, userId],
  );
  if (!held.rowCount) throw new EconomyError("You can only set a property you hold as home", 403);
  await ensureProfile(pool, userId);
  await pool.query(`UPDATE player_profile SET home_property_id = $2 WHERE user_id = $1`, [userId, propertyId]);
  return { homePropertyId: propertyId };
}

export async function requirePropertyAccess(userId: string, propertyId: string) {
  const access = await pool.query(
    `SELECT tenure.owner_user_id = $1 AS owner,
            EXISTS (
              SELECT 1 FROM property_guest guest
              WHERE guest.property_id = $2 AND guest.guest_user_id = $1
            ) AS guest
     FROM property_tenure tenure
     WHERE tenure.property_id = $2
       AND (tenure.expires_at IS NULL OR tenure.expires_at > NOW())`,
    [userId, propertyId],
  );
  if (!access.rowCount || (!access.rows[0].owner && !access.rows[0].guest)) {
    throw new EconomyError("You do not have access to this home", 403);
  }
  return {
    owner: Boolean(access.rows[0].owner),
    guest: Boolean(access.rows[0].guest),
  };
}

export async function isPropertyAvailable(propertyId: string) {
  await settleExpiredTenancies();
  const result = await pool.query(
    `SELECT listing.id FROM property_listing listing
     LEFT JOIN property_tenure tenure ON tenure.property_id = listing.id
     WHERE listing.id = $1 AND listing.active = TRUE AND tenure.property_id IS NULL`,
    [propertyId],
  );
  return Boolean(result.rowCount);
}

export async function getInterior(userId: string, propertyId: string) {
  await settleExpiredTenancies();
  const access = await requirePropertyAccess(userId, propertyId);
  const [property, furniture, home, guests, inventory, storage] = await Promise.all([
    pool.query(
      `SELECT listing.id, listing.name, listing.district, listing.address_label AS "addressLabel",
              listing.street_name AS street, listing.storage_slots AS "storageSlots",
              tenure.tenure_type AS "tenureType", tenure.next_payment_at AS "nextPaymentAt"
       FROM property_listing listing
       LEFT JOIN property_tenure tenure ON tenure.property_id = listing.id
       WHERE listing.id = $1`,
      [propertyId],
    ),
    pool.query(
      `SELECT placement.id, placement.item_id AS "itemId", catalog.name,
              placement.grid_x AS "gridX", placement.grid_z AS "gridZ", placement.rotation,
              placement.pos_x AS x, placement.pos_z AS z
       FROM furniture_placement placement
       JOIN shop_catalog catalog ON catalog.id = placement.item_id
       WHERE placement.property_id = $1 ORDER BY placement.created_at`,
      [propertyId],
    ),
    pool.query(
      `SELECT hunger, energy, cleanliness FROM home_state WHERE property_id = $1`,
      [propertyId],
    ),
    pool.query(
      `SELECT "user".username FROM property_guest
       JOIN "user" ON "user".id = property_guest.guest_user_id
       WHERE property_guest.property_id = $1`,
      [propertyId],
    ),
    pool.query(
      `SELECT inventory.item_id AS "itemId", catalog.name, catalog.category,
              inventory.quantity - COUNT(placement.id)::INTEGER AS available
       FROM inventory_item inventory
       JOIN shop_catalog catalog ON catalog.id = inventory.item_id
       LEFT JOIN furniture_placement placement
         ON placement.item_id = inventory.item_id AND placement.placed_by = inventory.user_id
       WHERE inventory.user_id = $1
       GROUP BY inventory.item_id, catalog.name, catalog.category, inventory.quantity
       HAVING inventory.quantity - COUNT(placement.id)::INTEGER > 0`,
      [userId],
    ),
    pool.query(
      `SELECT storage.item_id AS "itemId", catalog.name, storage.quantity
       FROM property_storage storage JOIN shop_catalog catalog ON catalog.id = storage.item_id
       WHERE storage.property_id = $1 AND storage.user_id = $2`,
      [propertyId, userId],
    ),
  ]);
  return {
    ...property.rows[0],
    access,
    furniture: furniture.rows,
    home: home.rows[0] ?? { hunger: 70, energy: 70, cleanliness: 80 },
    guests: guests.rows.map(({ username }) => username),
    availableFurniture: inventory.rows.filter((row) => row.category === "furniture"),
    carried: inventory.rows,
    storage: storage.rows,
  };
}

/** Locks the home's tenancy so concurrent edits are checked against each other, and returns what is on the floor. */
async function lockFloor(client: PoolClient, propertyId: string): Promise<PlacedPiece[]> {
  await client.query(`SELECT 1 FROM property_tenure WHERE property_id = $1 FOR UPDATE`, [propertyId]);
  const rows = await client.query(
    `SELECT id, item_id, pos_x, pos_z, rotation FROM furniture_placement WHERE property_id = $1`,
    [propertyId],
  );
  return rows.rows.map((row) => ({ id: row.id, itemId: row.item_id, x: Number(row.pos_x), z: Number(row.pos_z), rotation: Number(row.rotation) }));
}

export async function placeFurniture(
  userId: string,
  propertyId: string,
  input: {
    itemId: string;
    x?: number | undefined;
    z?: number | undefined;
    gridX?: number | undefined;
    gridZ?: number | undefined;
    rotation: 0 | 90 | 180 | 270;
    idempotencyKey: string;
  },
) {
  const access = await requirePropertyAccess(userId, propertyId);
  if (!access.owner) throw new EconomyError("Only the owner can place furniture", 403);
  if (!furnitureItem(input.itemId)) throw new EconomyError("That is not furniture.");
  const [x, z] = input.x !== undefined && input.z !== undefined
    ? [snapFloor(input.x), snapFloor(input.z)]
    : legacyCellPosition(input.gridX ?? 0, input.gridZ ?? 0);
  const placed = await withTransaction(async (client) => {
    const floor = await lockFloor(client, propertyId);
    const existing = await client.query(
      `SELECT id FROM furniture_placement WHERE placed_by = $1 AND idempotency_key = $2`,
      [userId, input.idempotencyKey],
    );
    if (existing.rowCount) return { id: existing.rows[0].id as string, replayed: true };
    const problem = placementProblem({ itemId: input.itemId, x, z, rotation: input.rotation }, floor);
    if (problem) throw new EconomyError(problem, 409);
    const inventory = await client.query(
      `SELECT quantity FROM inventory_item WHERE user_id = $1 AND item_id = $2 FOR UPDATE`,
      [userId, input.itemId],
    );
    const used = await client.query(
      `SELECT COUNT(*)::INTEGER AS count FROM furniture_placement WHERE placed_by = $1 AND item_id = $2`,
      [userId, input.itemId],
    );
    if (!inventory.rowCount || Number(inventory.rows[0].quantity) <= Number(used.rows[0].count)) {
      throw new EconomyError("Buy this furniture before placing it.");
    }
    const id = randomUUID();
    const [gridX, gridZ] = nearestCell(x, z);
    await client.query(
      `INSERT INTO furniture_placement
        (id, property_id, placed_by, item_id, grid_x, grid_z, rotation, pos_x, pos_z, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [id, propertyId, userId, input.itemId, gridX, gridZ, input.rotation, x, z, input.idempotencyKey],
    );
    return { id, replayed: false };
  });
  if (!placed.replayed) homeEvents.emit("furniture", propertyId);
  return placed;
}

/** Slides or turns a piece already in the room. */
export async function moveFurniture(
  userId: string,
  propertyId: string,
  input: { placementId: string; x: number; z: number; rotation: 0 | 90 | 180 | 270 },
) {
  const access = await requirePropertyAccess(userId, propertyId);
  if (!access.owner) throw new EconomyError("Only the owner can move furniture", 403);
  const [x, z] = [snapFloor(input.x), snapFloor(input.z)];
  const moved = await withTransaction(async (client) => {
    const floor = await lockFloor(client, propertyId);
    const piece = floor.find((entry) => entry.id === input.placementId);
    if (!piece) throw new EconomyError("That furniture is not in this home.", 404);
    const problem = placementProblem({ ...piece, x, z, rotation: input.rotation }, floor);
    if (problem) throw new EconomyError(problem, 409);
    const [gridX, gridZ] = nearestCell(x, z);
    await client.query(
      `UPDATE furniture_placement SET pos_x = $3, pos_z = $4, rotation = $5, grid_x = $6, grid_z = $7
       WHERE id = $1 AND property_id = $2`,
      [input.placementId, propertyId, x, z, input.rotation, gridX, gridZ],
    );
    return { id: input.placementId, x, z, rotation: input.rotation };
  });
  homeEvents.emit("furniture", propertyId);
  return moved;
}

export async function removeFurniture(userId: string, propertyId: string, placementId: string) {
  const access = await requirePropertyAccess(userId, propertyId);
  if (!access.owner) throw new EconomyError("Only the owner can move furniture", 403);
  const removed = await pool.query(
    `DELETE FROM furniture_placement WHERE id = $1 AND property_id = $2 AND placed_by = $3`,
    [placementId, propertyId, userId],
  );
  if (!removed.rowCount) throw new EconomyError("That furniture is not yours to move", 404);
  homeEvents.emit("furniture", propertyId);
  return { removed: true };
}

export async function moveStorage(
  userId: string,
  propertyId: string,
  itemId: string,
  direction: "store" | "retrieve",
) {
  const access = await requirePropertyAccess(userId, propertyId);
  if (!access.owner) throw new EconomyError("Only residents can use this storage", 403);
  return withTransaction(async (client) => {
    if (direction === "store") {
      const listing = await client.query(
        `SELECT storage_slots FROM property_listing WHERE id = $1`,
        [propertyId],
      );
      const used = await client.query(
        `SELECT COALESCE(SUM(quantity), 0)::INTEGER AS used FROM property_storage WHERE property_id = $1`,
        [propertyId],
      );
      if (Number(used.rows[0].used) >= Number(listing.rows[0].storage_slots)) {
        throw new EconomyError("Storage is full.");
      }
      const item = await client.query(
        `SELECT inventory.quantity, COUNT(placement.id)::INTEGER AS placed
         FROM inventory_item inventory
         LEFT JOIN furniture_placement placement
           ON placement.item_id = inventory.item_id AND placement.placed_by = inventory.user_id
         WHERE inventory.user_id = $1 AND inventory.item_id = $2
         GROUP BY inventory.quantity`,
        [userId, itemId],
      );
      if (!item.rowCount || Number(item.rows[0].quantity) - Number(item.rows[0].placed) <= 0) {
        throw new EconomyError("You are not carrying a spare one of those.");
      }
      if (Number(item.rows[0].quantity) === 1) {
        await client.query(`DELETE FROM inventory_item WHERE user_id = $1 AND item_id = $2`, [userId, itemId]);
      } else {
        await client.query(
          `UPDATE inventory_item SET quantity = quantity - 1 WHERE user_id = $1 AND item_id = $2`,
          [userId, itemId],
        );
      }
      await client.query(
        `INSERT INTO property_storage (property_id, user_id, item_id, quantity) VALUES ($1, $2, $3, 1)
         ON CONFLICT (property_id, user_id, item_id) DO UPDATE SET quantity = property_storage.quantity + 1`,
        [propertyId, userId, itemId],
      );
    } else {
      const stored = await client.query(
        `SELECT quantity FROM property_storage
         WHERE property_id = $1 AND user_id = $2 AND item_id = $3 FOR UPDATE`,
        [propertyId, userId, itemId],
      );
      if (!stored.rowCount) throw new EconomyError("That item is not in storage.");
      if (Number(stored.rows[0].quantity) === 1) {
        await client.query(
          `DELETE FROM property_storage WHERE property_id = $1 AND user_id = $2 AND item_id = $3`,
          [propertyId, userId, itemId],
        );
      } else {
        await client.query(
          `UPDATE property_storage SET quantity = quantity - 1
           WHERE property_id = $1 AND user_id = $2 AND item_id = $3`,
          [propertyId, userId, itemId],
        );
      }
      await client.query(
        `INSERT INTO inventory_item (user_id, item_id, quantity) VALUES ($1, $2, 1)
         ON CONFLICT (user_id, item_id) DO UPDATE SET quantity = inventory_item.quantity + 1`,
        [userId, itemId],
      );
    }
    return { ok: true };
  });
}

export async function performHomeAction(
  userId: string,
  propertyId: string,
  action: "sleep" | "cook" | "clean" | "tv",
) {
  await requirePropertyAccess(userId, propertyId);
  if (action === "tv") {
    const tv = await pool.query(`SELECT 1 FROM furniture_placement WHERE property_id = $1 AND item_id = 'tv-console'`, [propertyId]);
    if (!tv.rowCount) throw new EconomyError("Place a TV first (Phone → My Home → Design).");
  }
  if (action === "sleep") {
    const bed = await pool.query(
      `SELECT 1 FROM furniture_placement
       WHERE property_id = $1 AND item_id = ANY($2)`,
      [propertyId, BED_ITEM_IDS],
    );
    if (!bed.rowCount) throw new EconomyError("Place a bed before sleeping.");
  }
  const updates = {
    sleep: "energy = 100, hunger = GREATEST(0, hunger - 10)",
    cook: "hunger = 100, energy = GREATEST(0, energy - 5), cleanliness = GREATEST(0, cleanliness - 10)",
    clean: "cleanliness = 100, energy = GREATEST(0, energy - 10)",
    tv: "energy = LEAST(100, energy + 15)",
  };
  // Cooking feeds and TV rests the resident as well as the household.
  const personal = { cook: "hunger = 100", tv: "energy = LEAST(100, energy + 15), hunger = GREATEST(0, hunger - 3)" } as Record<string, string>;
  if (personal[action]) await pool.query(`UPDATE player_profile SET ${personal[action]}, updated_at = NOW() WHERE user_id = $1`, [userId]);
  const result = await pool.query(
    `UPDATE home_state SET ${updates[action]}, updated_at = NOW()
     WHERE property_id = $1 RETURNING hunger, energy, cleanliness`,
    [propertyId],
  );
  return result.rows[0];
}

export async function invitePropertyGuest(
  ownerUserId: string,
  propertyId: string,
  username: string,
) {
  const access = await requirePropertyAccess(ownerUserId, propertyId);
  if (!access.owner) throw new EconomyError("Only the owner can invite guests", 403);
  const guest = await pool.query(
    `SELECT id FROM "user" WHERE LOWER(username) = LOWER($1)`,
    [username],
  );
  if (!guest.rowCount) throw new EconomyError("Resident was not found", 404);
  if (guest.rows[0].id === ownerUserId) throw new EconomyError("You already own this home");
  await pool.query(
    `INSERT INTO property_guest (property_id, guest_user_id, granted_by)
     VALUES ($1, $2, $3)
     ON CONFLICT (property_id, guest_user_id) DO NOTHING`,
    [propertyId, guest.rows[0].id, ownerUserId],
  );
  const [host, home] = await Promise.all([
    pool.query(`SELECT username FROM "user" WHERE id = $1`, [ownerUserId]),
    pool.query(`SELECT name FROM property_listing WHERE id = $1`, [propertyId]),
  ]);
  homeEvents.emit("invited", guest.rows[0].id, host.rows[0]?.username ?? "A resident", home.rows[0]?.name ?? "their home");
  return { invited: true };
}

/** Takes a guest off the list; they can no longer let themselves in. */
export async function removePropertyGuest(ownerUserId: string, propertyId: string, username: string) {
  const access = await requirePropertyAccess(ownerUserId, propertyId);
  if (!access.owner) throw new EconomyError("Only the owner can change the guest list", 403);
  await pool.query(
    `DELETE FROM property_guest WHERE property_id = $1
       AND guest_user_id = (SELECT id FROM "user" WHERE LOWER(username) = LOWER($2))`,
    [propertyId, username],
  );
  return { removed: true };
}
