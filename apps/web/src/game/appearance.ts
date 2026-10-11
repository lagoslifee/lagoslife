import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import type { UniformBuffer } from "@babylonjs/core/Materials/uniformBuffer";
import type { Material } from "@babylonjs/core/Materials/material";
import { MaterialPluginBase } from "@babylonjs/core/Materials/materialPluginBase";
import type { MaterialDefines } from "@babylonjs/core/Materials/materialDefines";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { SubMesh } from "@babylonjs/core/Meshes/subMesh";
import type { Scene } from "@babylonjs/core/scene";
import type { CharacterAppearance } from "@lagos-living/shared";
import { OUTFITS, SKIN_TONE_COLOURS, type Body, type Fabric } from "./wardrobe";

export { ACCESSORY_LABELS, BODY_LABELS, HAIR_COLOUR, HAIR_LABELS, OUTFITS, SKIN_TONE_COLOURS } from "./wardrobe";
export type { Accessory, Body, Hairstyle } from "./wardrobe";

/**
 * Mean sRGB colour of the face skin in each body texture, printed by scripts/assets/build-residents.mjs.
 * The skin tint is the ratio of the chosen tone to this, so pores, lips and shading survive.
 */
const SOURCE_SKIN: Record<Body, readonly [number, number, number]> = {
  male: [152, 105, 75],
  female: [161, 113, 80],
};

const linear = (hex: string) => Color3.FromHexString(hex).toLinearSpace();

/** Multiplier for the body texture that turns its skin into the chosen tone. */
export function skinTint(appearance: CharacterAppearance) {
  const target = linear(SKIN_TONE_COLOURS[appearance.skinTone]);
  const source = SOURCE_SKIN[appearance.body].map((value) => (value / 255) ** 2.2);
  return new Color3(target.r / source[0]!, target.g / source[1]!, target.b / source[2]!);
}

/** Garment ids baked into COLOR_0.r (id / 10) by scripts/assets/build-residents.mjs. */
const GARMENT_IDS = ["top", "sleeve", "trousers", "shoes", "skirt"] as const;
type Garment = (typeof GARMENT_IDS)[number];
type Slot = { base: [number, number, number, number]; print: [number, number, number, number]; accent: Color3 };

const HIDDEN: Slot = { base: [0, 0, 0, 0], print: [0, 0, 0, 0], accent: new Color3() };

function slot(fabric: Fabric | null): Slot {
  if (!fabric) return HIDDEN;
  const base = linear(fabric.colour);
  const print = fabric.print ? linear(fabric.print.colour) : base;
  return { base: [base.r, base.g, base.b, fabric.print ? 2 : 1], print: [print.r, print.g, print.b, 9], accent: fabric.print ? linear(fabric.print.accent) : base };
}

export function garmentSlots(appearance: CharacterAppearance): Record<Garment, Slot> {
  const outfit = OUTFITS[appearance.outfit];
  const shoes = linear(outfit.shoes);
  return {
    top: slot(outfit.top),
    sleeve: outfit.longSleeves ? slot(outfit.top) : HIDDEN,
    trousers: slot(outfit.trousers),
    shoes: { base: [shoes.r, shoes.g, shoes.b, 1], print: [0, 0, 0, 0], accent: shoes },
    skirt: slot(outfit.skirt),
  };
}

/** Colours, prints and hides the generated garments per avatar in the shader, from one shared mesh. */
export class GarmentPlugin extends MaterialPluginBase {
  static readonly NAME = "LagosGarments";
  slots: Record<Garment, Slot>;

  constructor(material: Material, appearance: CharacterAppearance) {
    super(material, GarmentPlugin.NAME, 200, { LAGOS_GARMENTS: false }, true, true);
    this.slots = garmentSlots(appearance);
  }

  set(appearance: CharacterAppearance) {
    this.slots = garmentSlots(appearance);
  }

  override getClassName() {
    return "GarmentPlugin";
  }

  override prepareDefines(defines: MaterialDefines) {
    defines.LAGOS_GARMENTS = true;
  }

  override isReadyForSubMesh(_defines: MaterialDefines, _scene: Scene, _engine: AbstractEngine, _subMesh: SubMesh) {
    return true;
  }

  override getUniforms() {
    const ubo = GARMENT_IDS.flatMap((id) => [
      { name: `lagos_${id}`, size: 4, type: "vec4" },
      { name: `lagos_${id}Print`, size: 4, type: "vec4" },
      { name: `lagos_${id}Accent`, size: 3, type: "vec3" },
    ]);
    return {
      ubo,
      fragment: `#ifdef LAGOS_GARMENTS
${GARMENT_IDS.map((id) => `uniform vec4 lagos_${id};\nuniform vec4 lagos_${id}Print;\nuniform vec3 lagos_${id}Accent;`).join("\n")}
#endif`,
    };
  }

  override bindForSubMesh(uniformBuffer: UniformBuffer) {
    for (const id of GARMENT_IDS) {
      const { base, print, accent } = this.slots[id];
      uniformBuffer.updateFloat4(`lagos_${id}`, ...base);
      uniformBuffer.updateFloat4(`lagos_${id}Print`, ...print);
      uniformBuffer.updateColor3(`lagos_${id}Accent`, accent);
    }
  }

  override getCustomCode(shaderType: string) {
    if (shaderType !== "fragment") return null;
    const pick = GARMENT_IDS.map(
      (id, index) => `${index ? "else " : ""}if (lagosId == ${index + 1}.0) { lagosBase = lagos_${id}; lagosPrint = lagos_${id}Print; lagosAccent = lagos_${id}Accent; }`,
    ).join("\n");
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: `#ifdef LAGOS_GARMENTS
float lagosMotif(vec2 uv, float scale) {
  vec2 cell = fract(uv * scale) - 0.5;
  float d = length(cell);
  float ring = smoothstep(0.31, 0.28, d) - smoothstep(0.22, 0.19, d);
  float diamond = abs(cell.x) + abs(cell.y);
  float frame = step(0.44, diamond) * step(diamond, 0.5);
  return clamp(ring + frame, 0.0, 1.0);
}
float lagosDot(vec2 uv, float scale) {
  return smoothstep(0.11, 0.08, length(fract(uv * scale) - 0.5));
}
#endif`,
      CUSTOM_FRAGMENT_UPDATE_ALPHA: `#ifdef LAGOS_GARMENTS
#if defined(VERTEXCOLOR) && defined(ALBEDO)
float lagosId = floor(vColor.r * 10.0 + 0.5);
vec4 lagosBase = vec4(0.0);
vec4 lagosPrint = vec4(0.0);
vec3 lagosAccent = vec3(0.0);
${pick}
if (lagosBase.w < 0.5) discard;
float lagosWeave = texture2D(albedoSampler, vAlbedoUV * 28.0).r;
vec3 lagosCloth = lagosBase.rgb;
if (lagosBase.w > 1.5) {
  lagosCloth = mix(lagosCloth, lagosPrint.rgb, lagosMotif(vAlbedoUV, lagosPrint.w));
  lagosCloth = mix(lagosCloth, lagosAccent, lagosDot(vAlbedoUV, lagosPrint.w));
}
surfaceAlbedo = lagosCloth * lagosWeave * lagosWeave;
#endif
#endif`,
    };
  }
}
