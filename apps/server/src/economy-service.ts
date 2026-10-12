import { BED_ITEM_IDS, BUSINESS, getPlace, MOVEMENT, placeById } from "@lagos-living/shared";
import { hasCertificate } from "./certificates.js";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { config } from "./config.js";
import { pool } from "./database.js";
import { getPlayerPosition, isNear } from "./player-presence.js";
import { vehicleEvents } from "./vehicle-events.js";

export class EconomyError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export const VENDOR_RANGE = 4.5;
const DELIVERY_DESTINATIONS = ["drop-chief-okoro", "drop-grace-anjos", "drop-adebayo"] as const;

export async function withTransaction<T>(work: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function ensureWallet(client: PoolClient, userId: string) {
  const inserted = await client.query(
    `INSERT INTO wallet (user_id, balance)
     VALUES ($1, $2)
     ON CONFLICT (user_id) DO NOTHING
     RETURNING balance`,
    [userId, config.STARTING_NAIRA],
  );
  if (inserted.rowCount) {
    await client.query(
      `INSERT INTO game_transaction
        (id, user_id, kind, amount, balance_after, reference, idempotency_key)
       VALUES ($1, $2, 'starting_balance', $3, $3, 'Welcome grant', $4)
       ON CONFLICT (user_id, idempotency_key)
       WHERE idempotency_key IS NOT NULL DO NOTHING`,
      [randomUUID(), userId, config.STARTING_NAIRA, `starting:${userId}`],
    );
  }
}

export async function ensureProfile(client: PoolClient | typeof pool, userId: string) {
  await client.query(
    `INSERT INTO player_profile (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`,
    [userId],
  );
}

export async function markProgress(client: PoolClient | typeof pool, userId: string, key: string) {
  await ensureProfile(client, userId);
  await client.query(
    `UPDATE player_profile
     SET progress = progress || jsonb_build_object($2::text, COALESCE(progress->$2, to_jsonb(NOW()))),
         updated_at = NOW()
     WHERE user_id = $1`,
    [userId, key],
  );
}

/** Deducts from a locked wallet; throws when funds are insufficient. */
export async function debitWallet(
  client: PoolClient,
  userId: string,
  amount: number,
  kind: string,
  reference: string,
  idempotencyKey: string,
  metadata: object = {},
) {
  const updated = await client.query(
    `UPDATE wallet SET balance = balance - $2, updated_at = NOW()
     WHERE user_id = $1 AND balance >= $2 RETURNING balance`,
    [userId, amount],
  );
  if (!updated.rowCount) throw new EconomyError("Insufficient game naira", 402);
  const balance = Number(updated.rows[0].balance);
  await client.query(
    `INSERT INTO game_transaction
      (id, user_id, kind, amount, balance_after, reference, idempotency_key, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [randomUUID(), userId, kind, -amount, balance, reference, idempotencyKey, JSON.stringify(metadata)],
  );
  return balance;
}

export async function creditWallet(
  client: PoolClient,
  userId: string,
  amount: number,
  kind: string,
  reference: string,
  idempotencyKey: string,
) {
  const updated = await client.query(
    `UPDATE wallet SET balance = balance + $2, updated_at = NOW()
     WHERE user_id = $1 RETURNING balance`,
    [userId, amount],
  );
  const balance = Number(updated.rows[0].balance);
  await client.query(
    `INSERT INTO game_transaction
      (id, user_id, kind, amount, balance_after, reference, idempotency_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [randomUUID(), userId, kind, amount, balance, reference, idempotencyKey],
  );
  return balance;
}

async function findReplay(client: PoolClient, userId: string, idempotencyKey: string) {
  const replay = await client.query(
    `SELECT id FROM game_transaction WHERE user_id = $1 AND idempotency_key = $2`,
    [userId, idempotencyKey],
  );
  return Boolean(replay.rowCount);
}

/** Raises a wallet to `TEST_FUNDS` on testing servers; the row lock keeps two refills from both crediting. */
async function refillTestFunds(client: PoolClient, userId: string) {
  if (config.TEST_FUNDS <= 0) return;
  const { rows } = await client.query<{ balance: string }>("SELECT balance FROM wallet WHERE user_id = $1 FOR UPDATE", [userId]);
  const missing = config.TEST_FUNDS - Number(rows[0]?.balance ?? config.TEST_FUNDS);
  if (missing > 0) await creditWallet(client, userId, missing, "test_funds", "Testing top-up", `test-funds:${randomUUID()}`);
}

export async function getEconomyState(userId: string) {
  await withTransaction(async (client) => {
    await ensureWallet(client, userId);
    await ensureProfile(client, userId);
    await refillTestFunds(client, userId);
  });
  const [wallet, catalog, inventory, transactions, job, profile] = await Promise.all([
    pool.query(`SELECT balance FROM wallet WHERE user_id = $1`, [userId]),
    pool.query(
      `SELECT id, name, description, category, price, vendor_id AS "vendorId"
       FROM shop_catalog WHERE active = TRUE ORDER BY price`,
    ),
    pool.query(
      `SELECT inventory_item.item_id AS "itemId", shop_catalog.name, shop_catalog.category,
              inventory_item.quantity
       FROM inventory_item
       JOIN shop_catalog ON shop_catalog.id = inventory_item.item_id
       WHERE inventory_item.user_id = $1 ORDER BY shop_catalog.name`,
      [userId],
    ),
    pool.query(
      `SELECT id, kind, amount, balance_after AS "balanceAfter", reference, created_at AS "createdAt"
       FROM game_transaction WHERE user_id = $1
       ORDER BY created_at DESC, id LIMIT 30`,
      [userId],
    ),
    pool.query(
      `SELECT id, job_type AS "jobType", status, reward,
              pickup_x AS "pickupX", pickup_z AS "pickupZ",
              destination_x AS "destinationX", destination_z AS "destinationZ",
              destination_label AS "destinationLabel", started_at AS "startedAt"
       FROM job_run WHERE user_id = $1 AND status = 'active' LIMIT 1`,
      [userId],
    ),
    pool.query(
      `SELECT progress, hunger, energy, home_property_id AS "homePropertyId"
       FROM player_profile WHERE user_id = $1`,
      [userId],
    ),
  ]);
  const completedJobs = await pool.query(
    `SELECT COUNT(*)::INTEGER AS count FROM job_run
     WHERE user_id = $1 AND status = 'completed'`,
    [userId],
  );
  return {
    balance: Number(wallet.rows[0].balance),
    catalog: catalog.rows.map((row) => ({ ...row, price: Number(row.price) })),
    inventory: inventory.rows,
    transactions: transactions.rows.map((row) => ({
      ...row,
      amount: Number(row.amount),
      balanceAfter: Number(row.balanceAfter),
    })),
    activeJob: job.rows[0] ? { ...job.rows[0], reward: Number(job.rows[0].reward) } : null,
    completedJobs: completedJobs.rows[0].count as number,
    progress: (profile.rows[0]?.progress ?? {}) as Record<string, string>,
    needs: { hunger: profile.rows[0]?.hunger ?? 70, energy: profile.rows[0]?.energy ?? 80 },
    homePropertyId: (profile.rows[0]?.homePropertyId ?? null) as string | null,
  };
}

export async function purchaseItem(userId: string, itemId: string, idempotencyKey: string) {
  return withTransaction(async (client) => {
    await ensureWallet(client, userId);
    const wallet = await client.query(
      `SELECT balance FROM wallet WHERE user_id = $1 FOR UPDATE`,
      [userId],
    );
    if (await findReplay(client, userId, idempotencyKey)) {
      return { balance: Number(wallet.rows[0].balance), replayed: true, item: null };
    }
    const item = await client.query(
      `SELECT id, name, price, category, vendor_id FROM shop_catalog WHERE id = $1 AND active = TRUE`,
      [itemId],
    );
    if (!item.rowCount) throw new EconomyError("Item is not available", 404);
    const vendorId = item.rows[0].vendor_id as string | null;
    const vendor = vendorId ? placeById.get(vendorId) : undefined;
    if (vendor && !isNear(userId, vendor.door, VENDOR_RANGE)) {
      throw new EconomyError(`Visit ${vendor.name} on ${vendor.street} to buy this.`, 409);
    }
    const price = Number(item.rows[0].price);
    const balance = await debitWallet(
      client,
      userId,
      price,
      "purchase",
      item.rows[0].name,
      idempotencyKey,
      { itemId, vendorId },
    );
    await client.query(
      `INSERT INTO inventory_item (user_id, item_id)
       VALUES ($1, $2)
       ON CONFLICT (user_id, item_id) DO UPDATE
       SET quantity = inventory_item.quantity + 1`,
      [userId, itemId],
    );
    if (item.rows[0].category === "food") await markProgress(client, userId, "first_food");
    return { balance, replayed: false, item: { id: itemId, name: item.rows[0].name, price } };
  });
}

export async function eatItem(userId: string, itemId: string) {
  return withTransaction(async (client) => {
    const item = await client.query(
      `SELECT inventory_item.quantity, shop_catalog.name, shop_catalog.category
       FROM inventory_item JOIN shop_catalog ON shop_catalog.id = inventory_item.item_id
       WHERE inventory_item.user_id = $1 AND inventory_item.item_id = $2 FOR UPDATE`,
      [userId, itemId],
    );
    if (!item.rowCount) throw new EconomyError("You are not carrying that item.", 404);
    if (item.rows[0].category !== "food") throw new EconomyError("Only food can be eaten.");
    if (Number(item.rows[0].quantity) <= 1) {
      await client.query(`DELETE FROM inventory_item WHERE user_id = $1 AND item_id = $2`, [userId, itemId]);
    } else {
      await client.query(
        `UPDATE inventory_item SET quantity = quantity - 1 WHERE user_id = $1 AND item_id = $2`,
        [userId, itemId],
      );
    }
    await ensureProfile(client, userId);
    const needs = await client.query(
      `UPDATE player_profile SET hunger = LEAST(100, hunger + 35), updated_at = NOW()
       WHERE user_id = $1 RETURNING hunger, energy`,
      [userId],
    );
    await markProgress(client, userId, "first_meal");
    return { name: item.rows[0].name as string, needs: needs.rows[0] };
  });
}

export async function restAtHome(userId: string) {
  const position = getPlayerPosition(userId);
  if (!position || !/^(starter:|home:|hotel:)/.test(position.location)) {
    throw new EconomyError("Sleep inside your home or your hotel room.");
  }
  if (position.location.startsWith("hotel:")) {
    const room = await pool.query(
      `SELECT 1 FROM hotel_booking b WHERE b.id = $1 AND b.status = 'checked_in' AND b.ends_at > NOW()
         AND (b.user_id = $2 OR EXISTS (SELECT 1 FROM hotel_guest g WHERE g.booking_id = b.id AND g.user_id = $2))`,
      [position.location.slice(6), userId],
    );
    if (!room.rowCount) throw new EconomyError("Check in at reception before sleeping in this room.");
  }
  if (position.location.startsWith("home:")) {
    const propertyId = position.location.slice(5);
    const bed = await pool.query(
      `SELECT 1 FROM furniture_placement WHERE property_id = $1 AND item_id = ANY($2)`,
      [propertyId, BED_ITEM_IDS],
    );
    if (!bed.rowCount) throw new EconomyError("Place a bed here before sleeping.");
  }
  await ensureProfile(pool, userId);
  const result = await pool.query(
    `UPDATE player_profile SET energy = 100, hunger = GREATEST(0, hunger - 8), updated_at = NOW()
     WHERE user_id = $1 RETURNING hunger, energy`,
    [userId],
  );
  return result.rows[0];
}

export async function startDelivery(userId: string) {
  const hub = getPlace("swift-parcel-hub");
  if (!isNear(userId, hub.door, VENDOR_RANGE)) {
    throw new EconomyError(`Collect parcels at ${hub.name} on ${hub.street}.`, 409);
  }
  return withTransaction(async (client) => {
    await ensureWallet(client, userId);
    await client.query(`SELECT balance FROM wallet WHERE user_id = $1 FOR UPDATE`, [userId]);
    const existing = await client.query(
      `SELECT id, reward, destination_x AS "destinationX", destination_z AS "destinationZ",
              destination_label AS "destinationLabel"
       FROM job_run WHERE user_id = $1 AND status = 'active'`,
      [userId],
    );
    if (existing.rowCount) {
      return { ...existing.rows[0], reward: Number(existing.rows[0].reward), resumed: true };
    }
    const completed = await client.query(
      `SELECT COUNT(*)::INTEGER AS count FROM job_run WHERE user_id = $1 AND status = 'completed'`,
      [userId],
    );
    const destination = getPlace(
      DELIVERY_DESTINATIONS[completed.rows[0].count % DELIVERY_DESTINATIONS.length]!,
    );
    const distance = Math.hypot(destination.door[0] - hub.door[0], destination.door[1] - hub.door[1]);
    const boost = (await hasCertificate(client, userId, "logistics")) ? 1 + BUSINESS.jobBoost : 1;
    const reward = Math.round(((3_000 + distance * 14) * boost) / 50) * 50;
    const job = {
      id: randomUUID(),
      reward,
      destinationX: destination.door[0],
      destinationZ: destination.door[1],
      destinationLabel: `${destination.name}`,
      resumed: false,
    };
    await client.query(
      `INSERT INTO job_run
        (id, user_id, job_type, status, reward, pickup_x, pickup_z,
         destination_x, destination_z, destination_label)
       VALUES ($1, $2, 'delivery', 'active', $3, $4, $5, $6, $7, $8)`,
      [job.id, userId, reward, hub.door[0], hub.door[1], job.destinationX, job.destinationZ, job.destinationLabel],
    );
    return job;
  });
}

export async function completeDelivery(userId: string, jobId: string) {
  return withTransaction(async (client) => {
    await ensureWallet(client, userId);
    const result = await client.query(
      `SELECT id, status, reward, pickup_x, pickup_z, destination_x, destination_z, started_at
       FROM job_run WHERE id = $1 AND user_id = $2 FOR UPDATE`,
      [jobId, userId],
    );
    if (!result.rowCount) throw new EconomyError("Delivery not found", 404);
    const job = result.rows[0];
    if (job.status === "completed") {
      const wallet = await client.query(`SELECT balance FROM wallet WHERE user_id = $1`, [userId]);
      return { balance: Number(wallet.rows[0].balance), replayed: true, reward: 0 };
    }
    if (!isNear(userId, [job.destination_x, job.destination_z], 3.5)) {
      throw new EconomyError("The server has not verified arrival at the delivery door.");
    }
    const distance = Math.hypot(job.destination_x - job.pickup_x, job.destination_z - job.pickup_z);
    const minimumSeconds = Math.max(2, (distance / (MOVEMENT.sprintSpeed * 1.25)) * 0.8);
    if (Date.now() - new Date(job.started_at).getTime() < minimumSeconds * 1_000) {
      throw new EconomyError("Delivery completion was submitted too quickly.");
    }
    const reward = Number(job.reward);
    const balance = await creditWallet(client, userId, reward, "job_reward", "Swift Parcel delivery", `job:${jobId}`);
    await client.query(
      `UPDATE job_run SET status = 'completed', completed_at = NOW() WHERE id = $1`,
      [jobId],
    );
    await ensureProfile(client, userId);
    await client.query(
      `UPDATE player_profile SET hunger = GREATEST(0, hunger - 10), energy = GREATEST(0, energy - 10)
       WHERE user_id = $1`,
      [userId],
    );
    await markProgress(client, userId, "first_wage");
    return { balance, replayed: false, reward };
  });
}

export async function cancelDelivery(userId: string) {
  await pool.query(
    `UPDATE job_run SET status = 'cancelled', completed_at = NOW()
     WHERE user_id = $1 AND status = 'active'`,
    [userId],
  );
  return { cancelled: true };
}

/** Charges a danfo fare once per journey id. */
export async function chargeFare(input: {
  userId: string;
  journeyId: string;
  routeId: string;
  busId: string;
  stopId: string;
  fare: number;
}) {
  return withTransaction(async (client) => {
    await ensureWallet(client, input.userId);
    const wallet = await client.query(
      `SELECT balance FROM wallet WHERE user_id = $1 FOR UPDATE`,
      [input.userId],
    );
    const key = `fare:${input.journeyId}`;
    if (await findReplay(client, input.userId, key)) {
      return { balance: Number(wallet.rows[0].balance), replayed: true };
    }
    await client.query(
      `UPDATE transport_journey SET status = 'interrupted', ended_at = NOW()
       WHERE user_id = $1 AND status = 'riding'`,
      [input.userId],
    );
    const balance = await debitWallet(
      client,
      input.userId,
      input.fare,
      "transport_fare",
      `Danfo fare · ${input.routeId.toUpperCase()}`,
      key,
      { busId: input.busId, stopId: input.stopId },
    );
    await client.query(
      `INSERT INTO transport_journey
        (id, user_id, route_id, bus_id, board_stop_id, fare, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'riding')`,
      [input.journeyId, input.userId, input.routeId, input.busId, input.stopId, input.fare],
    );
    await markProgress(client, input.userId, "first_ride");
    return { balance, replayed: false };
  });
}

export async function endJourney(
  userId: string,
  journeyId: string,
  stopId: string | null,
  status: "completed" | "interrupted",
) {
  await pool.query(
    `UPDATE transport_journey SET status = $3, alight_stop_id = $4, ended_at = NOW()
     WHERE id = $1 AND user_id = $2 AND status = 'riding'`,
    [journeyId, userId, status, stopId],
  );
}

export async function savePlayerPlace(userId: string, x: number, z: number, place: string) {
  await pool.query(
    `INSERT INTO player_profile (user_id, saved_x, saved_z, saved_place)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id) DO UPDATE
     SET saved_x = EXCLUDED.saved_x, saved_z = EXCLUDED.saved_z,
         saved_place = EXCLUDED.saved_place, updated_at = NOW()`,
    [userId, x, z, place],
  );
}

export async function loadPlayerPlace(userId: string) {
  const result = await pool.query(
    `SELECT saved_x AS x, saved_z AS z, saved_place AS place FROM player_profile WHERE user_id = $1`,
    [userId],
  );
  const row = result.rows[0];
  if (!row || row.x === null || row.z === null) return null;
  return { x: Number(row.x), z: Number(row.z), place: String(row.place ?? "street") };
}

export async function resetTestProgress(userId: string) {
  await withTransaction(async (client) => {
    await client.query(`DELETE FROM travel_invite WHERE from_user_id = $1 OR to_user_id = $1`, [userId]);
    await client.query(`DELETE FROM travel_ticket WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM travel_visa WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM hotel_guest WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM hotel_booking WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM travel_photo WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM travel_activity WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM player_vehicle WHERE owner_user_id = $1`, [userId]);
    await client.query(`DELETE FROM bike_rental WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM community_visit WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM club_entry WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM club_table_booking WHERE owner_user_id = $1`, [userId]);
    await client.query(`DELETE FROM club_table_guest WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM club_order WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM citation WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM police_case WHERE reporter_id = $1 OR accused_id = $1`, [userId]);
    await client.query(`DELETE FROM robbery WHERE robber_id = $1 OR victim_id = $1`, [userId]);
    await client.query(`DELETE FROM checkpoint_stop WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM security_hire WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM furniture_placement WHERE placed_by = $1`, [userId]);
    await client.query(`DELETE FROM property_storage WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM property_guest WHERE guest_user_id = $1 OR granted_by = $1`, [userId]);
    await client.query(`DELETE FROM property_tenure WHERE owner_user_id = $1`, [userId]);
    await client.query(`DELETE FROM transport_journey WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM job_run WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM inventory_item WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM game_transaction WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM wallet WHERE user_id = $1`, [userId]);
    await client.query(
      `UPDATE player_profile
       SET saved_x = NULL, saved_z = NULL, saved_place = NULL, home_property_id = NULL,
           progress = '{}', hunger = 70, energy = 80, tutorial_complete = FALSE, updated_at = NOW()
       WHERE user_id = $1`,
      [userId],
    );
    await ensureWallet(client, userId);
  });
  vehicleEvents.emit("ownerReset", userId);
}
