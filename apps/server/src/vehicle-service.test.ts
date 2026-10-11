import {
  getPlace,
  getVehicleModel,
  insurancePremium,
  repairCost,
  VEHICLE_RULES,
} from "@lagos-living/shared";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "./database.js";
import { setPlayerPosition } from "./player-presence.js";
import {
  claimVehicle,
  damageVehicle,
  DEALERSHIP_ID,
  garageVehicle,
  insureVehicle,
  listVehicles,
  MAX_VEHICLES,
  MECHANIC_ID,
  purchaseVehicle,
  retrieveVehicle,
  saveDrivingVehicle,
  serviceVehicle,
} from "./vehicle-service.js";
import { cancelTow, collectTow, deliverTow, mechanicDelivery, requestTow } from "./tow-service.js";

const users = [0, 1, 2].map(() => ({
  id: `vehicle-user-${randomUUID()}`,
  username: `car${randomUUID().replaceAll("-", "").slice(0, 12)}`,
}));
const [driver, rival, collector] = users as [(typeof users)[0], (typeof users)[0], (typeof users)[0]];
const homeId = `vehicle-home-${randomUUID()}`;
const dealer = getPlace(DEALERSHIP_ID);
const mechanic = getPlace(MECHANIC_ID);
const saloon = getVehicleModel("tokunbo-saloon");

async function balance(userId: string) {
  const result = await pool.query(`SELECT balance FROM wallet WHERE user_id = $1`, [userId]);
  return Number(result.rows[0].balance);
}

async function vehicleRow(id: string) {
  const result = await pool.query(`SELECT * FROM player_vehicle WHERE id = $1`, [id]);
  return result.rows[0];
}

beforeAll(async () => {
  for (const user of users) {
    await pool.query(
      `INSERT INTO "user"
        (id, name, email, "emailVerified", "createdAt", "updatedAt", username, "displayUsername")
       VALUES ($1, 'Vehicle Test', $2, FALSE, NOW(), NOW(), $3, $3)`,
      [user.id, `${user.username}@example.test`, user.username],
    );
  }
  await pool.query(
    `INSERT INTO property_listing
      (id, name, district, address_label, purchase_price, monthly_rent, world_x, world_z, listing_type)
     VALUES ($1, 'Test Garage House', 'Lekki', 'Automated vehicle test', 100000, 20000, $2, $3, 'sale')`,
    [homeId, mechanic.kerb[0], mechanic.kerb[1] + 6],
  );
});

afterAll(async () => {
  await pool.query(`DELETE FROM player_vehicle WHERE owner_user_id = ANY($1)`, [users.map(({ id }) => id)]);
  await pool.query(`DELETE FROM property_tenure WHERE property_id = $1`, [homeId]);
  await pool.query(`DELETE FROM property_listing WHERE id = $1`, [homeId]);
  await pool.query(`DELETE FROM "user" WHERE id = ANY($1)`, [users.map(({ id }) => id)]);
});

describe("vehicle ownership", () => {
  let vehicleId = "";

  it("only sells at the dealership", async () => {
    setPlayerPosition(driver.id, 0, 0);
    await expect(purchaseVehicle(driver.id, saloon.id, saloon.colours[0]!, randomUUID())).rejects.toThrow(
      "Visit Lekki Motors",
    );
  });

  it("rejects colours that are not offered", async () => {
    setPlayerPosition(driver.id, ...dealer.door);
    await expect(purchaseVehicle(driver.id, saloon.id, "#00ff00", randomUUID())).rejects.toThrow("colour");
  });

  it("charges a double-clicked purchase once and returns the same car", async () => {
    setPlayerPosition(driver.id, ...dealer.door);
    const key = randomUUID();
    const results = await Promise.all([0, 1, 2].map(() => purchaseVehicle(driver.id, saloon.id, saloon.colours[1]!, key)));
    expect(new Set(results.map(({ vehicle }) => vehicle.id)).size).toBe(1);
    expect(results.filter(({ replayed }) => !replayed)).toHaveLength(1);
    expect(await balance(driver.id)).toBe(250_000 - saloon.price);
    vehicleId = results[0]!.vehicle.id;
    const row = await vehicleRow(vehicleId);
    expect(row.status).toBe("parked");
    expect(Math.hypot(row.x - dealer.kerb[0], row.z - dealer.kerb[1])).toBeLessThan(50);
    expect(row.plate).toMatch(/^EKO \d{3} [A-Z]{2}$/);
  });

  it("refuses a second car the wallet cannot cover, without charging", async () => {
    setPlayerPosition(driver.id, ...dealer.door);
    await expect(purchaseVehicle(driver.id, saloon.id, saloon.colours[0]!, randomUUID())).rejects.toThrow(
      "Insufficient",
    );
    expect(await balance(driver.id)).toBe(250_000 - saloon.price);
    expect(await listVehicles(driver.id)).toHaveLength(1);
  });

  it("lets exactly one of two simultaneous purchases through when funds cover one", async () => {
    setPlayerPosition(rival.id, ...dealer.door);
    const attempts = await Promise.allSettled([
      purchaseVehicle(rival.id, saloon.id, saloon.colours[0]!, randomUUID()),
      purchaseVehicle(rival.id, saloon.id, saloon.colours[2]!, randomUUID()),
    ]);
    expect(attempts.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(await balance(rival.id)).toBe(250_000 - saloon.price);
  });

  it(`stops a resident at ${MAX_VEHICLES} cars without charging for the next`, async () => {
    const hatch = getVehicleModel("eko-hatch");
    setPlayerPosition(collector.id, ...dealer.door);
    await purchaseVehicle(collector.id, hatch.id, hatch.colours[0]!, randomUUID());
    await pool.query(`UPDATE wallet SET balance = 1000000 WHERE user_id = $1`, [collector.id]);
    for (let i = 1; i < MAX_VEHICLES; i += 1) await purchaseVehicle(collector.id, hatch.id, hatch.colours[0]!, randomUUID());
    await expect(purchaseVehicle(collector.id, hatch.id, hatch.colours[0]!, randomUUID())).rejects.toThrow(
      `up to ${MAX_VEHICLES} motor vehicles`,
    );
    expect(await balance(collector.id)).toBe(1_000_000 - (MAX_VEHICLES - 1) * hatch.price);
    expect(await listVehicles(collector.id)).toHaveLength(MAX_VEHICLES);
  });

  it("hands the keys to one session at a time and records distance when parked", async () => {
    const claims = await Promise.all([
      claimVehicle(driver.id, vehicleId, "session-a"),
      claimVehicle(driver.id, vehicleId, "session-b"),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(await claimVehicle(rival.id, vehicleId, "session-c")).toBeNull();
    const destination = { x: mechanic.kerb[0], z: mechanic.kerb[1], yaw: mechanic.kerbYaw };
    await saveDrivingVehicle(vehicleId, destination, 320, false);
    await saveDrivingVehicle(vehicleId, destination, 15, true);
    const row = await vehicleRow(vehicleId);
    expect(row.status).toBe("parked");
    expect(row.driver_session_id).toBeNull();
    expect(row.odometer_m).toBeCloseTo(335);
  });

  it("charges routine service plus repair at the mechanic and restores condition", async () => {
    const damage = await damageVehicle(driver.id, vehicleId, 40, 18);
    expect(damage?.condition).toBe(60);
    setPlayerPosition(driver.id, 0, 0);
    await expect(serviceVehicle(driver.id, vehicleId, randomUUID())).rejects.toThrow("Bring the vehicle");
    setPlayerPosition(driver.id, ...mechanic.door);
    const before = await balance(driver.id);
    const key = randomUUID();
    const [first, replay] = await Promise.all([
      serviceVehicle(driver.id, vehicleId, key),
      serviceVehicle(driver.id, vehicleId, key),
    ]);
    const expected = VEHICLE_RULES.routineServiceFee + repairCost(saloon, 60);
    expect([first.replayed, replay.replayed].sort()).toEqual([false, true]);
    expect(await balance(driver.id)).toBe(before - expected);
    expect((await vehicleRow(vehicleId)).condition).toBe(100);
  });

  it("stops minor knocks at the floor; only a severe impact disables the car", async () => {
    await pool.query(`UPDATE player_vehicle SET condition = 20 WHERE id = $1`, [vehicleId]);
    expect((await damageVehicle(driver.id, vehicleId, 30, 10))?.condition).toBe(VEHICLE_RULES.minorFloor);
    expect((await damageVehicle(driver.id, vehicleId, 30, 10))?.condition).toBe(VEHICLE_RULES.minorFloor);
    expect((await damageVehicle(driver.id, vehicleId, 30, 20, true))?.condition).toBe(0);
    await pool.query(`UPDATE player_vehicle SET condition = 100 WHERE id = $1`, [vehicleId]);
  });

  it("insures weekly, then a tow is free and repairs are capped at the excess; the same car comes back repaired", async () => {
    await pool.query(`UPDATE wallet SET balance = 100000 WHERE user_id = $1`, [driver.id]);
    const insured = await insureVehicle(driver.id, vehicleId, randomUUID());
    expect(insured.vehicle.insured).toBe(true);
    expect(await balance(driver.id)).toBe(100_000 - insurancePremium(saloon));
    await expect(insureVehicle(driver.id, vehicleId, randomUUID())).rejects.toThrow("already active");

    await pool.query(`UPDATE player_vehicle SET x = 0, z = 0 WHERE id = $1`, [vehicleId]);
    await damageVehicle(driver.id, vehicleId, 100, 20, true);
    expect(await claimVehicle(driver.id, vehicleId, "dead-engine")).toBeNull();
    const before = await vehicleRow(vehicleId);
    const beforeTow = await balance(driver.id);
    const key = randomUUID();
    const [first, replay] = await Promise.all([
      requestTow(driver.id, vehicleId, { kind: "here" }, key),
      requestTow(driver.id, vehicleId, { kind: "here" }, key),
    ]);
    expect(first.job.id).toBe(replay.job.id);
    expect(first.job.quote.towFee).toBe(0);
    expect(first.job.quote.repair).toBe(VEHICLE_RULES.insuredExcess);
    expect(first.job.quote.insurer).toBe(repairCost(saloon, 0) - VEHICLE_RULES.insuredExcess);
    expect(await balance(driver.id)).toBe(beforeTow - VEHICLE_RULES.insuredExcess);
    await expect(requestTow(driver.id, vehicleId, { kind: "here" }, randomUUID())).rejects.toThrow("already on its way");
    setPlayerPosition(driver.id, ...mechanic.door);
    await expect(serviceVehicle(driver.id, vehicleId, randomUUID())).rejects.toThrow("recovery truck");

    expect(await collectTow(first.job.id)).toBe(true);
    expect((await vehicleRow(vehicleId)).status).toBe("towing");
    expect(await cancelTow(first.job.id, driver.id, "too late")).toBeNull();
    const spot = await mechanicDelivery(vehicleId);
    expect(await deliverTow(first.job.id, spot, null)).toBe(vehicleId);
    expect(await deliverTow(first.job.id, spot, null)).toBeNull();
    const after = await vehicleRow(vehicleId);
    expect(after.status).toBe("parked");
    expect(after.condition).toBe(100);
    expect([after.plate, after.colour, after.model_id, after.owner_user_id]).toEqual([before.plate, before.colour, before.model_id, before.owner_user_id]);
    expect(Math.hypot(after.x - mechanic.kerb[0], after.z - mechanic.kerb[1])).toBeLessThan(VEHICLE_RULES.workshopRange);
    expect(await balance(driver.id)).toBe(beforeTow - VEHICLE_RULES.insuredExcess);
  });

  it("charges the tow fee and full repair when uninsured, and refunds a cancelled tow", async () => {
    await pool.query(`UPDATE player_vehicle SET insured_until = NULL, condition = 70 WHERE id = $1`, [vehicleId]);
    const before = await balance(driver.id);
    const { job } = await requestTow(driver.id, vehicleId, { kind: "here" }, randomUUID());
    expect(job.quote.total).toBe(VEHICLE_RULES.towFee + repairCost(saloon, 70));
    expect(await balance(driver.id)).toBe(before - job.quote.total);
    expect(await cancelTow(job.id, driver.id, "changed my mind")).toEqual({ refunded: job.quote.total });
    expect(await balance(driver.id)).toBe(before);
    await pool.query(`UPDATE player_vehicle SET condition = 100 WHERE id = $1`, [vehicleId]);
  });

  it("garages only at a held home and brings the car back out at the door", async () => {
    setPlayerPosition(driver.id, mechanic.kerb[0], mechanic.kerb[1]);
    await expect(garageVehicle(driver.id, vehicleId, homeId)).rejects.toThrow("home you hold");
    await pool.query(
      `INSERT INTO property_tenure (property_id, owner_user_id, tenure_type) VALUES ($1, $2, 'owned')`,
      [homeId, driver.id],
    );
    const towed = await vehicleRow(vehicleId);
    setPlayerPosition(driver.id, towed.x, towed.z);
    await garageVehicle(driver.id, vehicleId, homeId);
    expect((await vehicleRow(vehicleId)).status).toBe("garaged");
    expect(await claimVehicle(driver.id, vehicleId, "garaged")).toBeNull();

    setPlayerPosition(driver.id, 0, 0);
    await expect(retrieveVehicle(driver.id, vehicleId)).rejects.toThrow("take the vehicle out");
    setPlayerPosition(driver.id, mechanic.kerb[0], mechanic.kerb[1] + 6);
    await retrieveVehicle(driver.id, vehicleId);
    const out = await vehicleRow(vehicleId);
    expect(out.status).toBe("parked");
    expect(out.garage_property_id).toBeNull();
  });

  it("keeps other residents away from a car they do not own", async () => {
    setPlayerPosition(rival.id, ...mechanic.door);
    await expect(serviceVehicle(rival.id, vehicleId, randomUUID())).rejects.toThrow("not yours");
    await expect(requestTow(rival.id, vehicleId, { kind: "here" }, randomUUID())).rejects.toThrow("not yours");
  });
});
