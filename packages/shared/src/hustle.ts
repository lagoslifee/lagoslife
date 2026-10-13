/**
 * Eko Hustle Fund (fictional): a starter loan in game naira so a new resident can open a business on day one instead
 * of grinding deliveries, and a storyline of chapters that pay a bonus as their life grows. Game roleplay only.
 */
export const HUSTLE_FUND = {
  name: "Eko Hustle Fund",
  /** Flat fee on the amount borrowed, added once when the loan is paid out. */
  interestRate: 0.1,
  minLoan: 50_000,
  firstLimit: 500_000,
  maxLimit: 5_000_000,
  /** Share of every business collection that goes to the loan while one is open. */
  takingsShare: 0.3,
  /** After this the share rises to `overdueShare`; nothing else happens and balances never go negative. */
  termDays: 7,
  overdueShare: 0.5,
} as const;

/** Each loan paid off doubles the next limit: ₦500k, ₦1M, ₦2M, ₦4M, then ₦5M. */
export const loanLimit = (repaid: number) => Math.min(HUSTLE_FUND.maxLimit, HUSTLE_FUND.firstLimit * 2 ** Math.max(0, repaid));
export const loanOwed = (principal: number) => Math.round(principal * (1 + HUSTLE_FUND.interestRate));
export const takingsShare = (overdue: boolean) => (overdue ? HUSTLE_FUND.overdueShare : HUSTLE_FUND.takingsShare);

export type StoryFacts = {
  businesses: number;
  takings: number;
  loansRepaid: number;
  cars: number;
  homes: number;
  balance: number;
};

export type StoryChapterId = "fresh" | "hustler" | "clean-slate" | "moving" | "landlord" | "big-boss";

export const STORY_CHAPTERS: readonly {
  id: StoryChapterId;
  title: string;
  story: string;
  goal: string;
  reward: number;
  done: (facts: StoryFacts) => boolean;
}[] = [
  {
    id: "fresh",
    title: "Fresh in Lagos",
    story: "You stepped off the bus at Kayode Animashaun Street with one bag and big dreams. Uncle Tunde says every big man in Lekki started with one small hustle.",
    goal: "Open your first business. Short of cash? Borrow from the Eko Hustle Fund.",
    reward: 25_000,
    done: (facts) => facts.businesses >= 1,
  },
  {
    id: "hustler",
    title: "The hustle is real",
    story: "Customers are coming. Keep the shop running and collect what it makes before the till fills up.",
    goal: "Collect ₦100,000 in business takings.",
    reward: 50_000,
    done: (facts) => facts.takings >= 100_000,
  },
  {
    id: "clean-slate",
    title: "Clean slate",
    story: "A Lagosian's word is their bond. Pay back the Hustle Fund and they'll trust you with double next time.",
    goal: "Pay off a Hustle Fund loan.",
    reward: 75_000,
    done: (facts) => facts.loansRepaid >= 1,
  },
  {
    id: "moving",
    title: "Moving up",
    story: "No more waiting for danfo in the rain. Lekki Motors has something with your name on it.",
    goal: "Buy your first car.",
    reward: 100_000,
    done: (facts) => facts.cars >= 1,
  },
  {
    id: "landlord",
    title: "Your own roof",
    story: "Rent is for the beginning. Buy a house or a plot of land and put down roots.",
    goal: "Own a home or a plot.",
    reward: 250_000,
    done: (facts) => facts.homes >= 1,
  },
  {
    id: "big-boss",
    title: "Oga at the top",
    story: "From one bag to the big leagues. Lagos knows your name now.",
    goal: "Hold ₦10,000,000 in your wallet.",
    reward: 1_000_000,
    done: (facts) => facts.balance >= 10_000_000,
  },
];

export type HustleStatus = {
  loan: null | { id: string; principal: number; owed: number; remaining: number; dueAt: string; overdue: boolean; share: number };
  limit: number;
  loansRepaid: number;
  chapters: { id: StoryChapterId; title: string; story: string; goal: string; reward: number; done: boolean; claimed: boolean }[];
};
