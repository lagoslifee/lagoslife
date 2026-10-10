import { z } from "zod";

/** Proximity chat. Messages reach players in the same place within `radius` metres and are kept for moderation. */
export const CHAT = {
  maxLength: 200,
  radius: 40,
  /** At most `burst` messages in any `burstWindowMs`, and never two closer than `minIntervalMs`. */
  burst: 5,
  burstWindowMs: 10_000,
  minIntervalMs: 700,
  retentionDays: 30,
} as const;

export const chatSendSchema = z.object({ text: z.string().trim().min(1).max(CHAT.maxLength) });

export const chatMessageSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  userName: z.string(),
  text: z.string(),
  at: z.number(),
  filtered: z.boolean(),
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;

const LEET: Record<string, string> = { "0": "o", "1": "i", "!": "i", "3": "e", "4": "a", "@": "a", "5": "s", "$": "s", "7": "t" };

/** Matched against whole words after lower-casing, undoing common letter swaps and collapsing repeated letters. */
const BLOCKED_WORDS = [
  "fuck", "fucker", "fucking", "fucked", "motherfucker", "shit", "shitty", "bullshit", "cunt", "bitch", "bitches",
  "bastard", "wanker", "twat", "dickhead", "asshole", "arsehole", "slut", "whore", "ashawo", "retard", "retarded",
  "faggot", "fag", "nigger", "nigga", "kike", "spic", "chink", "tranny", "rape", "rapist",
];
const collapse = (word: string) => word.replace(/(.)\1+/g, "$1");
const BLOCKED = new Set(BLOCKED_WORDS.map(collapse));

const URL_PATTERN = /\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(?:com|net|org|io|gg|ng|co|me|app|xyz|link|ly)\b\S*/gi;
const EMAIL_PATTERN = /\b[\w.+-]+@[\w-]+\.[\w.]+\b/g;
/** Seven or more digits, allowing spaces, dots and dashes between them (phone numbers, account numbers). */
const NUMBER_PATTERN = /(?:\+?\d[\s.-]?){7,}/g;

function normalise(token: string) {
  return collapse(
    [...token.toLowerCase().replace(/^[("'“‘]+|[.,!?;:)"'”’]+$/g, "")]
      .map((char) => LEET[char] ?? char)
      .join("")
      .replace(/[^a-z]/g, ""),
  );
}

/**
 * Masks blocked words and off-platform contact details (links, emails, long numbers) so players are not pushed
 * off the game. Returns whether anything was masked; the original text is stored server-side for moderators.
 */
export function filterChat(input: string): { text: string; filtered: boolean } {
  let filtered = false;
  const mask = (match: string) => {
    filtered = true;
    return "•".repeat(Math.min(8, Math.max(3, match.trim().length)));
  };
  let text = input.replace(/\s+/g, " ").trim();
  text = text.replace(EMAIL_PATTERN, mask).replace(URL_PATTERN, mask).replace(NUMBER_PATTERN, mask);
  text = text
    .split(" ")
    .map((token) => (BLOCKED.has(normalise(token)) ? mask(token) : token))
    .join(" ");
  return { text, filtered };
}

export const REPORT_REASONS = ["harassment", "hate", "sexual", "spam", "cheating", "impersonation", "other"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export const reportSchema = z.object({
  userName: z.string().min(1).max(40),
  reason: z.enum(REPORT_REASONS),
  details: z.string().trim().max(500).default(""),
  chatMessageId: z.uuid().optional(),
});

export const blockSchema = z.object({ userName: z.string().min(1).max(40) });

export const STAFF_ROLES = ["moderator", "admin"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const MODERATION_ACTIONS = ["warn", "mute", "suspend", "lift_mute", "lift_suspension"] as const;
export type ModerationActionKind = (typeof MODERATION_ACTIONS)[number];

export const moderationActionSchema = z
  .object({
    targetUserId: z.string().min(1).max(80),
    action: z.enum(MODERATION_ACTIONS),
    reason: z.string().trim().min(3).max(500),
    /** Mutes and suspensions only. Omit for a suspension with no end date. */
    durationHours: z.number().int().min(1).max(24 * 365).optional(),
    reportId: z.uuid().optional(),
  })
  .refine((value) => value.action !== "mute" || value.durationHours !== undefined, {
    message: "Mutes need a duration",
    path: ["durationHours"],
  });

export const resolveReportSchema = z.object({
  resolution: z.enum(["actioned", "dismissed"]),
  note: z.string().trim().min(3).max(500),
});

export const roleChangeSchema = z.object({
  userName: z.string().min(1).max(40),
  role: z.enum(STAFF_ROLES).nullable(),
  reason: z.string().trim().min(3).max(500),
});

export type SafetyStatus = {
  role: StaffRole | null;
  mutedUntil: string | null;
  blocked: Array<{ userId: string; userName: string }>;
  warnings: Array<{ id: string; reason: string; at: string }>;
};

/**
 * Fictional in-game law. Penalties are only ever game naira, are issued by the simulation (never by other
 * players), and can be appealed to a moderator. In-game law is separate from account moderation.
 */
export const JUSTICE = {
  /** Impacts at or above this speed while driving count as careless driving (50 km/h). */
  carelessDrivingSpeed: 13.9,
  carelessDrivingFine: 2_500,
  /** Only one citation per player in this window, however many impacts occur. */
  citationCooldownMs: 10 * 60_000,
  /** Appeals must be filed, and fines paid, within this window. Overdue fines block buying another vehicle. */
  dueHours: 72,
  authority: "Island Traffic Wardens (fictional)",
} as const;

export const OFFENCES = {
  careless_driving: {
    title: "Careless driving",
    description: "Collided with street furniture or a building at speed.",
    fine: JUSTICE.carelessDrivingFine,
  },
} as const;
export type OffenceId = keyof typeof OFFENCES;

export const CITATION_STATUSES = ["unpaid", "appealed", "paid", "overturned"] as const;
export type CitationStatus = (typeof CITATION_STATUSES)[number];

export type Citation = {
  id: string;
  offence: OffenceId;
  title: string;
  fine: number;
  status: CitationStatus;
  issuedAt: string;
  dueAt: string;
  /** Speed is the server's own measurement from accepted position updates, in m/s. */
  evidence: { x: number; z: number; speed: number; district: string | null };
  appeal: { statement: string; filedAt: string; outcome: "upheld" | "overturned" | null; note: string | null } | null;
  paidAt: string | null;
};

export const payCitationSchema = z.object({ idempotencyKey: z.string().min(8).max(100) });
export const appealCitationSchema = z.object({ statement: z.string().trim().min(10).max(800) });
export const decideAppealSchema = z.object({
  outcome: z.enum(["upheld", "overturned"]),
  note: z.string().trim().min(3).max(500),
});
