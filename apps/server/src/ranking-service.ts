import { rankBoard, type Holdings, type RankingBoard, type RankingState } from "@lagos-living/shared";
import { pool } from "./database.js";

type Resident = { id: string; username: string; holdings: Holdings };

const EARNINGS = ["job_reward", "community_wage", "business_income"];
const CACHE_MS = 30_000;
let cache: { at: number; residents: Promise<Resident[]> } | null = null;

/** Every resident with a username except staff, whose grants would top every board. */
async function loadResidents(only: string | null = null): Promise<Resident[]> {
  const { rows } = await pool.query<{
    id: string;
    username: string;
    balance: string | null;
    fitness: number | null;
    homes_value: string;
    cars: string[] | null;
    plot: "leased" | "owned" | null;
    design: string | null;
    stages_paid: number | null;
    invested: string;
    businesses: Array<{ type: string; level: number }> | null;
    earned: string;
  }>(
    `SELECT u.id, COALESCE(u."displayUsername", u.username) AS username, w.balance, p.fitness,
            (SELECT COALESCE(SUM(l.purchase_price), 0) FROM property_tenure t JOIN property_listing l ON l.id = t.property_id
              WHERE t.owner_user_id = u.id AND t.tenure_type = 'owned') AS homes_value,
            (SELECT array_agg(v.model_id) FROM player_vehicle v WHERE v.owner_user_id = u.id) AS cars,
            pt.tenure_type AS plot, c.design_id AS design, c.stages_paid,
            (SELECT COALESCE(SUM(i.invested), 0) FROM investment_holding i WHERE i.user_id = u.id) AS invested,
            (SELECT json_agg(json_build_object('type', b.type, 'level', b.level)) FROM player_business b WHERE b.user_id = u.id) AS businesses,
            (SELECT COALESCE(SUM(g.amount), 0) FROM game_transaction g
              WHERE g.user_id = u.id AND g.amount > 0 AND g.kind = ANY($1) AND g.created_at > NOW() - INTERVAL '7 days') AS earned
     FROM "user" u
     LEFT JOIN wallet w ON w.user_id = u.id
     LEFT JOIN player_profile p ON p.user_id = u.id
     LEFT JOIN plot_tenure pt ON pt.owner_user_id = u.id
     LEFT JOIN construction c ON c.plot_id = pt.plot_id
     WHERE u.username IS NOT NULL AND NOT EXISTS (SELECT 1 FROM staff_role s WHERE s.user_id = u.id)
       AND ($2::text IS NULL OR u.id = $2)`,
    [EARNINGS, only],
  );
  return rows.map((row) => ({
    id: row.id,
    username: row.username,
    holdings: {
      balance: Number(row.balance ?? 0),
      ownedHomesValue: Number(row.homes_value),
      carModels: row.cars ?? [],
      plot: row.plot,
      build: row.design ? { design: row.design, stagesPaid: row.stages_paid ?? 0 } : null,
      invested: Number(row.invested),
      businesses: row.businesses ?? [],
      fitness: Number(row.fitness ?? 0),
      earnedThisWeek: Number(row.earned),
    },
  }));
}

function residents() {
  if (!cache || Date.now() - cache.at > CACHE_MS) {
    const loading = loadResidents();
    cache = { at: Date.now(), residents: loading };
    loading.catch(() => {
      if (cache?.residents === loading) cache = null;
    });
  }
  return cache.residents;
}

export async function rankings(userId: string, board: RankingBoard): Promise<RankingState> {
  // The asking resident's own line is always fresh, so a sale or a payout moves their rank straight away.
  const [all, mine] = await Promise.all([residents(), loadResidents(userId)]);
  const others = all.filter((resident) => resident.id !== userId);
  return rankBoard(board, [...others, ...mine], userId);
}
