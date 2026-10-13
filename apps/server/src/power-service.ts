import { cutMinutes, DIESEL, generatorModel, NEPA, nepaAt, type GeneratorId, type HomePower } from "@lagos-living/shared";
import type { PoolClient } from "pg";
import { pool } from "./database.js";
import { debitWallet, EconomyError, withTransaction } from "./economy-service.js";
import { requirePropertyAccess } from "./property-service.js";

type Row = { generator: GeneratorId; litres: string; running: boolean; auto_diesel: boolean; settled_at: Date; last_seen_at: Date };

function view(propertyId: string, row: Row | undefined, now: number): HomePower {
  const grid = nepaAt(propertyId, now);
  const model = generatorModel(row?.generator);
  const litres = row ? Math.max(0, Number(row.litres)) : 0;
  const generating = Boolean(model && row?.running && litres > 0 && !grid.on);
  return {
    nepa: grid.on,
    changesAt: new Date(grid.changesAt).toISOString(),
    generator: model?.id ?? null,
    litres: Math.round(litres * 10) / 10,
    tank: model?.tank ?? 0,
    running: Boolean(row?.running),
    autoDiesel: Boolean(row?.auto_diesel),
    lit: grid.on || generating,
    source: grid.on ? "nepa" : generating ? "generator" : "none",
  };
}

/**
 * Burns the diesel the generator used through cuts since it was last settled (only while someone was home, give or
 * take the gateman's grace), then lets the standing order top the tank up if the owner can pay for it.
 */
async function settle(client: PoolClient, propertyId: string, now: number, seen: boolean) {
  const { rows } = await client.query<Row>(`SELECT * FROM home_power WHERE property_id = $1 FOR UPDATE`, [propertyId]);
  const row = rows[0];
  if (!row) return undefined;
  const model = generatorModel(row.generator)!;
  const until = Math.min(now, row.last_seen_at.getTime() + NEPA.gatemanOffMinutes * 60_000);
  const burned = row.running ? cutMinutes(propertyId, row.settled_at.getTime(), until) * model.burnPerMinute : 0;
  let litres = Math.max(0, Number(row.litres) - burned);
  if (row.auto_diesel && litres < model.tank * DIESEL.refillBelow) {
    const top = Math.floor(model.tank - litres);
    const cost = top * DIESEL.pricePerLitre;
    const owner = await client.query<{ owner_user_id: string; balance: string | null }>(
      `SELECT tenure.owner_user_id, wallet.balance FROM property_tenure tenure LEFT JOIN wallet ON wallet.user_id = tenure.owner_user_id
       WHERE tenure.property_id = $1 AND (tenure.expires_at IS NULL OR tenure.expires_at > NOW())`,
      [propertyId],
    );
    const payer = owner.rows[0];
    if (top > 0 && payer && Number(payer.balance ?? 0) >= cost) {
      await debitWallet(client, payer.owner_user_id, cost, "diesel_purchase", `${DIESEL.supplier} · ${top} L standing order`, `diesel-auto:${propertyId}:${Math.floor(now / 60_000)}`, { propertyId, litres: top });
      litres += top;
    }
  }
  const next = await client.query<Row>(
    `UPDATE home_power SET litres = $2, settled_at = to_timestamp($3 / 1000.0), last_seen_at = CASE WHEN $4 THEN to_timestamp($3 / 1000.0) ELSE last_seen_at END,
       updated_at = NOW() WHERE property_id = $1 RETURNING *`,
    [propertyId, litres.toFixed(2), now, seen],
  );
  return next.rows[0];
}

/** NEPA and the generator at a home. Asking from inside counts as someone being home. */
export async function homePower(userId: string, propertyId: string, home = false) {
  await requirePropertyAccess(userId, propertyId);
  const now = Date.now();
  const row = await withTransaction((client) => settle(client, propertyId, now, home));
  return view(propertyId, row, now);
}

export async function buyGenerator(userId: string, propertyId: string, input: { model: GeneratorId; idempotencyKey: string }) {
  const access = await requirePropertyAccess(userId, propertyId);
  if (!access.owner) throw new EconomyError("Only the owner can install a generator.", 403);
  const model = generatorModel(input.model)!;
  const now = Date.now();
  return withTransaction(async (client) => {
    const current = await client.query<Row>(`SELECT * FROM home_power WHERE property_id = $1 FOR UPDATE`, [propertyId]);
    if (current.rows[0]?.generator === model.id) throw new EconomyError(`The ${model.name} is already installed.`, 409);
    const balance = await debitWallet(client, userId, model.price, "generator_purchase", `${model.name} · installed with 10 L`, input.idempotencyKey, { propertyId, model: model.id });
    // The installers leave a little diesel in a new tank; an old generator's diesel is drained with it.
    const row = await client.query<Row>(
      `INSERT INTO home_power (property_id, generator, litres, running, settled_at, last_seen_at) VALUES ($1, $2, 10, TRUE, to_timestamp($3 / 1000.0), to_timestamp($3 / 1000.0))
       ON CONFLICT (property_id) DO UPDATE SET generator = EXCLUDED.generator, litres = 10, settled_at = EXCLUDED.settled_at, updated_at = NOW()
       RETURNING *`,
      [propertyId, model.id, now],
    );
    return { balance, power: view(propertyId, row.rows[0], now) };
  });
}

export async function buyDiesel(userId: string, propertyId: string, input: { litres: number; idempotencyKey: string }) {
  await requirePropertyAccess(userId, propertyId);
  const now = Date.now();
  return withTransaction(async (client) => {
    const row = await settle(client, propertyId, now, true);
    if (!row) throw new EconomyError("Install a generator first.", 409);
    const model = generatorModel(row.generator)!;
    const litres = Math.min(input.litres, Math.floor(model.tank - Number(row.litres)));
    if (litres <= 0) throw new EconomyError("The tank is already full.", 409);
    const balance = await debitWallet(client, userId, litres * DIESEL.pricePerLitre, "diesel_purchase", `${DIESEL.supplier} · ${litres} L delivered`, input.idempotencyKey, { propertyId, litres });
    const next = await client.query<Row>(`UPDATE home_power SET litres = litres + $2, updated_at = NOW() WHERE property_id = $1 RETURNING *`, [propertyId, litres]);
    return { balance, litres, power: view(propertyId, next.rows[0], now) };
  });
}

export async function switchGenerator(userId: string, propertyId: string, input: { running?: boolean | undefined; autoDiesel?: boolean | undefined }) {
  const access = await requirePropertyAccess(userId, propertyId);
  if (input.autoDiesel !== undefined && !access.owner) throw new EconomyError("Only the owner can set up a diesel standing order.", 403);
  const now = Date.now();
  return withTransaction(async (client) => {
    if (!(await settle(client, propertyId, now, true))) throw new EconomyError("Install a generator first.", 409);
    const next = await client.query<Row>(
      `UPDATE home_power SET running = COALESCE($2, running), auto_diesel = COALESCE($3, auto_diesel), updated_at = NOW() WHERE property_id = $1 RETURNING *`,
      [propertyId, input.running ?? null, input.autoDiesel ?? null],
    );
    const row = input.autoDiesel ? await settle(client, propertyId, now, true) : next.rows[0];
    return { power: view(propertyId, row, now) };
  });
}

/** Lets a test wind the generator back as if someone had been home for the last `minutes`. */
export async function agePower(propertyId: string, minutes: number) {
  await pool.query(`UPDATE home_power SET settled_at = settled_at - make_interval(mins => $2) WHERE property_id = $1`, [propertyId, minutes]);
}
