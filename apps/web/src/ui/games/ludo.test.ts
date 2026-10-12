import { describe, expect, it } from "vitest";
import { HOME, TRACK, bestMove, move, movable, newGame, roll, type LudoState } from "./ludo";

describe("ludo", () => {
  it("has a closed 52-square track of distinct cells", () => {
    expect(TRACK).toHaveLength(52);
    expect(new Set(TRACK.map(([c, r]) => `${c},${r}`)).size).toBe(52);
    for (let index = 0; index < 52; index += 1) {
      const [a, b] = [TRACK[index]!, TRACK[(index + 1) % 52]!];
      expect(Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1])).toBeLessThanOrEqual(2);
    }
  });

  it("needs a 6 to leave the yard and gives another roll for it", () => {
    let state = roll(newGame(), 4);
    expect(state.turn).toBe(1);
    state = roll({ ...state, turn: 0 }, 6);
    expect(movable(state)).toEqual([0, 1, 2, 3]);
    state = move(state, 0);
    expect(state.tokens[0][0]).toBe(0);
    expect(state.turn).toBe(0);
    expect(state.dice).toBeNull();
  });

  it("captures an opponent on a plain square and sends it back to the yard", () => {
    const state: LudoState = { ...newGame(), dice: 3 };
    state.tokens[0] = [2, -1, -1, -1];
    state.tokens[2] = [31, -1, -1, -1];
    const next = move(state, 0);
    expect(next.tokens[2][0]).toBe(-1);
    expect(next.turn).toBe(0);
  });

  it("does not capture on a safe square", () => {
    const state: LudoState = { ...newGame(), dice: 3 };
    state.tokens[0] = [5, -1, -1, -1];
    state.tokens[2] = [34, -1, -1, -1];
    expect(move(state, 0).tokens[2][0]).toBe(34);
  });

  it("needs an exact roll to get home and declares the winner", () => {
    const state: LudoState = { ...newGame(), dice: 4 };
    state.tokens[0] = [HOME, HOME, HOME, 53];
    expect(movable(state)).toEqual([]);
    const exact = move({ ...state, dice: 3 }, 3);
    expect(exact.winner).toBe(0);
  });

  it("the computer prefers a capture", () => {
    const state: LudoState = { ...newGame(), turn: 1, dice: 2 };
    state.tokens[2] = [10, 20, -1, -1];
    state.tokens[0] = [38, -1, -1, -1];
    expect(bestMove(state)).toBe(0);
  });
});
