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
  MECHANIC_ID,
  purchaseVehicle,
  retrieveVehicle,
  saveDrivingVehicle,
  serviceVehicle,
  towVehicle,
} from "./vehicle-service.js";

const users = [0, 1].map(() => ({
  id: `vehicle-user-${randomUUID()}`,
  username: `car${randomUUID().replaceAll("-", "").slice(0, 12)}`,
}));
const [driver, rival] = users as [(typeof users)[0], (typeof users)[0]];
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

  it("insures weekly, refuses stacking cover, then tows for free and caps repairs at the excess", async () => {
    await pool.query(`UPDATE wallet SET balance = 100000 WHERE user_id = $1`, [driver.id]);
    const insured = await insureVehicle(driver.id, vehicleId, randomUUID());
    expect(insured.vehicle.insured).toBe(true);
    expect(await balance(driver.id)).toBe(100_000 - insurancePremium(saloon));
    await expect(insureVehicle(driver.id, vehicleId, randomUUID())).rejects.toThrow("already active");

    await pool.query(`UPDATE player_vehicle SET x = 0, z = 0 WHERE id = $1`, [vehicleId]);
    await damageVehicle(driver.id, vehicleId, 100, 20);
    expect(await claimVehicle(driver.id, vehicleId, "dead-engine")).toBeNull();
    const beforeTow = await balance(driver.id);
    const tow = await towVehicle(driver.id, vehicleId, randomUUID());
    expect(tow.charged).toBe(0);
    expect(await balance(driver.id)).toBe(beforeTow);
    const towed = await vehicleRow(vehicleId);
    expect(Math.hypot(towed.x - mechanic.kerb[0], towed.z - mechanic.kerb[1])).toBeLessThan(VEHICLE_RULES.workshopRange);

    setPlayerPosition(driver.id, ...mechanic.door);
    const beforeRepair = await balance(driver.id);
    await serviceVehicle(driver.id, vehicleId, randomUUID());
    expect(await balance(driver.id)).toBe(beforeRepair - VEHICLE_RULES.routineServiceFee - VEHICLE_RULES.insuredExcess);
  });

  it("charges the tow fee when uninsured", async () => {
    await pool.query(`UPDATE player_vehicle SET insured_until = NULL WHERE id = $1`, [vehicleId]);
    const before = await balance(driver.id);
    const tow = await towVehicle(driver.id, vehicleId, randomUUID());
    expect(tow.charged).toBe(VEHICLE_RULES.towFee);
    expect(await balance(driver.id)).toBe(before - VEHICLE_RULES.towFee);
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
    await expect(towVehicle(rival.id, vehicleId, randomUUID())).rejects.toThrow("not yours");
  });
});
