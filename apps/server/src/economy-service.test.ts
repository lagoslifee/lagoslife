import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  completeDelivery,
  getEconomyState,
  purchaseItem,
  startDelivery,
} from "./economy-service.js";
import { pool } from "./database.js";
import { setPlayerPosition } from "./player-presence.js";

const userId = `economy-test-${randomUUID()}`;
const username = `econ${randomUUID().replaceAll("-", "").slice(0, 12)}`;

beforeAll(async () => {
  await pool.query(
    `INSERT INTO "user"
      (id, name, email, "emailVerified", "createdAt", "updatedAt", username, "displayUsername")
     VALUES ($1, 'Economy Test', $2, FALSE, NOW(), NOW(), $3, $3)`,
    [userId, `${username}@example.test`, username],
  );
});

afterAll(async () => {
  await pool.query(`DELETE FROM "user" WHERE id = $1`, [userId]);
});

describe("transactional economy", () => {
  it("deducts a concurrent duplicate purchase exactly once", async () => {
    const before = await getEconomyState(userId);
    const key = randomUUID();
    const results = await Promise.all([
      purchaseItem(userId, "island-water", key),
      purchaseItem(userId, "island-water", key),
    ]);
    const after = await getEconomyState(userId);

    expect(after.balance).toBe(before.balance - 500);
    expect(after.inventory.find(({ itemId }) => itemId === "island-water")?.quantity).toBe(1);
    expect(results.filter(({ replayed }) => replayed)).toHaveLength(1);
  });

  it("rejects remote completion and pays a delivery only once", async () => {
    setPlayerPosition(userId, -10, 0);
    const job = await startDelivery(userId);
    await expect(completeDelivery(userId, job.id)).rejects.toThrow(
      "server has not verified arrival",
    );

    await pool.query(
      `UPDATE job_run SET started_at = NOW() - INTERVAL '10 seconds' WHERE id = $1`,
      [job.id],
    );
    setPlayerPosition(userId, job.destinationX, job.destinationZ);
    const before = await getEconomyState(userId);
    const first = await completeDelivery(userId, job.id);
    const second = await completeDelivery(userId, job.id);
    const after = await getEconomyState(userId);

    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(after.balance).toBe(before.balance + job.reward);
    expect(after.transactions.filter(({ kind }) => kind === "job_reward")).toHaveLength(1);
  });
});
