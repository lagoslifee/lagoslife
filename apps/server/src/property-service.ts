import { randomUUID } from "node:crypto";
import { pool } from "./database.js";
import { EconomyError, ensureWallet } from "./economy-service.js";

export async function listProperties(userId: string) {
  const result = await pool.query(
    `SELECT listing.id, listing.name, listing.district,
            listing.address_label AS "addressLabel",
            listing.purchase_price AS "purchasePrice",
            listing.monthly_rent AS "monthlyRent",
            listing.world_x AS "worldX", listing.world_z AS "worldZ",
            tenure.tenure_type AS "tenureType",
            tenure.owner_user_id = $1 AS "isMine",
            tenure.owner_user_id IS NULL AS available,
            EXISTS (
              SELECT 1 FROM property_guest guest
              WHERE guest.property_id = listing.id AND guest.guest_user_id = $1
            ) AS "hasGuestAccess"
     FROM property_listing listing
     LEFT JOIN property_tenure tenure ON tenure.property_id = listing.id
       AND (tenure.expires_at IS NULL OR tenure.expires_at > NOW())
     WHERE listing.active = TRUE
     ORDER BY listing.purchase_price`,
    [userId],
  );
  return result.rows.map((row) => ({
    ...row,
    purchasePrice: Number(row.purchasePrice),
    monthlyRent: Number(row.monthlyRent),
  }));
}

export async function acquireProperty(
  userId: string,
  propertyId: string,
  tenure: "owned" | "rented",
  idempotencyKey: string,
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await ensureWallet(client, userId);
    const wallet = await client.query(
      `SELECT balance FROM wallet WHERE user_id = $1 FOR UPDATE`,
      [userId],
    );
    const replay = await client.query(
      `SELECT id FROM game_transaction WHERE user_id = $1 AND idempotency_key = $2`,
      [userId, idempotencyKey],
    );
    if (replay.rowCount) {
      await client.query("COMMIT");
      return { balance: Number(wallet.rows[0].balance), replayed: true };
    }
    const listing = await client.query(
      `SELECT id, name, purchase_price, monthly_rent
       FROM property_listing WHERE id = $1 AND active = TRUE FOR UPDATE`,
      [propertyId],
    );
    if (!listing.rowCount) throw new EconomyError("Property is unavailable", 404);
    const occupied = await client.query(
      `SELECT owner_user_id FROM property_tenure
       WHERE property_id = $1 AND (expires_at IS NULL OR expires_at > NOW())`,
      [propertyId],
    );
    if (occupied.rowCount) throw new EconomyError("Another resident already holds this property", 409);
    await client.query(`DELETE FROM property_tenure WHERE property_id = $1`, [propertyId]);

    const price = Number(
      tenure === "owned" ? listing.rows[0].purchase_price : listing.rows[0].monthly_rent,
    );
    const updated = await client.query(
      `UPDATE wallet SET balance = balance - $2, updated_at = NOW()
       WHERE user_id = $1 AND balance >= $2 RETURNING balance`,
      [userId, price],
    );
    if (!updated.rowCount) throw new EconomyError("Insufficient game naira");
    const balance = Number(updated.rows[0].balance);
    await client.query(
      `INSERT INTO property_tenure
        (property_id, owner_user_id, tenure_type, expires_at)
       VALUES ($1, $2, $3, CASE WHEN $3 = 'rented' THEN NOW() + INTERVAL '30 days' END)`,
      [propertyId, userId, tenure],
    );
    await client.query(
      `INSERT INTO home_state (property_id) VALUES ($1)
       ON CONFLICT (property_id) DO NOTHING`,
      [propertyId],
    );
    await client.query(
      `INSERT INTO game_transaction
        (id, user_id, kind, amount, balance_after, reference, idempotency_key, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        randomUUID(),
        userId,
        tenure === "owned" ? "property_purchase" : "property_rent",
        -price,
        balance,
        listing.rows[0].name,
        idempotencyKey,
        JSON.stringify({ propertyId, tenure }),
      ],
    );
    await client.query("COMMIT");
    return { balance, replayed: false };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function requirePropertyAccess(userId: string, propertyId: string) {
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

export async function getInterior(userId: string, propertyId: string) {
  const access = await requirePropertyAccess(userId, propertyId);
  const [property, furniture, home, guests, inventory] = await Promise.all([
    pool.query(
      `SELECT id, name, district, address_label AS "addressLabel"
       FROM property_listing WHERE id = $1`,
      [propertyId],
    ),
    pool.query(
      `SELECT placement.id, placement.item_id AS "itemId", catalog.name,
              placement.grid_x AS "gridX", placement.grid_z AS "gridZ", placement.rotation
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
      `SELECT inventory.item_id AS "itemId", catalog.name,
              inventory.quantity - COUNT(placement.id)::INTEGER AS available
       FROM inventory_item inventory
       JOIN shop_catalog catalog ON catalog.id = inventory.item_id
       LEFT JOIN furniture_placement placement
         ON placement.item_id = inventory.item_id AND placement.placed_by = inventory.user_id
       WHERE inventory.user_id = $1 AND catalog.category = 'furniture'
       GROUP BY inventory.item_id, catalog.name, inventory.quantity
       HAVING inventory.quantity - COUNT(placement.id)::INTEGER > 0`,
      [userId],
    ),
  ]);
  return {
    ...property.rows[0],
    access,
    furniture: furniture.rows,
    home: home.rows[0] ?? { hunger: 70, energy: 70, cleanliness: 80 },
    guests: guests.rows.map(({ username }) => username),
    availableFurniture: inventory.rows,
  };
}

export async function placeFurniture(
  userId: string,
  propertyId: string,
  input: {
    itemId: string;
    gridX: number;
    gridZ: number;
    rotation: 0 | 90 | 180 | 270;
    idempotencyKey: string;
  },
) {
  const access = await requirePropertyAccess(userId, propertyId);
  if (!access.owner) throw new EconomyError("Only the owner can place furniture", 403);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const inventory = await client.query(
      `SELECT quantity FROM inventory_item
       WHERE user_id = $1 AND item_id = $2 FOR UPDATE`,
      [userId, input.itemId],
    );
    const existing = await client.query(
      `SELECT id FROM furniture_placement
       WHERE placed_by = $1 AND idempotency_key = $2`,
      [userId, input.idempotencyKey],
    );
    if (existing.rowCount) {
      await client.query("COMMIT");
      return { id: existing.rows[0].id, replayed: true };
    }
    const placed = await client.query(
      `SELECT COUNT(*)::INTEGER AS count FROM furniture_placement
       WHERE placed_by = $1 AND item_id = $2`,
      [userId, input.itemId],
    );
    if (!inventory.rowCount || Number(inventory.rows[0].quantity) <= Number(placed.rows[0].count)) {
      throw new EconomyError("Buy this furniture before placing it.");
    }
    const id = randomUUID();
    await client.query(
      `INSERT INTO furniture_placement
        (id, property_id, placed_by, item_id, grid_x, grid_z, rotation, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        id,
        propertyId,
        userId,
        input.itemId,
        input.gridX,
        input.gridZ,
        input.rotation,
        input.idempotencyKey,
      ],
    );
    await client.query("COMMIT");
    return { id, replayed: false };
  } catch (error) {
    await client.query("ROLLBACK");
    if ((error as { code?: string }).code === "23505") {
      throw new EconomyError("That floor position is already occupied", 409);
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function performHomeAction(
  userId: string,
  propertyId: string,
  action: "sleep" | "cook" | "clean",
) {
  await requirePropertyAccess(userId, propertyId);
  if (action === "sleep") {
    const bed = await pool.query(
      `SELECT 1 FROM furniture_placement
       WHERE property_id = $1 AND item_id = 'island-bed'`,
      [propertyId],
    );
    if (!bed.rowCount) throw new EconomyError("Place a bed before sleeping.");
  }
  const updates = {
    sleep: "energy = 100, hunger = GREATEST(0, hunger - 10)",
    cook: "hunger = 100, energy = GREATEST(0, energy - 5), cleanliness = GREATEST(0, cleanliness - 10)",
    clean: "cleanliness = 100, energy = GREATEST(0, energy - 10)",
  };
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
  return { invited: true };
}
