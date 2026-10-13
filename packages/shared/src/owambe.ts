import { z } from "zod";
import { hash01 } from "./viewing.js";
import type { Vec2 } from "./world.js";

/** The marquee on the open ground off Kayode Animashaun: `yaw` 0 puts the high table at the +z end. */
export const OWAMBE_GROUND = { id: "kayode-grounds", name: "Kayode Event Ground", centre: [-32, 376] as Vec2, width: 24, depth: 19 } as const;

export const OWAMBE_KINDS = ["wedding", "birthday", "burial"] as const;
export type OwambeKind = (typeof OWAMBE_KINDS)[number];

/** Each party has its aso-ebi: the colour every guest's gele, sash and chair bow is tied in. */
export const OWAMBE_STYLE: Record<OwambeKind, { label: string; emoji: string; asoEbi: string; trim: string; banner: (celebrant: string) => string }> = {
  wedding: { label: "Wedding", emoji: "💍", asoEbi: "#c2185b", trim: "#f3c969", banner: (name) => `${name} · Wedding Reception` },
  birthday: { label: "Birthday", emoji: "🎂", asoEbi: "#1f6fb2", trim: "#f3c969", banner: (name) => `Happy Birthday ${name}` },
  burial: { label: "Celebration of life", emoji: "🕊️", asoEbi: "#5b2a86", trim: "#e9e4f0", banner: (name) => `Celebrating the life of ${name}` },
};

export const OWAMBE = {
  /** How long a party runs, hosted or not. */
  partyMs: 30 * 60_000,
  /** Catering, canopy, DJ and MC for a party a resident hosts; guests eat for free. */
  hostPrice: { wedding: 450_000, birthday: 250_000, burial: 300_000 } satisfies Record<OwambeKind, number>,
  /** One plate per guest in this long. */
  plateEveryMs: 3 * 60_000,
  /** Eating a plate takes this long at the table. */
  eatMs: 22_000,
  /** What a full plate does for you. */
  hunger: 30,
  energy: 5,
  seatReach: 2.5,
  range: 30,
} as const;

export const OWAMBE_MENU = [
  { id: "jollof", name: "Party jollof, fried plantain & chicken", emoji: "🍛", hand: false },
  { id: "amala", name: "Amala, ewedu & gbegiri with assorted meat", emoji: "🥘", hand: true },
  { id: "pounded-yam", name: "Pounded yam & egusi soup", emoji: "🍲", hand: true },
  { id: "fried-rice", name: "Fried rice, moi moi & turkey", emoji: "🍚", hand: false },
  { id: "small-chops", name: "Small chops: puff-puff, samosa, spring rolls", emoji: "🥟", hand: true },
] as const;
export type OwambeDish = (typeof OWAMBE_MENU)[number]["id"];
export const owambeDish = (id: string) => OWAMBE_MENU.find((dish) => dish.id === id);

/** Round tables of eight in two rows of three, facing the high table across the dance floor. */
export const OWAMBE_TABLE_SEATS = 8;
export function owambeTables() {
  const [cx, cz] = OWAMBE_GROUND.centre;
  const tables: Array<{ no: number; at: Vec2; seats: Array<{ at: Vec2; yaw: number }> }> = [];
  for (const [row, z] of [-6.2, -2.4].entries()) {
    for (const [column, x] of [-7, 0, 7].entries()) {
      const at: Vec2 = [cx + x, cz + z];
      const seats = Array.from({ length: OWAMBE_TABLE_SEATS }, (_, index) => {
        const turn = (index / OWAMBE_TABLE_SEATS) * Math.PI * 2 + Math.PI / OWAMBE_TABLE_SEATS;
        // Chairs ring the table, each facing its centre.
        return { at: [at[0] + Math.sin(turn) * 1.35, at[1] + Math.cos(turn) * 1.35] as Vec2, yaw: turn + Math.PI };
      });
      tables.push({ no: row * 3 + column, at, seats });
    }
  }
  return tables;
}
export const OWAMBE_HIGH_TABLE: Vec2 = [OWAMBE_GROUND.centre[0], OWAMBE_GROUND.centre[1] + 7.2];
export const OWAMBE_KITCHEN: Vec2 = [OWAMBE_GROUND.centre[0] + 13.5, OWAMBE_GROUND.centre[1] - 6];

export type OwambeParty = {
  kind: OwambeKind;
  celebrant: string;
  /** The resident hosting it, or null for a party the neighbourhood throws. */
  host: string | null;
  startsAt: number;
  endsAt: number;
};

const CELEBRANTS: Record<OwambeKind, string[]> = {
  wedding: ["Tolu & Kunle", "Ada & Emeka", "Funke & Segun", "Zainab & Musa", "Chioma & Bayo", "Ronke & Femi"],
  birthday: ["Chief (Mrs) Bisi Adeyemi at 60", "Alhaji Rasaki Bello at 70", "Mama Nkechi at 80", "Engr. Dapo Coker at 50", "Iya Basira at 65"],
  burial: ["Pa Emmanuel Okafor (1938–2026)", "Mama Comfort Ojo (1941–2026)", "Chief Lamidi Ayinde (1935–2026)", "Madam Grace Eze (1944–2026)"],
};

/** The neighbourhood's own party in this half hour when no resident has booked the ground. */
export function neighbourhoodParty(now: number): OwambeParty {
  const slot = Math.floor(now / OWAMBE.partyMs);
  const kind = OWAMBE_KINDS[Math.floor(hash01(`owambe:${slot}:kind`) * OWAMBE_KINDS.length)]!;
  const names = CELEBRANTS[kind];
  const celebrant = names[Math.floor(hash01(`owambe:${slot}:name`) * names.length)]!;
  return { kind, celebrant, host: null, startsAt: slot * OWAMBE.partyMs, endsAt: (slot + 1) * OWAMBE.partyMs };
}

export const owambeHostSchema = z.object({
  kind: z.enum(OWAMBE_KINDS),
  celebrant: z.string().trim().min(2).max(40),
  idempotencyKey: z.string().uuid(),
});
export const owambeOrderSchema = z.object({
  table: z.number().int().min(0).max(5),
  seat: z.number().int().min(0).max(OWAMBE_TABLE_SEATS - 1),
  dish: z.enum(OWAMBE_MENU.map((dish) => dish.id) as [OwambeDish, ...OwambeDish[]]),
});

/** The seat at a table, or null when the numbers don't name one. */
export function owambeSeat(table: number, seat: number) {
  return owambeTables()[table]?.seats[seat] ?? null;
}
