import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { config } from "./config.js";
import { pool } from "./database.js";
import { getPlayerPosition } from "./player-presence.js";

export class EconomyError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

async function ensureWallet(client: PoolClient, userId: string) {
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

export async function getEconomyState(userId: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await ensureWallet(client, userId);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  const [wallet, catalog, inventory, transactions, job] = await Promise.all([
    pool.query(`SELECT balance FROM wallet WHERE user_id = $1`, [userId]),
    pool.query(
      `SELECT id, name, description, category, price
       FROM shop_catalog WHERE active = TRUE ORDER BY price`,
    ),
    pool.query(
      `SELECT inventory_item.item_id AS "itemId", shop_catalog.name,
              inventory_item.quantity
       FROM inventory_item
       JOIN shop_catalog ON shop_catalog.id = inventory_item.item_id
       WHERE inventory_item.user_id = $1 ORDER BY shop_catalog.name`,
      [userId],
    ),
    pool.query(
      `SELECT id, kind, amount, balance_after AS "balanceAfter", reference, created_at AS "createdAt"
       FROM game_transaction WHERE user_id = $1
       ORDER BY created_at DESC LIMIT 20`,
      [userId],
    ),
    pool.query(
      `SELECT id, job_type AS "jobType", status, reward,
              pickup_x AS "pickupX", pickup_z AS "pickupZ",
              destination_x AS "destinationX", destination_z AS "destinationZ",
              started_at AS "startedAt"
       FROM job_run WHERE user_id = $1 AND status = 'active' LIMIT 1`,
      [userId],
    ),
  ]);
  return {
    balance: Number(wallet.rows[0].balance),
    catalog: catalog.rows.map((row) => ({ ...row, price: Number(row.price) })),
    inventory: inventory.rows,
    transactions: transactions.rows.map((row) => ({
      ...row,
      amount: Number(row.amount),
      balanceAfter: Number(row.balanceAfter),
    })),
    activeJob: job.rows[0]
      ? { ...job.rows[0], reward: Number(job.rows[0].reward) }
      : null,
  };
}

export async function purchaseItem(userId: string, itemId: string, idempotencyKey: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await ensureWallet(client, userId);
    const wallet = await client.query(
      `SELECT balance FROM wallet WHERE user_id = $1 FOR UPDATE`,
      [userId],
    );
    const replay = await client.query(
      `SELECT id FROM game_transaction
       WHERE user_id = $1 AND idempotency_key = $2`,
      [userId, idempotencyKey],
    );
    if (replay.rowCount) {
      await client.query("COMMIT");
      return { balance: Number(wallet.rows[0].balance), replayed: true };
    }
    const item = await client.query(
      `SELECT id, name, price FROM shop_catalog WHERE id = $1 AND active = TRUE`,
      [itemId],
    );
    if (!item.rowCount) throw new EconomyError("Item is not available", 404);
    const price = Number(item.rows[0].price);
    const updated = await client.query(
      `UPDATE wallet SET balance = balance - $2, updated_at = NOW()
       WHERE user_id = $1 AND balance >= $2 RETURNING balance`,
      [userId, price],
    );
    if (!updated.rowCount) throw new EconomyError("Insufficient game naira");
    const balance = Number(updated.rows[0].balance);
    await client.query(
      `INSERT INTO inventory_item (user_id, item_id)
       VALUES ($1, $2)
       ON CONFLICT (user_id, item_id) DO UPDATE
       SET quantity = inventory_item.quantity + 1`,
      [userId, itemId],
    );
    await client.query(
      `INSERT INTO game_transaction
        (id, user_id, kind, amount, balance_after, reference, idempotency_key, metadata)
       VALUES ($1, $2, 'purchase', $3, $4, $5, $6, $7)`,
      [
        randomUUID(),
        userId,
        -price,
        balance,
        item.rows[0].name,
        idempotencyKey,
        JSON.stringify({ itemId }),
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

export async function startDelivery(userId: string) {
  const position = getPlayerPosition(userId);
  if (!position || Math.hypot(position.x + 10, position.z) > 4) {
    throw new EconomyError("Go to the Alfred Rewane pickup marker before starting.");
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await ensureWallet(client, userId);
    await client.query(`SELECT balance FROM wallet WHERE user_id = $1 FOR UPDATE`, [userId]);
    const existing = await client.query(
      `SELECT id, reward, destination_x AS "destinationX", destination_z AS "destinationZ"
       FROM job_run WHERE user_id = $1 AND status = 'active'`,
      [userId],
    );
    if (existing.rowCount) {
      await client.query("COMMIT");
      return { ...existing.rows[0], reward: Number(existing.rows[0].reward) };
    }
    const job = {
      id: randomUUID(),
      reward: 8_500,
      destinationX: -5.7,
      destinationZ: -11.5,
    };
    await client.query(
      `INSERT INTO job_run
        (id, user_id, job_type, status, reward, pickup_x, pickup_z, destination_x, destination_z)
       VALUES ($1, $2, 'delivery', 'active', $3, -10, 0, $4, $5)`,
      [job.id, userId, job.reward, job.destinationX, job.destinationZ],
    );
    await client.query("COMMIT");
    return job;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function completeDelivery(userId: string, jobId: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await ensureWallet(client, userId);
    const result = await client.query(
      `SELECT id, status, reward, destination_x, destination_z, started_at
       FROM job_run WHERE id = $1 AND user_id = $2 FOR UPDATE`,
      [jobId, userId],
    );
    if (!result.rowCount) throw new EconomyError("Delivery not found", 404);
    const job = result.rows[0];
    if (job.status === "completed") {
      const wallet = await client.query(`SELECT balance FROM wallet WHERE user_id = $1`, [userId]);
      await client.query("COMMIT");
      return { balance: Number(wallet.rows[0].balance), replayed: true };
    }
    const position = getPlayerPosition(userId);
    if (
      !position ||
      Math.hypot(position.x - job.destination_x, position.z - job.destination_z) > 2.5
    ) {
      throw new EconomyError("The server has not verified arrival at the delivery marker.");
    }
    if (Date.now() - new Date(job.started_at).getTime() < 2_000) {
      throw new EconomyError("Delivery completion was submitted too quickly.");
    }
    const reward = Number(job.reward);
    const wallet = await client.query(
      `UPDATE wallet SET balance = balance + $2, updated_at = NOW()
       WHERE user_id = $1 RETURNING balance`,
      [userId, reward],
    );
    const balance = Number(wallet.rows[0].balance);
    await client.query(
      `UPDATE job_run SET status = 'completed', completed_at = NOW() WHERE id = $1`,
      [jobId],
    );
    await client.query(
      `INSERT INTO game_transaction
        (id, user_id, kind, amount, balance_after, reference, idempotency_key)
       VALUES ($1, $2, 'job_reward', $3, $4, 'Neighbourhood delivery', $5)`,
      [randomUUID(), userId, reward, balance, `job:${jobId}`],
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
