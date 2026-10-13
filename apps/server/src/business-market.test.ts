import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { brokerOffer, BUSINESS_TYPES, saleProceeds } from "@lagos-living/shared";

const { pool } = await import("./database.js");
const { businessMarket, businessStatus, buyBusiness, listBusiness, sellToBroker, startBusiness } = await import("./business-service.js");

const makeUser = (tag: string) => ({ id: `${tag}-${randomUUID()}`, username: `${tag}${randomUUID().replaceAll("-", "").slice(0, 12)}` });
const seller = makeUser("seller");
const buyer = makeUser("buyer");
const START = 5_000_000;
const balance = async (userId: string) => Number((await pool.query(`SELECT balance FROM wallet WHERE user_id = $1`, [userId])).rows[0].balance);

beforeAll(async () => {
  for (const [user, name] of [[seller, "Seller Test"], [buyer, "Buyer Test"]] as const) {
    await pool.query(
      `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt", username, "displayUsername") VALUES ($1, $2, $3, FALSE, NOW(), NOW(), $4, $4)`,
      [user.id, name, `${user.username}@example.test`, user.username],
    );
    await pool.query(`INSERT INTO wallet (user_id, balance) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET balance = $2`, [user.id, START]);
  }
});
afterAll(async () => {
  await pool.query(`DELETE FROM "user" WHERE id = ANY($1)`, [[seller.id, buyer.id]]);
});

describe("business market", () => {
  it("lists a business, sells it once to one buyer at the listed price, and pays the seller less the agent fee", async () => {
    await startBusiness(seller.id, "pos-kiosk", "Corner POS", randomUUID());
    const kiosk = (await businessStatus(seller.id)).businesses[0]!;
    await listBusiness(seller.id, kiosk.id, 400_000);
    const listing = (await businessMarket(buyer.id)).find((entry) => entry.id === kiosk.id);
    expect(listing).toMatchObject({ price: 400_000, seller: "Seller Test", mine: false });
    await expect(buyBusiness(buyer.id, kiosk.id, 300_000, randomUUID())).rejects.toThrow(/price changed/);
    const sellerBefore = await balance(seller.id);
    const key = randomUUID();
    const results = await Promise.allSettled([buyBusiness(buyer.id, kiosk.id, 400_000, key), buyBusiness(buyer.id, kiosk.id, 400_000, key)]);
    expect(results.every((result) => result.status === "fulfilled")).toBe(true);
    expect(await balance(buyer.id)).toBe(START - 400_000);
    expect(await balance(seller.id)).toBe(sellerBefore + saleProceeds(400_000));
    expect((await businessStatus(buyer.id)).businesses.map((entry) => entry.id)).toEqual([kiosk.id]);
    expect((await businessStatus(seller.id)).businesses).toHaveLength(0);
    expect((await businessMarket(buyer.id)).some((entry) => entry.id === kiosk.id)).toBe(false);
  });

  it("refuses your own listing and a second business of a type you already run", async () => {
    await startBusiness(seller.id, "pos-kiosk", "Another POS", randomUUID());
    const kiosk = (await businessStatus(seller.id)).businesses[0]!;
    await listBusiness(seller.id, kiosk.id, 250_000);
    await expect(buyBusiness(seller.id, kiosk.id, 250_000, randomUUID())).rejects.toThrow(/your own/);
    await expect(buyBusiness(buyer.id, kiosk.id, 250_000, randomUUID())).rejects.toThrow(/already run/);
    await listBusiness(seller.id, kiosk.id, null);
    expect((await businessMarket(buyer.id)).some((entry) => entry.id === kiosk.id)).toBe(false);
  });

  it("sells to the brokers for half of the start-up cost", async () => {
    const kiosk = (await businessStatus(seller.id)).businesses[0]!;
    const before = await balance(seller.id);
    await sellToBroker(seller.id, kiosk.id, randomUUID());
    expect(await balance(seller.id)).toBeGreaterThanOrEqual(before + brokerOffer("pos-kiosk", 1));
    expect(brokerOffer("pos-kiosk", 1)).toBe(BUSINESS_TYPES["pos-kiosk"].cost / 2);
    expect((await businessStatus(seller.id)).businesses).toHaveLength(0);
  });
});
