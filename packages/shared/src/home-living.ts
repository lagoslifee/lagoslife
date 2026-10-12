/**
 * Resting at home: sitting on a sofa, armchair or dining chair, or lying on the bed, restores energy while you stay put.
 * The server times the rest from when you sat down, so a rest only counts in the room you started it in.
 */
export const REST = {
  energyPerMinute: 10,
  /** Longest single rest that counts; stand up and sit again to keep resting. */
  maxMinutes: 10,
  /** Where resting counts: your starter room, a home you can enter, or your hotel room. */
  locations: /^(starter:|home:|hotel:)/,
} as const;

export type RestResult = { gained: number; hunger: number; energy: number };

/** Energy earned for a rest of `seconds`, before the 100 cap. */
export function restGain(seconds: number) {
  const counted = Math.max(0, Math.min(seconds, REST.maxMinutes * 60));
  return Math.floor((counted * REST.energyPerMinute) / 60);
}
