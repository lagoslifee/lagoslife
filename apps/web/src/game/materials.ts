import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Scene } from "@babylonjs/core/scene";

export type Quality = "low" | "medium" | "high";

const base = "/assets/textures/";

function textured(
  scene: Scene,
  name: string,
  file: string,
  options: { roughness: number; tint?: string; normal?: boolean; quality: Quality; metallic?: number },
) {
  const material = new PBRMaterial(name, scene);
  material.albedoTexture = new Texture(`${base}${file}_diff.webp`, scene);
  if (options.normal !== false && options.quality !== "low") {
    material.bumpTexture = new Texture(`${base}${file}_nor_gl.webp`, scene);
    material.bumpTexture.level = 0.9;
    material.invertNormalMapY = true;
  }
  material.metallic = options.metallic ?? 0;
  material.roughness = options.roughness;
  if (options.tint) material.albedoColor = Color3.FromHexString(options.tint);
  material.environmentIntensity = 0.55;
  return material;
}

function flat(scene: Scene, name: string, hex: string, roughness: number, metallic = 0) {
  const material = new PBRMaterial(name, scene);
  material.albedoColor = Color3.FromHexString(hex);
  material.roughness = roughness;
  material.metallic = metallic;
  material.environmentIntensity = 0.6;
  return material;
}

export function createMaterials(scene: Scene, quality: Quality) {
  const plaster = textured(scene, "painted plaster", "plaster", { roughness: 0.92, quality });
  plaster.albedoColor = Color3.White();
  const walls = textured(scene, "compound render", "plaster_alt", { roughness: 0.95, quality, tint: "#e6ded0" });
  const concrete = textured(scene, "concrete trim", "concrete", { roughness: 0.9, quality, tint: "#d8d4cc" });
  const asphalt = textured(scene, "asphalt", "asphalt", { roughness: 0.86, quality, tint: "#8b8b88" });
  const asphaltMinor = asphalt.clone("asphalt minor") as PBRMaterial;
  asphaltMinor.albedoColor = Color3.FromHexString("#9c9890");
  asphaltMinor.zOffset = -1;
  const asphaltMajor = asphalt.clone("asphalt major") as PBRMaterial;
  asphaltMajor.zOffset = -2;
  const pavers = textured(scene, "interlocking pavers", "pavers", { roughness: 0.88, quality, tint: "#c9b9a2" });
  pavers.zOffset = -3;
  const drain = textured(scene, "drain concrete", "concrete", { roughness: 0.95, quality, tint: "#7d786f" });
  drain.zOffset = -3;
  const dirt = textured(scene, "laterite ground", "dirt", { roughness: 1, quality, tint: "#d1a77c" });
  const grass = textured(scene, "verge grass", "grass", { roughness: 1, quality, tint: "#b7c494" });
  grass.zOffset = -1;
  const roof = textured(scene, "aluminium roofing", "roof", { roughness: 0.48, metallic: 0.55, quality });
  const tiles = textured(scene, "floor tiles", "tiles", { roughness: 0.35, quality });

  const glass = new PBRMaterial("window glass", scene);
  glass.albedoColor = Color3.FromHexString("#1d2c2f");
  glass.metallic = 0.1;
  glass.roughness = 0.08;
  glass.environmentIntensity = 1.4;
  glass.alpha = 0.92;

  const water = new PBRMaterial("pool water", scene);
  water.albedoColor = Color3.FromHexString("#2f9fb3");
  water.roughness = 0.05;
  water.metallic = 0.2;
  water.alpha = 0.85;
  water.zOffset = -2;

  const lamp = new PBRMaterial("lamp glow", scene);
  lamp.albedoColor = Color3.FromHexString("#fff4d6");
  lamp.emissiveColor = Color3.FromHexString("#fff0c8");
  lamp.unlit = true;

  const paintWhite = flat(scene, "road paint", "#f1f0e8", 0.7);
  paintWhite.zOffset = -4;
  const paintYellow = flat(scene, "yellow paint", "#e4b43a", 0.7);
  paintYellow.zOffset = -4;
  const palmLeaf = flat(scene, "palm leaf", "#2c4f1f", 0.8);
  palmLeaf.environmentIntensity = 0.35;
  palmLeaf.backFaceCulling = false;
  const awningRed = flat(scene, "awning red", "#a2342a", 0.7);
  awningRed.backFaceCulling = false;
  const awningGreen = flat(scene, "awning green", "#1d6a4c", 0.7);
  awningGreen.backFaceCulling = false;
  const vertexPaint = flat(scene, "painted metal", "#ffffff", 0.5, 0.3);

  return {
    water,
    lamp,
    vertexPaint,
    plaster,
    walls,
    concrete,
    asphalt: asphaltMajor,
    asphaltMinor,
    pavers,
    drain,
    dirt,
    grass,
    roof,
    tiles,
    glass,
    frame: flat(scene, "aluminium frame", "#d9dbd6", 0.4, 0.6),
    darkFrame: flat(scene, "bronze frame", "#3a352f", 0.45, 0.5),
    gate: flat(scene, "painted steel gate", "#202322", 0.55, 0.65),
    wood: flat(scene, "hardwood", "#6d4127", 0.6),
    paintWhite,
    paintYellow,
    rubber: flat(scene, "rubber", "#1c1c1c", 0.8),
    chrome: flat(scene, "chrome", "#c9ccd0", 0.15, 1),
    palmBark: flat(scene, "palm bark", "#55412f", 0.95),
    palmLeaf,
    bush: flat(scene, "hedge", "#4a7136", 0.9),
    tank: flat(scene, "water tank", "#1f2425", 0.6),
    acUnit: flat(scene, "ac unit", "#e8e8e2", 0.5, 0.2),
    awningRed,
    awningGreen,
    signGreen: flat(scene, "street sign", "#0e5a3a", 0.5),
    pole: flat(scene, "galvanised pole", "#8d9294", 0.45, 0.8),
    fabric: flat(scene, "sofa fabric", "#2f6f73", 0.9),
    bedding: flat(scene, "bedding", "#e9e2d4", 0.95),
    seat: flat(scene, "danfo seat vinyl", "#3a2c23", 0.6),
  };
}

export type Materials = ReturnType<typeof createMaterials>;
