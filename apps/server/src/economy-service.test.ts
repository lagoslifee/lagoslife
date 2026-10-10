import { getPlace } from "@lagos-living/shared";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  chargeFare,
  completeDelivery,
  eatItem,
  getEconomyState,
  purchaseItem,
  startDelivery,
} from "./economy-service.js";
import { pool } from "./database.js";
import { setPlayerPosition } from "./player-presence.js";

const userId = `economy-test-${randomUUID()}`;
const poorUserId = `economy-poor-${randomUUID()}`;

async function createUser(id: string) {
  const username = `econ${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  await pool.query(
    `INSERT INTO "user"
      (id, name, email, "emailVerified", "createdAt", "updatedAt", username, "displayUsername")
     VALUES ($1, 'Economy Test', $2, FALSE, NOW(), NOW(), $3, $3)`,
    [id, `${username}@example.test`, username],
  );
}

function standAt(id: string, placeId: string) {
  const { door } = getPlace(placeId);
  setPlayerPosition(id, door[0], door[1]);
}

beforeAll(async () => {
  await createUser(userId);
  await createUser(poorUserId);
});

afterAll(async () => {
  await pool.query(`DELETE FROM "user" WHERE id = ANY($1)`, [[userId, poorUserId]]);
});

describe("transactional economy", () => {
  it("requires being at the vendor before buying", async () => {
    standAt(userId, "starter-home");
    await expect(purchaseItem(userId, "jollof-takeaway", randomUUID())).rejects.toThrow(
      "Mama Titi's Buka",
    );
  });

  it("deducts a concurrent duplicate purchase exactly once", async () => {
    standAt(userId, "mama-titi-buka");
    const before = await getEconomyState(userId);
    const key = randomUUID();
    const results = await Promise.all([
      purchaseItem(userId, "jollof-takeaway", key),
      purchaseItem(userId, "jollof-takeaway", key),
    ]);
    const after = await getEconomyState(userId);

    expect(after.balance).toBe(before.balance - 2500);
    expect(after.inventory.find(({ itemId }) => itemId === "jollof-takeaway")?.quantity).toBe(1);
    expect(results.filter(({ replayed }) => replayed)).toHaveLength(1);
    expect(after.progress.first_food).toBeTruthy();
  });

  it("eats a carried meal and removes it from inventory", async () => {
    const eaten = await eatItem(userId, "jollof-takeaway");
    expect(eaten.needs.hunger).toBeGreaterThan(70);
    const after = await getEconomyState(userId);
    expect(after.inventory.find(({ itemId }) => itemId === "jollof-takeaway")).toBeUndefined();
    await expect(eatItem(userId, "jollof-takeaway")).rejects.toThrow("not carrying");
  });

  it("rejects starting away from the hub, remote completion, and pays once", async () => {
    standAt(userId, "starter-home");
    await expect(startDelivery(userId)).rejects.toThrow("Swift Parcel Hub");
    standAt(userId, "swift-parcel-hub");
    const job = await startDelivery(userId);
    expect(job.reward).toBeGreaterThan(3000);
    await expect(completeDelivery(userId, job.id)).rejects.toThrow("server has not verified arrival");

    setPlayerPosition(userId, job.destinationX, job.destinationZ);
    await expect(completeDelivery(userId, job.id)).rejects.toThrow("too quickly");

    await pool.query(
      `UPDATE job_run SET started_at = NOW() - INTERVAL '5 minutes' WHERE id = $1`,
      [job.id],
    );
    const before = await getEconomyState(userId);
    const results = await Promise.all([
      completeDelivery(userId, job.id),
      completeDelivery(userId, job.id),
    ]);
    const after = await getEconomyState(userId);

    expect(results.filter(({ replayed }) => !replayed)).toHaveLength(1);
    expect(after.balance).toBe(before.balance + job.reward);
    expect(after.transactions.filter(({ kind }) => kind === "job_reward")).toHaveLength(1);
  });

  it("varies the delivery destination between shifts", async () => {
    standAt(userId, "swift-parcel-hub");
    const next = await startDelivery(userId);
    const first = await pool.query(
      `SELECT destination_label FROM job_run WHERE user_id = $1 AND status = 'completed'`,
      [userId],
    );
    expect(next.destinationLabel).not.toBe(first.rows[0].destination_label);
  });
});

describe("danfo fares", () => {
  it("charges a journey exactly once under concurrent retries", async () => {
    const before = await getEconomyState(userId);
    const journey = {
      userId,
      journeyId: randomUUID(),
      routeId: "admiralty-loop",
      busId: "danfo-1",
      stopId: "kayode-wb",
      fare: 300,
    };
    const results = await Promise.all([chargeFare(journey), chargeFare(journey), chargeFare(journey)]);
    const after = await getEconomyState(userId);
    expect(after.balance).toBe(before.balance - 300);
    expect(results.filter(({ replayed }) => !replayed)).toHaveLength(1);
    expect(after.transactions.filter(({ kind }) => kind === "transport_fare")).toHaveLength(1);
    const riding = await pool.query(
      `SELECT COUNT(*)::INTEGER AS count FROM transport_journey WHERE user_id = $1 AND status = 'riding'`,
      [userId],
    );
    expect(riding.rows[0].count).toBe(1);
  });

  it("refuses a fare the wallet cannot cover without going negative", async () => {
    await getEconomyState(poorUserId);
    await pool.query(`UPDATE wallet SET balance = 100 WHERE user_id = $1`, [poorUserId]);
    await expect(
      chargeFare({
        userId: poorUserId,
        journeyId: randomUUID(),
        routeId: "admiralty-loop",
        busId: "danfo-2",
        stopId: "kayode-eb",
        fare: 300,
      }),
    ).rejects.toThrow("Insufficient");
    const after = await getEconomyState(poorUserId);
    expect(after.balance).toBe(100);
  });
});
