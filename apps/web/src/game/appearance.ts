import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import type { UniformBuffer } from "@babylonjs/core/Materials/uniformBuffer";
import type { Material } from "@babylonjs/core/Materials/material";
import { MaterialPluginBase } from "@babylonjs/core/Materials/materialPluginBase";
import type { MaterialDefines } from "@babylonjs/core/Materials/materialDefines";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { SubMesh } from "@babylonjs/core/Meshes/subMesh";
import type { Scene } from "@babylonjs/core/scene";
import type { CharacterAppearance, accessories, hairstyles, outfits, skinTones } from "@lagos-living/shared";

type SkinTone = (typeof skinTones)[number];
type Outfit = (typeof outfits)[number];
export type Hairstyle = (typeof hairstyles)[number];
export type Accessory = (typeof accessories)[number];

/**
 * Mean sRGB colour of each region of the resident texture, printed by scripts/assets/build-resident-regions.mjs.
 * Recolouring scales each texel relative to these, so shading, folds and facial detail survive.
 */
const SOURCE = {
  skin: [130, 76, 51],
  top: [126, 97, 80],
  bottom: [15, 27, 39],
  shoes: [229, 225, 222],
} as const;

export const SKIN_TONE_COLOURS: Record<SkinTone, string> = {
  deep: "#4f2d1b",
  rich: "#82502f",
  warm: "#9b6643",
  golden: "#b4845b",
  light: "#cf9f7c",
};

/** `null` keeps the generated garment as it is (the ankara shirt, navy trousers and white trainers). */
export const OUTFIT_COLOURS: Record<Outfit, { top: string | null; bottom: string | null; shoes: string | null; label: string }> = {
  "island-casual": { top: "#efe8d8", bottom: "#b49a74", shoes: null, label: "Linen shirt, chinos" },
  "office-smart": { top: "#cfdff0", bottom: "#2d3139", shoes: "#4b2d1d", label: "Pale blue shirt, charcoal trousers" },
  "ankara-day": { top: null, bottom: null, shoes: null, label: "Ankara print shirt" },
  athleisure: { top: "#167a49", bottom: "#2a2a2e", shoes: "#f4f4f2", label: "Green jersey, joggers" },
};

const linear = (rgb: readonly number[]) => rgb.map((value) => (value / 255) ** 2.2);
const luminance = ([r, g, b]: number[]) => 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;

/** Per-avatar shader inputs: linear-space colours, with the source region's luminance in `w` (0 = leave as is). */
export type AppearanceUniforms = { skin: Color3; top: [number, number, number, number]; bottom: [number, number, number, number]; shoes: [number, number, number, number] };

export function appearanceUniforms(appearance: CharacterAppearance): AppearanceUniforms {
  const sourceSkin = linear(SOURCE.skin);
  const targetSkin = linear(Color3.FromHexString(SKIN_TONE_COLOURS[appearance.skinTone]).asArray().map((value) => value * 255));
  const garment = (hex: string | null, source: readonly number[]): [number, number, number, number] => {
    if (!hex) return [0, 0, 0, 0];
    const target = linear(Color3.FromHexString(hex).asArray().map((value) => value * 255));
    return [target[0]!, target[1]!, target[2]!, luminance(linear(source))];
  };
  const outfit = OUTFIT_COLOURS[appearance.outfit];
  return {
    skin: new Color3(targetSkin[0]! / sourceSkin[0]!, targetSkin[1]! / sourceSkin[1]!, targetSkin[2]! / sourceSkin[2]!),
    top: garment(outfit.top, SOURCE.top),
    bottom: garment(outfit.bottom, SOURCE.bottom),
    shoes: garment(outfit.shoes, SOURCE.shoes),
  };
}

const regionTextures = new WeakMap<Scene, Texture>();

/** UV-space region ids (R) and skin weight (G); nearest sampling so ids never blend at chart edges. */
function regionTexture(scene: Scene) {
  let texture = regionTextures.get(scene);
  if (!texture) {
    texture = new Texture("/assets/characters/resident-v1-regions.png", scene, true, false, Texture.NEAREST_SAMPLINGMODE);
    texture.wrapU = Texture.CLAMP_ADDRESSMODE;
    texture.wrapV = Texture.CLAMP_ADDRESSMODE;
    regionTextures.set(scene, texture);
  }
  return texture;
}

/** Recolours skin and garments of the resident material in the shader, without per-appearance textures. */
export class ResidentAppearancePlugin extends MaterialPluginBase {
  static readonly NAME = "LagosResidentAppearance";
  private readonly regions: Texture;
  uniforms: AppearanceUniforms;

  constructor(material: Material, appearance: CharacterAppearance) {
    super(material, ResidentAppearancePlugin.NAME, 200, { LAGOS_APPEARANCE: false }, true, true);
    this.regions = regionTexture(material.getScene());
    this.uniforms = appearanceUniforms(appearance);
  }

  set(appearance: CharacterAppearance) {
    this.uniforms = appearanceUniforms(appearance);
  }

  override getClassName() {
    return "ResidentAppearancePlugin";
  }

  override prepareDefines(defines: MaterialDefines) {
    defines.LAGOS_APPEARANCE = true;
  }

  override isReadyForSubMesh(_defines: MaterialDefines, _scene: Scene, _engine: AbstractEngine, _subMesh: SubMesh) {
    return this.regions.isReady();
  }

  override getSamplers(samplers: string[]) {
    samplers.push("lagosRegionSampler");
  }

  override getActiveTextures(activeTextures: import("@babylonjs/core/Materials/Textures/baseTexture").BaseTexture[]) {
    activeTextures.push(this.regions);
  }

  override getUniforms() {
    return {
      ubo: [
        { name: "lagosSkin", size: 3, type: "vec3" },
        { name: "lagosTop", size: 4, type: "vec4" },
        { name: "lagosBottom", size: 4, type: "vec4" },
        { name: "lagosShoes", size: 4, type: "vec4" },
      ],
      fragment: `#ifdef LAGOS_APPEARANCE
uniform vec3 lagosSkin;
uniform vec4 lagosTop;
uniform vec4 lagosBottom;
uniform vec4 lagosShoes;
#endif`,
    };
  }

  override bindForSubMesh(uniformBuffer: UniformBuffer) {
    const { skin, top, bottom, shoes } = this.uniforms;
    uniformBuffer.updateColor3("lagosSkin", skin);
    uniformBuffer.updateFloat4("lagosTop", ...top);
    uniformBuffer.updateFloat4("lagosBottom", ...bottom);
    uniformBuffer.updateFloat4("lagosShoes", ...shoes);
    uniformBuffer.setTexture("lagosRegionSampler", this.regions);
  }

  override getCustomCode(shaderType: string) {
    if (shaderType !== "fragment") return null;
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: `#ifdef LAGOS_APPEARANCE
uniform sampler2D lagosRegionSampler;
vec3 lagosGarment(vec3 albedo, vec4 target) {
  if (target.w <= 0.0) return albedo;
  float shade = clamp(pow(max(dot(albedo, vec3(0.2126, 0.7152, 0.0722)), 1e-4) / target.w, 0.3), 0.55, 1.3);
  return target.rgb * shade;
}
#endif`,
      CUSTOM_FRAGMENT_UPDATE_ALPHA: `#ifdef LAGOS_APPEARANCE
#ifdef ALBEDO
vec4 lagosRegion = texture2D(lagosRegionSampler, vAlbedoUV + uvOffset);
float lagosId = floor(lagosRegion.r * 255.0 + 0.5);
if (lagosId == 1.0) surfaceAlbedo = mix(surfaceAlbedo, surfaceAlbedo * lagosSkin, lagosRegion.g);
else if (lagosId == 2.0) surfaceAlbedo = lagosGarment(surfaceAlbedo, lagosTop);
else if (lagosId == 3.0) surfaceAlbedo = lagosGarment(surfaceAlbedo, lagosBottom);
else if (lagosId == 4.0) surfaceAlbedo = lagosGarment(surfaceAlbedo, lagosShoes);
#endif
#endif`,
    };
  }
}
