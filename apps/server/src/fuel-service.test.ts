import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { burnFuel, FUEL, FUEL_STATIONS, fuelSpec, getVehicleModel, walkable } from "@lagos-living/shared";

const { pool } = await import("./database.js");
const { buyFuel, buyStation, fuelStations, setStationPrice } = await import("./fuel-service.js");
const { setPlayerPosition } = await import("./player-presence.js");

const makeUser = (tag: string) => ({ id: `${tag}-${randomUUID()}`, username: `${tag}${randomUUID().replaceAll("-", "").slice(0, 12)}` });
const driver = makeUser("driver");
const owner = makeUser("pumper");
const START = 100_000_000;
const station = FUEL_STATIONS[0]!;
const vehicleId = `fuel-car-${randomUUID()}`;
const modelId = "toyota-corolla";
const balance = async (userId: string) => Number((await pool.query(`SELECT balance FROM wallet WHERE user_id = $1`, [userId])).rows[0].balance);

beforeAll(async () => {
  for (const user of [driver, owner]) {
    await pool.query(
      `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt", username, "displayUsername") VALUES ($1, $2, $3, FALSE, NOW(), NOW(), $4, $4)`,
      [user.id, user.username, `${user.username}@example.test`, user.username],
    );
    await pool.query(`INSERT INTO wallet (user_id, balance) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET balance = $2`, [user.id, START]);
  }
  await pool.query(
    `INSERT INTO player_vehicle (id, owner_user_id, model_id, colour, plate, status, x, z, yaw, purchase_key, fuel_l)
     VALUES ($1, $2, $3, '#223344', $4, 'parked', $5, $6, 0, $7, 5)`,
    [vehicleId, driver.id, modelId, `FU-${randomUUID().slice(0, 6)}`, station.point[0], station.point[1], randomUUID()],
  );
  await pool.query(`DELETE FROM fuel_station WHERE id = $1`, [station.id]);
});
afterAll(async () => {
  await pool.query(`DELETE FROM fuel_station WHERE id = $1`, [station.id]);
  await pool.query(`DELETE FROM "user" WHERE id = ANY($1)`, [[driver.id, owner.id]]);
});

describe("fuel", () => {
  it("puts every station on walkable pavement and burns petrol with distance", () => {
    for (const site of FUEL_STATIONS) expect(walkable(site.point[0], site.point[1], 0.6), site.id).toBe(true);
    const model = getVehicleModel(modelId);
    expect(burnFuel(model, 10, 1_000)).toBeCloseTo(10 - fuelSpec(model).perKm);
    expect(burnFuel(model, 0.2, 10_000)).toBe(0);
  });

  it("needs you at the pumps, fills only what the tank holds, and charges the marketer's price", async () => {
    setPlayerPosition(driver.id, station.point[0] + 200, station.point[1], "street");
    await expect(buyFuel(driver.id, { stationId: station.id, vehicleId, litres: 10, price: FUEL.marketerPrice, idempotencyKey: randomUUID() })).rejects.toThrow(/Pull up/);
    setPlayerPosition(driver.id, station.point[0] + 2, station.point[1], "street");
    const tank = fuelSpec(getVehicleModel(modelId)).tank;
    const filled = await buyFuel(driver.id, { stationId: station.id, vehicleId, litres: 120, price: FUEL.marketerPrice, idempotencyKey: randomUUID() });
    expect(filled.litres).toBe(tank - 5);
    expect(await balance(driver.id)).toBe(START - (tank - 5) * FUEL.marketerPrice);
    await expect(buyFuel(driver.id, { stationId: station.id, vehicleId, litres: 5, price: FUEL.marketerPrice, idempotencyKey: randomUUID() })).rejects.toThrow(/full/);
  });

  it("lets a resident buy a station, set its price, and earn the margin on every litre", async () => {
    await buyStation(owner.id, station.id, randomUUID());
    await expect(buyStation(driver.id, station.id, randomUUID())).rejects.toThrow(/Another resident/);
    await expect(setStationPrice(driver.id, station.id, 1_200)).rejects.toThrow(/owner/);
    await setStationPrice(owner.id, station.id, 1_200);
    const view = (await fuelStations(owner.id)).find((entry) => entry.id === station.id)!;
    expect(view).toMatchObject({ price: 1_200, mine: true });
    await pool.query(`UPDATE player_vehicle SET fuel_l = 20 WHERE id = $1`, [vehicleId]);
    await expect(buyFuel(driver.id, { stationId: station.id, vehicleId, litres: 10, price: FUEL.marketerPrice, idempotencyKey: randomUUID() })).rejects.toThrow(/pump price/);
    const before = await balance(owner.id);
    await buyFuel(driver.id, { stationId: station.id, vehicleId, litres: 10, price: 1_200, idempotencyKey: randomUUID() });
    expect(await balance(owner.id)).toBe(before + 10 * (1_200 - FUEL.depotPrice));
    expect((await fuelStations(owner.id)).find((entry) => entry.id === station.id)).toMatchObject({ litresSold: 10, earned: 10 * (1_200 - FUEL.depotPrice) });
  });
});
