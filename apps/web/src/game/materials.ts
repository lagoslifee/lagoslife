import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
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

/**
 * Curtain-wall glass for the Dubai towers: one storey by two mullion bays per repeat (walls use a 3.2 m UV tile),
 * blue-green vision glass over a dark spandrel band, so a whole tower face is a single quad.
 */
function curtainWall(scene: Scene) {
  const texture = new DynamicTexture("curtain wall", { width: 256, height: 256 }, scene, true);
  const ctx = texture.getContext() as unknown as CanvasRenderingContext2D;
  const glass = ctx.createLinearGradient(0, 0, 0, 200);
  glass.addColorStop(0, "#6fa9b8");
  glass.addColorStop(1, "#2f6a7e");
  ctx.fillStyle = glass;
  ctx.fillRect(0, 0, 256, 256);
  ctx.fillStyle = "#24414c";
  ctx.fillRect(0, 200, 256, 56);
  ctx.fillStyle = "#d7dee0";
  ctx.fillRect(0, 196, 256, 6);
  ctx.fillRect(0, 0, 256, 3);
  for (const x of [0, 128]) ctx.fillRect(x, 0, 5, 256);
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  for (const x of [5, 133]) ctx.fillRect(x, 3, 40, 193);
  texture.update(true);
  texture.wrapU = Texture.WRAP_ADDRESSMODE;
  texture.wrapV = Texture.WRAP_ADDRESSMODE;
  const material = new PBRMaterial("curtain wall glass", scene);
  material.albedoTexture = texture;
  material.metallic = 0.55;
  material.roughness = 0.14;
  material.environmentIntensity = 1.25;
  return material;
}

/**
 * What you see through the iFitness glass front: LED battens, a mirror wall with TVs and the red band, a row of
 * treadmills with members running on them, and the rack and plates on the weights side. Lit from inside, so unlit.
 */
function gymView(scene: Scene) {
  const [w, h] = [1024, 256];
  const texture = new DynamicTexture("gym view", { width: w, height: h }, scene, true);
  const ctx = texture.getContext() as unknown as CanvasRenderingContext2D;
  const wall = ctx.createLinearGradient(0, 0, 0, h);
  wall.addColorStop(0, "#1b1c20");
  wall.addColorStop(0.14, "#3a3c42");
  wall.addColorStop(0.7, "#4a4d54");
  wall.addColorStop(0.71, "#26282d");
  wall.addColorStop(1, "#17181b");
  ctx.fillStyle = wall;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#f4f7ff";
  for (let x = 30; x < w; x += 150) ctx.fillRect(x, 10, 110, 5);
  ctx.fillStyle = "#e0262b";
  ctx.fillRect(0, 70, w, 7);
  ctx.fillStyle = "#7d8a96";
  ctx.fillRect(0, 112, 700, 64);
  ctx.fillStyle = "rgba(255, 255, 255, 0.18)";
  for (let x = 20; x < 700; x += 90) ctx.fillRect(x, 112, 30, 64);
  const runners = ["#e0262b", "#2b8be0", "#f2f2f2", "#1fb87a", "#f2a01e", "#9b59d0"];
  for (let index = 0; index < 6; index += 1) {
    const x = 40 + index * 110;
    ctx.fillStyle = "#0d0d10";
    ctx.fillRect(x + 8, 84, 46, 24);
    ctx.fillStyle = index % 2 ? "#3aa0ff" : "#5fd0ff";
    ctx.fillRect(x + 11, 87, 40, 18);
    ctx.fillStyle = "#101114";
    ctx.fillRect(x, 212, 92, 14);
    ctx.fillRect(x + 6, 150, 6, 64);
    ctx.fillRect(x + 6, 150, 34, 6);
    const stride = index % 2 ? 1 : -1;
    const bx = x + 52;
    ctx.fillStyle = "#3b2418";
    ctx.beginPath();
    ctx.arc(bx, 132, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = runners[index]!;
    ctx.fillRect(bx - 10, 142, 20, 34);
    ctx.fillStyle = "#1e1f24";
    ctx.save();
    ctx.translate(bx, 176);
    for (const swing of [stride, -stride]) {
      ctx.save();
      ctx.rotate(swing * 0.35);
      ctx.fillRect(-4, 0, 8, 36);
      ctx.restore();
    }
    ctx.restore();
    ctx.fillStyle = "#3b2418";
    for (const swing of [stride, -stride]) {
      ctx.save();
      ctx.translate(bx + swing * 9, 146);
      ctx.rotate(-swing * 0.6);
      ctx.fillRect(-3, 0, 6, 26);
      ctx.restore();
    }
  }
  ctx.fillStyle = "#111215";
  for (const x of [770, 850]) ctx.fillRect(x, 60, 8, 166);
  ctx.fillRect(770, 60, 88, 8);
  ctx.fillRect(760, 120, 108, 5);
  for (const [x, r] of [[748, 30], [880, 30], [950, 22], [985, 18]] as const) {
    ctx.fillStyle = "#08080a";
    ctx.beginPath();
    ctx.arc(x, 226 - r, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#e0262b";
    ctx.beginPath();
    ctx.arc(x, 226 - r, r * 0.25, 0, Math.PI * 2);
    ctx.fill();
  }
  texture.update(true);
  const material = new PBRMaterial("gym view", scene);
  material.albedoTexture = texture;
  material.unlit = true;
  return material;
}

/** Seeded noise so the procedural Dubai textures look the same on every load. */
function speckle(ctx: CanvasRenderingContext2D, size: number, count: number, colors: string[], seed: number) {
  let state = seed;
  const next = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
  for (let index = 0; index < count; index += 1) {
    ctx.fillStyle = colors[Math.floor(next() * colors.length)]!;
    ctx.fillRect(next() * size, next() * size, 1 + next() * 2, 1 + next() * 2);
  }
}

/** Pale golden sand: the stock ground textures are dark laterite and concrete, too dark to tint into Gulf sand. */
function sandMaterial(scene: Scene) {
  const texture = new DynamicTexture("sand", { width: 256, height: 256 }, scene, true);
  const ctx = texture.getContext() as unknown as CanvasRenderingContext2D;
  ctx.fillStyle = "#e9d2a2";
  ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = "rgba(196,160,104,0.18)";
  ctx.lineWidth = 3;
  for (let y = 8; y < 256; y += 21) {
    ctx.beginPath();
    for (let x = 0; x <= 256; x += 8) ctx.lineTo(x, y + Math.sin((x / 256) * Math.PI * 4 + y) * 4);
    ctx.stroke();
  }
  speckle(ctx, 256, 2600, ["#f5e3bd", "#d7b98a", "#c9a876", "#fbefd4"], 7);
  texture.update(true);
  texture.wrapU = Texture.WRAP_ADDRESSMODE;
  texture.wrapV = Texture.WRAP_ADDRESSMODE;
  const material = new PBRMaterial("desert sand", scene);
  material.albedoTexture = texture;
  material.roughness = 1;
  material.metallic = 0;
  material.environmentIntensity = 0.55;
  return material;
}

/** Large-format pale stone slabs for Dubai pavements and the promenade (one 2.2 m texture repeat = 2 x 2 slabs). */
function stonePavers(scene: Scene) {
  const texture = new DynamicTexture("stone pavers", { width: 256, height: 256 }, scene, true);
  const ctx = texture.getContext() as unknown as CanvasRenderingContext2D;
  ctx.fillStyle = "#c9bfae";
  ctx.fillRect(0, 0, 256, 256);
  const shades = ["#efe8dc", "#e8e0d2", "#f3ede3", "#e3dacb"];
  for (let row = 0; row < 2; row += 1) {
    for (let column = 0; column < 2; column += 1) {
      ctx.fillStyle = shades[(row * 2 + column + row) % shades.length]!;
      ctx.fillRect(column * 128 + 2, row * 128 + 2, 124, 124);
    }
  }
  speckle(ctx, 256, 1400, ["rgba(255,255,255,0.35)", "rgba(150,140,120,0.18)"], 11);
  texture.update(true);
  texture.wrapU = Texture.WRAP_ADDRESSMODE;
  texture.wrapV = Texture.WRAP_ADDRESSMODE;
  const material = new PBRMaterial("stone pavers", scene);
  material.albedoTexture = texture;
  material.roughness = 0.75;
  material.metallic = 0;
  material.environmentIntensity = 0.55;
  material.zOffset = -3;
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
  // Open land between plots: dry Lagos grass rather than bare laterite, so a street reads lived-in, not a building site.
  const land = textured(scene, "open land", "grass", { roughness: 1, quality, tint: "#a9c27a" });
  const roof = textured(scene, "aluminium roofing", "roof", { roughness: 0.48, metallic: 0.55, quality });
  const tiles = textured(scene, "floor tiles", "tiles", { roughness: 0.35, quality });

  const glass = new PBRMaterial("window glass", scene);
  glass.albedoColor = Color3.FromHexString("#1d2c2f");
  glass.metallic = 0.1;
  glass.roughness = 0.08;
  glass.environmentIntensity = 1.4;
  glass.alpha = 0.92;

  // Clear shop glass: the cars inside a showroom stay visible from the street.
  const showroomGlass = new PBRMaterial("showroom glass", scene);
  showroomGlass.albedoColor = Color3.FromHexString("#cfe9f1");
  showroomGlass.metallic = 0;
  showroomGlass.roughness = 0.04;
  showroomGlass.environmentIntensity = 1.1;
  showroomGlass.alpha = 0.16;
  showroomGlass.backFaceCulling = false;

  const water = new PBRMaterial("pool water", scene);
  water.albedoColor = Color3.FromHexString("#2f9fb3");
  water.roughness = 0.05;
  water.metallic = 0.2;
  water.alpha = 0.85;
  water.zOffset = -2;

  const lagoon = flat(scene, "lagoon water", "#3f6f73", 0.12, 0.15);
  lagoon.environmentIntensity = 0.9;

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
  // Unlit white, so each strip glows in its own vertex colour.
  const neon = new PBRMaterial("neon tube", scene);
  neon.albedoColor = Color3.White();
  neon.unlit = true;
  const carpet = flat(scene, "red carpet", "#9c0f1e", 0.95);

  // Dubai holiday region.
  const sand = sandMaterial(scene);
  const promenade = stonePavers(scene);
  const gulf = flat(scene, "gulf water", "#2f9fae", 0.1, 0.15);
  gulf.environmentIntensity = 1;
  const canvas = flat(scene, "tent canvas", "#ffffff", 0.9);
  canvas.backFaceCulling = false;

  return {
    sand,
    promenade,
    gulf,
    canvas,
    curtainWall: curtainWall(scene),
    gymView: gymView(scene),
    signBlue: flat(scene, "dubai street sign", "#1d4f91", 0.45),
    water,
    lagoon,
    lamp,
    vertexPaint,
    neon,
    carpet,
    plaster,
    walls,
    concrete,
    asphalt: asphaltMajor,
    asphaltMinor,
    pavers,
    drain,
    dirt,
    grass,
    land,
    roof,
    tiles,
    glass,
    showroomGlass,
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
