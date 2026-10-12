import { z } from "zod";

/** Sign-up without an email gets an address on this domain, so the account works but no mail is ever sent to it. */
export const NO_EMAIL_DOMAIN = "no-email.naijaworld.local";
export const GUEST_EMAIL_DOMAIN = "guest.lagosliving.local";

export const isPlaceholderEmail = (email: string) => email.endsWith(`@${NO_EMAIL_DOMAIN}`) || email.endsWith(`@${GUEST_EMAIL_DOMAIN}`);
export const isGuestEmail = (email: string) => email.endsWith(`@${GUEST_EMAIL_DOMAIN}`);

export const PASSWORD_MIN = 10;
/** Same rule as the sign-in username plugin: 3–20 letters, numbers, underscores or dots. */
export const usernameSchema = z.string().trim().min(3).max(20).regex(/^[a-zA-Z0-9_.]+$/, "Use letters, numbers, _ or . only");

export const claimAccountSchema = z.object({
  username: usernameSchema,
  name: z.string().trim().min(1).max(40),
  password: z.string().min(PASSWORD_MIN).max(128),
  email: z.string().trim().email().max(120).optional(),
});
export type ClaimAccount = z.infer<typeof claimAccountSchema>;

export type AccountSummary = { guest: boolean; username: string; name: string; email: string | null };

export const LIFE_GOALS = [
  { id: "mansion", emoji: "🏰", label: "Own a mansion in Ikoyi or Banana Island" },
  { id: "supercar", emoji: "🏎️", label: "Drive a supercar" },
  { id: "business", emoji: "💼", label: "Run my own business" },
  { id: "rich", emoji: "💰", label: "Become a billionaire" },
  { id: "fit", emoji: "💪", label: "Get in the best shape of my life" },
  { id: "nightlife", emoji: "🍾", label: "Be a VIP at the top clubs" },
  { id: "travel", emoji: "✈️", label: "Travel to Dubai and beyond" },
  { id: "friends", emoji: "🤝", label: "Make friends and build a crew" },
  { id: "family", emoji: "🏡", label: "Build a home for my family" },
  { id: "community", emoji: "🙌", label: "Give back to my community" },
] as const;
export const INTERESTS = [
  { id: "cars", emoji: "🚗", label: "Cars" },
  { id: "property", emoji: "🏘️", label: "Property" },
  { id: "fashion", emoji: "👗", label: "Fashion" },
  { id: "music", emoji: "🎧", label: "Music & clubs" },
  { id: "fitness", emoji: "🏋️", label: "Fitness" },
  { id: "food", emoji: "🍲", label: "Food" },
  { id: "money", emoji: "📈", label: "Money & trading" },
  { id: "travel", emoji: "🌍", label: "Travel" },
  { id: "football", emoji: "⚽", label: "Football" },
  { id: "tech", emoji: "💻", label: "Tech" },
] as const;
export const PLAYSTYLES = [
  { id: "hustle", emoji: "🔥", label: "Hustler", blurb: "Work, earn, grow the money" },
  { id: "social", emoji: "🎉", label: "Social", blurb: "Meet people, go out, chat" },
  { id: "explore", emoji: "🧭", label: "Explorer", blurb: "See every corner of the city" },
  { id: "chill", emoji: "🌴", label: "Chill", blurb: "Take it easy, enjoy the life" },
] as const;

const ids = <T extends readonly { id: string }[]>(list: T) => list.map((entry) => entry.id) as [T[number]["id"], ...T[number]["id"][]];
export const lifeGoalsSchema = z.object({
  goals: z.array(z.enum(ids(LIFE_GOALS))).max(LIFE_GOALS.length),
  interests: z.array(z.enum(ids(INTERESTS))).max(INTERESTS.length),
  playstyle: z.enum(ids(PLAYSTYLES)).nullable(),
  dream: z.string().trim().max(280),
  /** "Maybe later": stops the welcome asking again without saving answers. */
  skipped: z.boolean().default(false),
});
export type LifeGoals = z.infer<typeof lifeGoalsSchema>;
