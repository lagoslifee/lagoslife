export interface AdaptiveQualityOptions {
  windowMs: number;
  slowMs: number;
  fastMs: number;
  slowWindows: number;
  fastWindows: number;
  cooldownMs: number;
  maxLevel: number;
}

export const ADAPTIVE_DEFAULTS: AdaptiveQualityOptions = {
  windowMs: 2000,
  slowMs: 33,
  fastMs: 20,
  slowWindows: 2,
  fastWindows: 4,
  cooldownMs: 4000,
  maxLevel: 4,
};

/** Frames longer than this are stalls (tab hidden, tile build, GC), not steady load. */
const STALL_MS = 500;

/**
 * Picks a reduction level from measured frame times: 0 keeps the chosen preset,
 * each higher level removes more rendering work. It steps one level at a time
 * and waits out a cooldown so a change can take effect before it is judged.
 */
export class AdaptiveQuality {
  level = 0;
  private readonly options: AdaptiveQualityOptions;
  private windowStart: number | null = null;
  private total = 0;
  private frames = 0;
  private stalls = 0;
  private slowRun = 0;
  private fastRun = 0;
  private lastChange = -Infinity;

  constructor(options: Partial<AdaptiveQualityOptions> = {}) {
    this.options = { ...ADAPTIVE_DEFAULTS, ...options };
  }

  /** Feeds one frame; returns the new level when it changes, otherwise null. */
  sample(frameMs: number, now: number): number | null {
    if (this.windowStart === null) this.windowStart = now;
    if (frameMs >= STALL_MS) this.stalls += 1;
    else if (frameMs > 0) {
      this.total += frameMs;
      this.frames += 1;
    }
    if (now - this.windowStart < this.options.windowMs) return null;
    // A window made almost entirely of long frames is a very slow device, not a stall.
    const crawling = this.stalls >= 2 && this.stalls >= this.frames;
    const average = crawling ? STALL_MS : this.frames ? this.total / this.frames : 0;
    const counted = crawling || this.frames >= 3;
    this.windowStart = now;
    this.total = 0;
    this.frames = 0;
    this.stalls = 0;
    if (!counted) return null;
    if (now - this.lastChange < this.options.cooldownMs) {
      this.slowRun = 0;
      this.fastRun = 0;
      return null;
    }
    this.slowRun = average > this.options.slowMs ? this.slowRun + 1 : 0;
    this.fastRun = average < this.options.fastMs ? this.fastRun + 1 : 0;
    if (this.slowRun >= this.options.slowWindows && this.level < this.options.maxLevel) return this.change(this.level + 1, now);
    if (this.fastRun >= this.options.fastWindows && this.level > 0) return this.change(this.level - 1, now);
    return null;
  }

  reset() {
    this.level = 0;
    this.windowStart = null;
    this.total = 0;
    this.frames = 0;
    this.stalls = 0;
    this.slowRun = 0;
    this.fastRun = 0;
    this.lastChange = -Infinity;
  }

  private change(level: number, now: number) {
    this.level = level;
    this.lastChange = now;
    this.slowRun = 0;
    this.fastRun = 0;
    return level;
  }
}

export interface QualityStep {
  scaling: number;
  shadows: boolean;
  viewDistance: number;
  fogDensity: number;
}

export const FULL_VIEW_DISTANCE = 1600;
/** Coarsest hardware scaling automatic quality may reach; beyond this text and faces turn to blocks. */
export const MAX_AUTO_SCALING = 1.8;
/** Must stay beyond the 700 m sky dome radius or the sky is clipped. */
export const REDUCED_VIEW_DISTANCE = 760;
export const FULL_FOG_DENSITY = 0.0024;

/** What each level changes, cumulatively: resolution, then shadows, then view distance, then resolution again. */
export function qualityStep(level: number): QualityStep {
  return {
    scaling: (level >= 1 ? 1.25 : 1) * (level >= 4 ? 1.2 : 1),
    shadows: level < 2,
    viewDistance: level >= 3 ? REDUCED_VIEW_DISTANCE : FULL_VIEW_DISTANCE,
    fogDensity: level >= 3 ? 0.0045 : FULL_FOG_DENSITY,
  };
}
