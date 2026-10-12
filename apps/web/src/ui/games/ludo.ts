/**
 * Ludo rules on a standard 15×15 board. Each token's `progress` is -1 in its yard, 0..50 on the shared track
 * (counted from its own start square), 51..55 in its home column and 56 once it is home.
 */
export type Seat = 0 | 1 | 2 | 3;
export type LudoState = {
  players: Seat[];
  tokens: Record<Seat, number[]>;
  turn: number;
  dice: number | null;
  sixes: number;
  winner: Seat | null;
  log: string;
};

export const COLOURS: Record<Seat, { name: string; fill: string }> = {
  0: { name: "Red", fill: "#e2403a" },
  1: { name: "Green", fill: "#2fa84f" },
  2: { name: "Yellow", fill: "#f2c230" },
  3: { name: "Blue", fill: "#2f7ee0" },
};

export const HOME = 56;
const LAST_TRACK = 50;
export const SAFE = new Set([0, 8, 13, 21, 26, 34, 39, 47]);

/** Shared track squares as [column, row], clockwise from Red's start. */
export const TRACK: Array<[number, number]> = [
  ...[1, 2, 3, 4, 5].map((c) => [c, 6] as [number, number]),
  ...[5, 4, 3, 2, 1, 0].map((r) => [6, r] as [number, number]),
  [7, 0],
  ...[0, 1, 2, 3, 4, 5].map((r) => [8, r] as [number, number]),
  ...[9, 10, 11, 12, 13, 14].map((c) => [c, 6] as [number, number]),
  [14, 7],
  ...[14, 13, 12, 11, 10, 9].map((c) => [c, 8] as [number, number]),
  ...[9, 10, 11, 12, 13, 14].map((r) => [8, r] as [number, number]),
  [7, 14],
  ...[14, 13, 12, 11, 10, 9].map((r) => [6, r] as [number, number]),
  ...[5, 4, 3, 2, 1, 0].map((c) => [c, 8] as [number, number]),
  [0, 7],
  [0, 6],
];

/** Home columns, from the square after the track to the last one before the centre. */
export const HOME_COLUMN: Record<Seat, Array<[number, number]>> = {
  0: [1, 2, 3, 4, 5].map((c) => [c, 7]),
  1: [1, 2, 3, 4, 5].map((r) => [7, r]),
  2: [13, 12, 11, 10, 9].map((c) => [c, 7]),
  3: [13, 12, 11, 10, 9].map((r) => [7, r]),
};

export const YARD: Record<Seat, Array<[number, number]>> = {
  0: [[1.5, 1.5], [3.5, 1.5], [1.5, 3.5], [3.5, 3.5]],
  1: [[10.5, 1.5], [12.5, 1.5], [10.5, 3.5], [12.5, 3.5]],
  2: [[10.5, 10.5], [12.5, 10.5], [10.5, 12.5], [12.5, 12.5]],
  3: [[1.5, 10.5], [3.5, 10.5], [1.5, 12.5], [3.5, 12.5]],
};

export const startOf = (seat: Seat) => seat * 13;
export const absolute = (seat: Seat, progress: number) => (startOf(seat) + progress) % 52;

/** Board position of a token for drawing, as cell coordinates (centre of the cell is +0.5). */
export function cellOf(seat: Seat, progress: number, index: number): [number, number] {
  if (progress < 0) return YARD[seat][index]!;
  if (progress <= LAST_TRACK) return TRACK[absolute(seat, progress)]!;
  if (progress < HOME) return HOME_COLUMN[seat][progress - LAST_TRACK - 1]!;
  return ([[6.45, 7], [7, 6.45], [7.55, 7], [7, 7.55]] as Array<[number, number]>)[seat]!;
}

export function newGame(players: Seat[] = [0, 2]): LudoState {
  const tokens = { 0: [-1, -1, -1, -1], 1: [-1, -1, -1, -1], 2: [-1, -1, -1, -1], 3: [-1, -1, -1, -1] } as Record<Seat, number[]>;
  return { players, tokens, turn: 0, dice: null, sixes: 0, winner: null, log: "Roll a 6 to bring a token out." };
}

export const current = (state: LudoState) => state.players[state.turn]!;

/** Tokens the player whose turn it is may move with the rolled dice. */
export function movable(state: LudoState): number[] {
  if (state.dice === null || state.winner !== null) return [];
  const seat = current(state);
  return state.tokens[seat].flatMap((progress, index) => {
    if (progress === HOME) return [];
    if (progress < 0) return state.dice === 6 ? [index] : [];
    return progress + state.dice! <= HOME ? [index] : [];
  });
}

export function roll(state: LudoState, value: number): LudoState {
  if (state.dice !== null || state.winner !== null) return state;
  const next = { ...state, dice: value, sixes: value === 6 ? state.sixes + 1 : 0 };
  const name = COLOURS[current(state)].name;
  if (next.sixes === 3) return passTurn({ ...next, log: `${name} rolled three 6s in a row — turn lost.` });
  if (!movable(next).length) return passTurn({ ...next, log: `${name} rolled ${value}: no move.` });
  return { ...next, log: `${name} rolled ${value}.` };
}

function passTurn(state: LudoState): LudoState {
  return { ...state, dice: null, sixes: 0, turn: (state.turn + 1) % state.players.length };
}

export function move(state: LudoState, index: number): LudoState {
  if (!movable(state).includes(index)) return state;
  const seat = current(state);
  const dice = state.dice!;
  const tokens = Object.fromEntries(Object.entries(state.tokens).map(([key, list]) => [key, [...list]])) as Record<Seat, number[]>;
  const from = tokens[seat][index]!;
  const to = from < 0 ? 0 : from + dice;
  tokens[seat][index] = to;
  const name = COLOURS[seat].name;
  let log = from < 0 ? `${name} brought a token out.` : to === HOME ? `${name} got a token home!` : `${name} moved ${dice}.`;
  let captured = false;
  if (to <= LAST_TRACK && !SAFE.has(absolute(seat, to))) {
    for (const other of state.players) {
      if (other === seat) continue;
      tokens[other] = tokens[other].map((progress) => {
        if (progress >= 0 && progress <= LAST_TRACK && absolute(other, progress) === absolute(seat, to)) {
          captured = true;
          return -1;
        }
        return progress;
      });
    }
  }
  if (captured) log = `${name} captured a token and sent it home!`;
  const won = tokens[seat].every((progress) => progress === HOME);
  const next: LudoState = { ...state, tokens, log: won ? `${name} wins!` : log, winner: won ? seat : null };
  if (won) return { ...next, dice: null };
  return dice === 6 || captured || to === HOME ? { ...next, dice: null } : passTurn(next);
}

/** The computer's pick: capture, then get home, then leave the yard, then reach safety, else push the leader. */
export function bestMove(state: LudoState): number | null {
  const options = movable(state);
  if (!options.length) return null;
  const seat = current(state);
  const dice = state.dice!;
  const score = (index: number) => {
    const from = state.tokens[seat][index]!;
    const to = from < 0 ? 0 : from + dice;
    let value = to / 10;
    if (to === HOME) value += 50;
    if (from < 0) value += 30;
    if (to <= LAST_TRACK) {
      const square = absolute(seat, to);
      const hits = state.players.some((other) => other !== seat && state.tokens[other].some((p) => p >= 0 && p <= LAST_TRACK && absolute(other, p) === square));
      if (hits && !SAFE.has(square)) value += 80;
      if (SAFE.has(square)) value += 12;
    }
    if (to > LAST_TRACK) value += 15;
    return value;
  };
  return options.sort((a, b) => score(b) - score(a))[0]!;
}
