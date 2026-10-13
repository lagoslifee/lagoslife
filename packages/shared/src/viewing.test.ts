import { describe, expect, it } from "vitest";
import { BROADCAST, broadcastAt, broadcastFixture, broadcastResult, broadcastTime, VIEWING } from "./viewing.js";

const slotStart = 29_000_000 * VIEWING.matchMs;

describe("viewing centre broadcast", () => {
  it("shows the same moment to everyone and changes match every two minutes", () => {
    expect(broadcastAt(slotStart + 40_000)).toEqual(broadcastAt(slotStart + 40_000));
    expect(broadcastAt(slotStart + 1).slot + 1).toBe(broadcastAt(slotStart + VIEWING.matchMs).slot);
  });

  it("pairs clubs from the same competition and never a side against itself", () => {
    for (let slot = 0; slot < 300; slot += 1) {
      const { home, away, league } = broadcastFixture(slot);
      expect(home.id).not.toBe(away.id);
      expect(home.league).toBe(league);
      expect(away.league).toBe(league);
    }
  });

  it("runs walk-out, two halves, half-time and full-time on the slot clock", () => {
    expect(broadcastAt(slotStart + 1_000).phase).toBe("pre");
    expect(broadcastAt(slotStart + BROADCAST.intro + BROADCAST.half / 2).phase).toBe("first");
    expect(broadcastAt(slotStart + BROADCAST.intro + BROADCAST.half / 2).minute).toBeCloseTo(22.5);
    expect(broadcastAt(slotStart + BROADCAST.intro + BROADCAST.half + 1_000).phase).toBe("half");
    expect(broadcastAt(slotStart + broadcastTime(60)).phase).toBe("second");
    expect(broadcastAt(slotStart + VIEWING.matchMs - 1).phase).toBe("full");
    expect(BROADCAST.intro + 2 * BROADCAST.half + BROADCAST.interval + BROADCAST.outro).toBe(VIEWING.matchMs);
  });

  it("reveals goals only once their minute is played and ends on the full result", () => {
    let goals = 0;
    for (let slot = 29_000_000; slot < 29_000_060; slot += 1) {
      const start = slot * VIEWING.matchMs;
      const result = broadcastResult(slot);
      expect(broadcastAt(start + 1_000).score).toEqual({ home: 0, away: 0 });
      const end = broadcastAt(start + VIEWING.matchMs - 1);
      expect(end.score).toEqual({ home: result.home, away: result.away });
      for (const goal of result.goals) {
        expect(broadcastAt(start + broadcastTime(goal.minute)).goals).toContainEqual(goal);
        expect(broadcastAt(start + broadcastTime(goal.minute) - 50).goals.filter((seen) => seen.minute >= goal.minute)).toHaveLength(0);
      }
      goals += result.home + result.away;
    }
    // About two and a half goals a game, like real football.
    expect(goals / 60).toBeGreaterThan(1.5);
    expect(goals / 60).toBeLessThan(4);
  });
});
