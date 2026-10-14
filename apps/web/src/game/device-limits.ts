import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";

/** Phones and tablets, iPads included (iPadOS reports a Mac user agent but still has a coarse pointer). */
export const TOUCH_DEVICE = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;

/**
 * iOS kills a Safari tab, with no warning, once it holds roughly a gigabyte, and textures are most of that: every
 * prop and ground material ships 1024² maps. Babylon shrinks any image larger than `maxTextureSize` while uploading,
 * so lowering the cap quarters each of those maps on a small screen where the extra detail is never seen.
 */
export function capTextureSize(engine: AbstractEngine) {
  if (!TOUCH_DEVICE) return;
  const caps = engine.getCaps();
  caps.maxTextureSize = Math.min(caps.maxTextureSize, 512);
}
