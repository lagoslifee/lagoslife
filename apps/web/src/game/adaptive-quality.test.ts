import { describe, expect, it } from "vitest";
import { AdaptiveQuality, qualityStep } from "./adaptive-quality";

function run(quality: AdaptiveQuality, frameMs: number, seconds: number, start = 0) {
  const changes: number[] = [];
  let now = start;
  while (now < start + seconds * 1000) {
    now += frameMs;
    const level = quality.sample(frameMs, now);
    if (level !== null) changes.push(level);
  }
  return { changes, now };
}

describe("AdaptiveQuality", () => {
  it("stays at full quality at 60 fps", () => {
    const quality = new AdaptiveQuality();
    expect(run(quality, 16.7, 60).changes).toEqual([]);
    expect(quality.level).toBe(0);
  });

  it("steps down one level at a time at 10 fps, waiting between steps, until the floor", () => {
    const quality = new AdaptiveQuality();
    const first = run(quality, 100, 5);
    expect(first.changes).toEqual([1]);
    const rest = run(quality, 100, 60, first.now);
    expect(rest.changes).toEqual([2, 3, 4]);
    expect(quality.level).toBe(4);
  });

  it.each([1.5, 1])("still steps down on a device crawling at %f fps", (fps) => {
    const quality = new AdaptiveQuality();
    expect(run(quality, 1000 / fps, 60).changes).toEqual([1, 2, 3, 4]);
  });

  it("does not react to a single slow window or to one-off stalls", () => {
    const quality = new AdaptiveQuality();
    let now = 0;
    for (let i = 0; i < 1200; i += 1) {
      now += 16.7;
      const stall = i % 200 === 0 ? 2000 : 16.7;
      expect(quality.sample(stall, now)).toBeNull();
    }
    const slow = run(quality, 50, 2.1, now);
    const back = run(quality, 16.7, 10, slow.now);
    expect([...slow.changes, ...back.changes]).toEqual([]);
  });

  it("restores quality once frames are fast again", () => {
    const quality = new AdaptiveQuality();
    const slow = run(quality, 100, 30);
    expect(quality.level).toBeGreaterThan(1);
    const reached = quality.level;
    const fast = run(quality, 12, 120, slow.now);
    expect(fast.changes).toEqual(Array.from({ length: reached }, (_, i) => reached - 1 - i));
    expect(quality.level).toBe(0);
  });

  it("holds steady in the band between the slow and fast thresholds", () => {
    const quality = new AdaptiveQuality();
    run(quality, 100, 6);
    const level = quality.level;
    expect(run(quality, 25, 60, 10000).changes).toEqual([]);
    expect(quality.level).toBe(level);
  });

  it("reduces work cumulatively per level", () => {
    expect(qualityStep(0)).toEqual({ scaling: 1, shadows: true, viewDistance: 1600, fogDensity: 0.0024 });
    expect(qualityStep(1).scaling).toBeGreaterThan(1);
    expect(qualityStep(2).shadows).toBe(false);
    expect(qualityStep(3).viewDistance).toBeLessThan(1600);
    expect(qualityStep(4).scaling).toBeGreaterThan(qualityStep(3).scaling);
  });
});
