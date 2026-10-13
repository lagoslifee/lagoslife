import {
  DEFAULT_FINISH,
  EXTERIOR_PAINTS,
  finishPrice,
  FLOOR_FINISHES,
  homeLayout,
  INTERIOR_STYLES,
  listingTemplateId,
  type FloorFinishId,
  type HomeFinish,
} from "@lagos-living/shared";
import { pool } from "./database.js";
import { debitWallet, EconomyError, withTransaction } from "./economy-service.js";
import { homeEvents } from "./home-events.js";
import { requirePropertyAccess } from "./property-service.js";

const DECORATOR = "Ankara & Oak Decorators";

export async function getFinish(propertyId: string): Promise<HomeFinish> {
  const row = await pool.query(`SELECT style, floor, exterior FROM home_finish WHERE property_id = $1`, [propertyId]);
  return row.rows[0] ?? DEFAULT_FINISH;
}

/** Exterior paint of every built house, by home id, for drawing the street. */
export async function exteriorPaints(homeIds: string[]): Promise<Map<string, string>> {
  if (!homeIds.length) return new Map();
  const rows = await pool.query<{ property_id: string; exterior: string }>(
    `SELECT property_id, exterior FROM home_finish WHERE property_id = ANY($1) AND exterior IS NOT NULL`,
    [homeIds],
  );
  return new Map(rows.rows.map((row) => [row.property_id, row.exterior]));
}

/**
 * Restyles, refloors or repaints a home for the decorators' price of each part that changes. Only the owner can, and
 * only houses residents built have an outside of their own to paint.
 */
export async function setFinish(
  userId: string,
  propertyId: string,
  input: { style?: string | undefined; floor?: FloorFinishId | undefined; exterior?: string | undefined; idempotencyKey: string },
) {
  const access = await requirePropertyAccess(userId, propertyId);
  if (!access.owner) throw new EconomyError("Only the owner can redecorate this home.", 403);
  if (input.style !== undefined && !INTERIOR_STYLES.some((style) => style.id === input.style)) throw new EconomyError("Pick one of the decorators' styles.");
  if (input.floor !== undefined && !FLOOR_FINISHES.some((floor) => floor.id === input.floor)) throw new EconomyError("Pick one of the floors.");
  if (input.exterior !== undefined) {
    if (!EXTERIOR_PAINTS.some((paint) => paint.id === input.exterior)) throw new EconomyError("Pick one of the paints.");
    if (!listingTemplateId(propertyId).startsWith("built-")) throw new EconomyError("The outside of this building belongs to the estate. Build your own house to paint it.", 409);
  }
  const tier = homeLayout(propertyId).tier;
  const result = await withTransaction(async (client) => {
    const replay = await client.query(`SELECT balance_after FROM game_transaction WHERE user_id = $1 AND idempotency_key = $2`, [userId, input.idempotencyKey]);
    const current: HomeFinish = (await client.query(`SELECT style, floor, exterior FROM home_finish WHERE property_id = $1 FOR UPDATE`, [propertyId])).rows[0] ?? DEFAULT_FINISH;
    const next: HomeFinish = {
      // A new style brings its own floor, unless a floor is chosen with it.
      style: input.style ?? current.style,
      floor: input.floor ?? (input.style !== undefined ? null : current.floor),
      exterior: input.exterior ?? current.exterior,
    };
    if (replay.rowCount) return { finish: current, balance: Number(replay.rows[0].balance_after), cost: 0 };
    const parts = ([
      ["style", input.style !== undefined && input.style !== current.style, "restyle"],
      ["floor", input.floor !== undefined && input.floor !== current.floor, "new floor"],
      ["exterior", input.exterior !== undefined && input.exterior !== current.exterior, "outside paint"],
    ] as const).filter(([, changed]) => changed);
    if (!parts.length) throw new EconomyError("That is already how your home looks.", 409);
    const cost = parts.reduce((sum, [part]) => sum + finishPrice(part, tier), 0);
    const balance = await debitWallet(client, userId, cost, "home_decor", `${DECORATOR} · ${parts.map(([, , label]) => label).join(", ")}`, input.idempotencyKey, { propertyId });
    await client.query(
      `INSERT INTO home_finish (property_id, style, floor, exterior, updated_at) VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (property_id) DO UPDATE SET style = EXCLUDED.style, floor = EXCLUDED.floor, exterior = EXCLUDED.exterior, updated_at = NOW()`,
      [propertyId, next.style, next.floor, next.exterior],
    );
    return { finish: next, balance, cost };
  });
  if (result.cost) homeEvents.emit("furniture", propertyId);
  return result;
}
