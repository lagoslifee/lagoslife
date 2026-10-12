import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import { bottleById, CLUB_LAYOUT, CLUB_TABLES, INTERIOR_EXIT, INTERIOR_HALF, INTERIOR_ORIGIN, type Club, type Vec2 } from "@lagos-living/shared";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { MeshBuilderBatch } from "./geometry";
import type { Materials } from "./materials";
import { SignAtlas } from "./sign-atlas";

export type InteriorKind = "starter" | "preview" | "home" | "club";
export type Placement = { id?: string; itemId: string; gridX: number; gridZ: number; rotation: number };
export type InteriorSpot = { id: "exit" | "bed" | "storage" | "kitchen" | "bar" | "dance" | `table-${number}`; point: Vec2; label: string };

const HEIGHT = 3.0;
const [OX, OZ] = INTERIOR_ORIGIN;
const [HX, HZ] = INTERIOR_HALF;

export function cellCentre(gridX: number, gridZ: number): Vec2 {
  return [OX - HX + (gridX + 0.5) * 1.4, OZ - HZ + (gridZ + 0.5) * 1.6];
}

/** Builds one room at the interior origin; obstacles are returned as axis-aligned boxes. */
export function buildInterior(scene: Scene, materials: Materials, atlas: SignAtlas, kind: InteriorKind, title: string, placements: Placement[], club?: Club) {
  const batches = new Map<string, MeshBuilderBatch>();
  const get = (key: string) => {
    let batch = batches.get(key);
    if (!batch) {
      batch = new MeshBuilderBatch(`interior ${key}`);
      batches.set(key, batch);
    }
    return batch;
  };
  const boxes: Array<{ x: number; z: number; hx: number; hz: number }> = [];
  const solid = (key: string, x: number, y: number, z: number, w: number, h: number, d: number, yaw = 0, color?: [number, number, number], collide = true) => {
    get(key).box(x, y, z, w, h, d, yaw, 1, color);
    if (collide && y - h / 2 < 1) {
      const swap = Math.abs(Math.sin(yaw)) > 0.7;
      boxes.push({ x, z, hx: (swap ? d : w) / 2, hz: (swap ? w : d) / 2 });
    }
  };

  const corners: Vec2[] = [[OX - HX, OZ - HZ], [OX + HX, OZ - HZ], [OX + HX, OZ + HZ], [OX - HX, OZ + HZ]];
  get("tiles").polygon(corners, 0.02, 1.2, kind === "club" ? [0.16, 0.14, 0.2] : undefined);
  get("plaster").polygon(corners, HEIGHT, 3, kind === "club" ? [0.08, 0.07, 0.1] : [0.97, 0.97, 0.95], true);
  const wallColor: [number, number, number] = kind === "club" ? [0.13, 0.11, 0.17] : kind === "starter" ? [0.86, 0.9, 0.84] : [0.98, 0.95, 0.88];
  for (let index = 0; index < 4; index += 1) {
    const a = corners[index]!;
    const b = corners[(index + 1) % 4]!;
    get("plaster").wall(b[0], b[1], a[0], a[1], 0, HEIGHT, 2.5, wallColor);
  }
  // Windows with a bright daylight view on the north and east walls.
  for (const x of kind === "club" ? [] : [-3, 0, 3]) {
    get("lamp").quad([OX + x + 0.7, 1.0, OZ + HZ - 0.02], [OX + x - 0.7, 1.0, OZ + HZ - 0.02], [OX + x - 0.7, 2.3, OZ + HZ - 0.02], [OX + x + 0.7, 2.3, OZ + HZ - 0.02], [0, 0, -1], [[0, 0], [1, 0], [1, 1], [0, 1]]);
    get("frame").box(OX + x, 1.65, OZ + HZ - 0.04, 0.06, 1.3, 0.05);
    get("frame").box(OX + x, 1.0, OZ + HZ - 0.06, 1.5, 0.06, 0.12);
    get("frame").box(OX + x, 2.3, OZ + HZ - 0.04, 1.5, 0.06, 0.05);
  }
  if (kind !== "club") get("lamp").quad([OX + HX - 0.02, 1.0, OZ - 0.8], [OX + HX - 0.02, 1.0, OZ + 0.8], [OX + HX - 0.02, 2.3, OZ + 0.8], [OX + HX - 0.02, 2.3, OZ - 0.8], [-1, 0, 0], [[0, 0], [1, 0], [1, 1], [0, 1]]);
  // Exit door on the south wall.
  const [exitX, exitZ] = INTERIOR_EXIT;
  get("wood").quad([exitX - 0.55, 0.02, OZ - HZ + 0.03], [exitX + 0.55, 0.02, OZ - HZ + 0.03], [exitX + 0.55, 2.2, OZ - HZ + 0.03], [exitX - 0.55, 2.2, OZ - HZ + 0.03], [0, 0, 1], [[0, 0], [1, 0], [1, 2], [0, 2]]);
  get("darkFrame").box(exitX, 2.25, OZ - HZ + 0.05, 1.3, 0.1, 0.1);
  const subtitle = club ? `Tonight: ${club.dj}` : kind === "preview" ? "Show flat preview" : kind === "starter" ? "Starter room" : "Your home";
  const uv = atlas.get(title, "plate", subtitle);
  const signs = new MeshBuilderBatch("interior title");
  signs.quad([exitX + 2.4, 2.1, OZ - HZ + 0.03], [exitX + 0.9, 2.1, OZ - HZ + 0.03], [exitX + 0.9, 2.1 + 1.5 / SignAtlas.aspect, OZ - HZ + 0.03], [exitX + 2.4, 2.1 + 1.5 / SignAtlas.aspect, OZ - HZ + 0.03], [0, 0, 1], [[uv.u0, uv.v0], [uv.u1, uv.v0], [uv.u1, uv.v1], [uv.u0, uv.v1]]);

  const spots: InteriorSpot[] = [{ id: "exit", point: [exitX, OZ - HZ + 0.9], label: "Leave" }];

  const bed = (x: number, z: number, yaw: number) => {
    solid("wood", x, 0.25, z, 1.6, 0.4, 2.1, yaw);
    get("bedding").box(x, 0.55, z, 1.5, 0.22, 2.0, yaw);
    const px = x + Math.sin(yaw) * 0.75;
    const pz = z + Math.cos(yaw) * 0.75;
    get("bedding").box(px, 0.72, pz, 1.2, 0.14, 0.4, yaw, 1, [0.8, 0.86, 0.95]);
    get("wood").box(x + Math.sin(yaw) * 1.05, 0.7, z + Math.cos(yaw) * 1.05, 1.7, 1.0, 0.08, yaw);
    spots.push({ id: "bed", point: [x - Math.cos(yaw) * 1.2, z + Math.sin(yaw) * 1.2], label: "Sleep" });
  };
  const sofa = (x: number, z: number, yaw: number) => {
    solid("fabric", x, 0.25, z, 2.2, 0.45, 0.9, yaw);
    get("fabric").box(x - Math.sin(yaw) * 0.38, 0.7, z - Math.cos(yaw) * 0.38, 2.2, 0.6, 0.18, yaw);
    get("fabric").box(x - Math.cos(yaw) * 1.02, 0.55, z + Math.sin(yaw) * 1.02, 0.18, 0.4, 0.9, yaw);
    get("fabric").box(x + Math.cos(yaw) * 1.02, 0.55, z - Math.sin(yaw) * 1.02, 0.18, 0.4, 0.9, yaw);
  };
  const table = (x: number, z: number, yaw: number) => {
    get("wood").box(x, 0.74, z, 1.3, 0.06, 0.8, yaw);
    for (const [lx, lz] of [[-0.58, -0.34], [0.58, -0.34], [-0.58, 0.34], [0.58, 0.34]] as const) {
      get("wood").box(x + lx * Math.cos(yaw) + lz * Math.sin(yaw), 0.37, z - lx * Math.sin(yaw) + lz * Math.cos(yaw), 0.06, 0.72, 0.06, yaw);
    }
    boxes.push({ x, z, hx: 0.65, hz: 0.65 });
  };
  const furniture: Record<string, (x: number, z: number, yaw: number) => void> = { "island-bed": bed, "lagoon-sofa": sofa, "woven-table": table };

  const disposables: Array<{ dispose(): void }> = [];
  let animate: (seconds: number) => void = () => {};
  let clubView: ReturnType<typeof buildClub> | null = null;
  if (kind === "club") {
    clubView = buildClub(scene, atlas, get, solid, spots, disposables, club);
    animate = clubView.animate;
  } else if (kind === "starter") {
    bed(OX - HX + 1.0, OZ + HZ - 1.4, Math.PI);
    table(OX + 2.5, OZ + 2.6, 0);
    solid("wood", OX + HX - 0.4, 1.0, OZ - 1.5, 0.6, 2.0, 1.6, 0, [0.8, 0.7, 0.6]);
    get("fabric").polygon([[OX - 2, OZ - 1.5], [OX + 1, OZ - 1.5], [OX + 1, OZ + 1], [OX - 2, OZ + 1]], 0.03, 1, [0.8, 0.45, 0.3]);
  } else {
    get("concrete").box(OX - HX + 0.35, 0.45, OZ - 1.2, 0.7, 0.9, 3.2, 0, 1, [0.92, 0.9, 0.86]);
    boxes.push({ x: OX - HX + 0.35, z: OZ - 1.2, hx: 0.35, hz: 1.6 });
    get("darkFrame").box(OX - HX + 0.35, 0.92, OZ - 0.6, 0.55, 0.04, 0.55);
    get("chrome").box(OX - HX + 0.35, 0.93, OZ - 1.8, 0.45, 0.03, 0.35);
    spots.push({ id: "kitchen", point: [OX - HX + 1.3, OZ - 1.2], label: "Cook a meal" });
    get("fabric").polygon([[OX - 1.5, OZ - 1], [OX + 2, OZ - 1], [OX + 2, OZ + 1.6], [OX - 1.5, OZ + 1.6]], 0.03, 1, [0.55, 0.3, 0.25]);
    if (kind === "home") {
      solid("wood", OX + HX - 0.55, 0.4, OZ + HZ - 0.7, 1.0, 0.8, 0.6, 0, [0.75, 0.55, 0.35]);
      get("chrome").box(OX + HX - 0.55, 0.62, OZ + HZ - 1.0, 0.3, 0.06, 0.04);
      spots.push({ id: "storage", point: [OX + HX - 0.55, OZ + HZ - 1.7], label: "Open storage" });
      for (const placement of placements) {
        const build = furniture[placement.itemId];
        if (!build) continue;
        const [x, z] = cellCentre(placement.gridX, placement.gridZ);
        build(x, z, (placement.rotation * Math.PI) / 180);
      }
    } else {
      sofa(OX + 0.3, OZ - 0.2, 0);
      table(OX + 0.3, OZ + 1.4, 0);
      bed(OX + HX - 1.2, OZ + HZ - 1.4, Math.PI);
    }
  }

  const meshes: Mesh[] = [];
  for (const [key, batch] of batches) {
    const material = (materials as unknown as Record<string, Mesh["material"]>)[key]!;
    const mesh = batch.build(scene, material!);
    if (mesh) meshes.push(mesh);
  }
  const sign = signs.build(scene, atlas.material);
  if (sign) meshes.push(sign);
  const light = new PointLight("interior light", new Vector3(OX, HEIGHT - 0.3, OZ), scene);
  light.intensity = kind === "club" ? 5 : 18;
  light.range = 14;
  light.diffuse = Color3.FromHexString(kind === "club" ? "#b8a8ff" : "#fff1dc");

  return {
    spots,
    collide(x: number, z: number, radius: number): Vec2 {
      let px = Math.max(OX - HX + radius, Math.min(OX + HX - radius, x));
      let pz = Math.max(OZ - HZ + radius, Math.min(OZ + HZ - radius, z));
      for (const box of boxes) {
        const dx = px - box.x;
        const dz = pz - box.z;
        const ox = box.hx + radius - Math.abs(dx);
        const oz = box.hz + radius - Math.abs(dz);
        if (ox > 0 && oz > 0) {
          if (ox < oz) px += Math.sign(dx || 1) * ox;
          else pz += Math.sign(dz || 1) * oz;
        }
      }
      return [px, pz];
    },
    /** Advances animated fixtures such as the club light show; `seconds` is scene time. */
    update(seconds: number) {
      animate(seconds);
    },
    /** Club only: bottles standing on each VIP table. */
    setTableBottles(no: number, bottles: Array<{ id: string; itemId: string }>) {
      clubView?.setBottles(no, bottles);
    },
    /** Club only: strobes and boosts the lights over a VIP table when its bottles arrive. */
    celebrate(no: number) {
      clubView?.celebrate(no);
    },
    dispose() {
      for (const mesh of meshes) mesh.dispose();
      for (const item of disposables) item.dispose();
      light.dispose();
    },
  };
}

export type InteriorView = ReturnType<typeof buildInterior>;

type Solid = (key: string, x: number, y: number, z: number, w: number, h: number, d: number, yaw?: number, color?: [number, number, number], collide?: boolean) => void;
type Rgb = [number, number, number];

function neon(scene: Scene, name: string, color: Color3, disposables: Array<{ dispose(): void }>) {
  const material = new StandardMaterial(name, scene);
  material.disableLighting = true;
  material.emissiveColor = color.clone();
  disposables.push(material);
  return material;
}

/**
 * A Lagos club: LED wall behind the DJ, neon strips, mirror ball, backlit bar with stools, tiled dance floor, and three
 * red-velvet VIP booths along the east wall. Panels, LEDs and spotlights pulse to the club's tempo.
 */
function buildClub(
  scene: Scene,
  atlas: SignAtlas,
  get: (key: string) => MeshBuilderBatch,
  solid: Solid,
  spots: InteriorSpot[],
  disposables: Array<{ dispose(): void }>,
  club: Club | undefined,
) {
  const accent = Color3.FromHexString(club?.accent ?? "#8a3cff");
  const bpm = club?.bpm ?? 112;
  const palette = [accent, Color3.FromHexString("#1ec8ff"), Color3.FromHexString("#ffd21e"), Color3.FromHexString("#ff3df0")];
  const strips = new MeshBuilderBatch("club neon");
  const stripMaterial = neon(scene, "club neon", accent, disposables);
  const warm = new MeshBuilderBatch("club backlight");
  const warmMaterial = neon(scene, "club backlight", Color3.FromHexString("#ffb347"), disposables);

  // Neon: a ceiling cove line round the room and vertical tubes on the side walls.
  for (const [x0, z0, x1, z1] of [
    [OX - HX + 0.04, OZ - HZ, OX - HX + 0.04, OZ + HZ],
    [OX + HX - 0.04, OZ - HZ, OX + HX - 0.04, OZ + HZ],
    [OX - HX, OZ - HZ + 0.04, OX + HX, OZ - HZ + 0.04],
    [OX - HX, OZ + HZ - 0.04, OX + HX, OZ + HZ - 0.04],
  ] as const) {
    strips.box((x0 + x1) / 2, HEIGHT - 0.12, (z0 + z1) / 2, Math.max(0.04, Math.abs(x1 - x0)), 0.05, Math.max(0.04, Math.abs(z1 - z0)));
  }
  for (let z = OZ - HZ + 1.2; z < OZ + HZ - 0.6; z += 1.8) strips.box(OX + HX - 0.05, 1.6, z, 0.04, 2.2, 0.06);
  for (let x = OX - 3.6; x <= OX + 3.6; x += 2.4) if (Math.abs(x - INTERIOR_EXIT[0]) > 1) strips.box(x, 1.6, OZ - HZ + 0.05, 0.06, 2.2, 0.04);

  // Bar: dark counter with an LED kick strip, polished top, stools, and a backlit bottle wall.
  const [barX, barZ] = CLUB_LAYOUT.bar;
  const counterX = barX - 0.85;
  solid("darkFrame", counterX, 0.55, barZ, 0.6, 1.1, 4.2, 0, [0.1, 0.09, 0.12]);
  get("chrome").box(counterX, 1.12, barZ, 0.72, 0.04, 4.3, 0, 1, [0.85, 0.75, 0.5]);
  strips.box(counterX + 0.31, 0.12, barZ, 0.02, 0.05, 4.1);
  warm.box(OX - HX + 0.03, 1.65, barZ, 0.02, 1.3, 3.8);
  for (const shelfY of [1.2, 1.6, 2.0]) {
    get("chrome").box(OX - HX + 0.18, shelfY, barZ, 0.3, 0.03, 3.6, 0, 1, [0.7, 0.7, 0.72]);
    for (let index = 0; index < 11; index += 1) {
      const colour = [[0.12, 0.3, 0.12], [0.45, 0.25, 0.08], [0.8, 0.8, 0.85], [0.1, 0.1, 0.1]][(index + Math.round(shelfY * 10)) % 4]!;
      get("chrome").box(OX - HX + 0.18, shelfY + 0.15, barZ - 1.7 + index * 0.34, 0.08, 0.27, 0.08, 0, 1, colour as Rgb);
    }
  }
  for (const offset of [-1.5, -0.5, 0.5, 1.5]) {
    get("chrome").box(barX - 0.25, 0.38, barZ + offset, 0.05, 0.76, 0.05);
    get("fabric").box(barX - 0.25, 0.78, barZ + offset, 0.38, 0.08, 0.38, 0, 1, [0.08, 0.08, 0.1]);
  }
  spots.push({ id: "bar", point: [barX, barZ], label: "Order at the bar" });

  // DJ booth with decks and a lit front panel, flanked by stacked speakers, in front of the LED wall.
  const [djX, djZ] = CLUB_LAYOUT.dj;
  solid("darkFrame", djX, 0.55, djZ, 2.4, 1.1, 0.8, 0, [0.08, 0.08, 0.09]);
  strips.box(djX, 0.55, djZ - 0.41, 2.2, 0.08, 0.02);
  for (const side of [-0.55, 0.55]) {
    get("darkFrame").box(djX + side, 1.13, djZ, 0.5, 0.05, 0.42, 0, 1, [0.18, 0.18, 0.2]);
    get("chrome").box(djX + side, 1.17, djZ, 0.22, 0.02, 0.22, 0, 1, [0.6, 0.6, 0.62]);
  }
  get("darkFrame").box(djX, 1.15, djZ, 0.36, 0.08, 0.3, 0, 1, [0.12, 0.12, 0.14]);
  for (const side of [-1, 1]) {
    solid("darkFrame", djX + side * 2.0, 0.9, djZ + 0.2, 0.8, 1.8, 0.7, 0, [0.07, 0.07, 0.08]);
    for (const [y, size] of [[1.4, 0.3], [0.7, 0.55]] as const) get("chrome").box(djX + side * 2.0, y, djZ - 0.16, size, size, 0.04, 0, 1, [0.2, 0.2, 0.22]);
  }
  const ledSize = { w: 256, h: 96 };
  const led = new DynamicTexture("club led wall", { width: ledSize.w, height: ledSize.h }, scene, false);
  const ledMaterial = new StandardMaterial("club led wall", scene);
  ledMaterial.disableLighting = true;
  ledMaterial.emissiveTexture = led;
  ledMaterial.diffuseColor = Color3.Black();
  const ledPlane = MeshBuilder.CreatePlane("club led wall", { width: 6.4, height: 2.1 }, scene);
  ledPlane.position.set(djX, 1.95, OZ + HZ - 0.03);
  ledPlane.material = ledMaterial;
  disposables.push(led, ledMaterial, ledPlane);
  const ledContext = led.getContext() as CanvasRenderingContext2D;

  // Dance floor panels.
  const [floorX, floorZ] = CLUB_LAYOUT.floor.centre;
  const [halfX, halfZ] = CLUB_LAYOUT.floor.half;
  const columns = 6;
  const rows = 5;
  const sizeX = (halfX * 2) / columns;
  const sizeZ = (halfZ * 2) / rows;
  const panels = palette.map((colour, index) => neon(scene, `club floor ${index}`, colour, disposables));
  const panelBatches = panels.map((_, index) => new MeshBuilderBatch(`club floor ${index}`));
  for (let column = 0; column < columns; column += 1) {
    for (let row = 0; row < rows; row += 1) {
      const x = floorX - halfX + (column + 0.5) * sizeX;
      const z = floorZ - halfZ + (row + 0.5) * sizeZ;
      panelBatches[(column + row * 2) % panels.length]!.box(x, 0.03, z, sizeX - 0.06, 0.02, sizeZ - 0.06);
    }
  }
  panelBatches.forEach((batch, index) => {
    const mesh = batch.build(scene, panels[index]!);
    if (mesh) disposables.push(mesh);
  });
  spots.push({ id: "dance", point: [floorX, floorZ], label: "Dance" });

  // Mirror ball over the floor.
  const ballMaterial = new PBRMaterial("club mirror ball", scene);
  ballMaterial.metallic = 1;
  ballMaterial.roughness = 0.15;
  ballMaterial.albedoColor = new Color3(0.9, 0.9, 0.95);
  ballMaterial.emissiveColor = new Color3(0.25, 0.25, 0.3);
  const ball = MeshBuilder.CreateSphere("club mirror ball", { diameter: 0.5, segments: 6 }, scene);
  ball.convertToFlatShadedMesh();
  ball.position.set(floorX, HEIGHT - 0.55, floorZ);
  ball.material = ballMaterial;
  const chain = MeshBuilder.CreateCylinder("club mirror ball chain", { height: 0.3, diameter: 0.02 }, scene);
  chain.position.set(floorX, HEIGHT - 0.15, floorZ);
  chain.material = ballMaterial;
  disposables.push(ballMaterial, ball, chain);

  // VIP booths: carpet, velvet sofa against the wall, low table with a lit top, and a table number plate.
  const velvet: Rgb = [0.36, 0.04, 0.1];
  const tableTop = new MeshBuilderBatch("club vip tables");
  const tableMaterial = neon(scene, "club vip tables", Color3.FromHexString("#fff3d6"), disposables);
  const plates = new MeshBuilderBatch("club vip plates");
  const vipX = OX + HX - 3.0;
  get("fabric").polygon([[vipX, OZ - HZ + 0.3], [OX + HX, OZ - HZ + 0.3], [OX + HX, OZ + HZ - 0.6], [vipX, OZ + HZ - 0.6]], 0.035, 1, [0.18, 0.02, 0.05]);
  strips.box(vipX, 0.05, OZ + 0.15, 0.04, 0.03, HZ * 2 - 0.9);
  for (const table of CLUB_TABLES) {
    const [sx, sz] = table.sofa;
    const [tx, tz] = table.table;
    solid("fabric", sx, 0.24, sz, 0.8, 0.45, 2.2, 0, velvet);
    get("fabric").box(sx + 0.36, 0.75, sz, 0.18, 0.7, 2.2, 0, 1, velvet);
    get("fabric").box(sx - 0.05, 0.55, sz - 1.15, 0.9, 0.35, 0.16, 0, 1, velvet);
    get("fabric").box(sx - 0.05, 0.55, sz + 1.15, 0.9, 0.35, 0.16, 0, 1, velvet);
    solid("darkFrame", tx, 0.22, tz, 0.7, 0.44, 1.3, 0, [0.06, 0.06, 0.07]);
    tableTop.box(tx, 0.455, tz, 0.72, 0.02, 1.32);
    const uv = atlas.get(`VIP ${table.no}`, "plate", "Bottle service");
    const plateY = 2.2;
    const half = 0.45;
    plates.quad(
      [OX + HX - 0.03, plateY, tz + half],
      [OX + HX - 0.03, plateY, tz - half],
      [OX + HX - 0.03, plateY + (half * 2) / SignAtlas.aspect, tz - half],
      [OX + HX - 0.03, plateY + (half * 2) / SignAtlas.aspect, tz + half],
      [-1, 0, 0],
      [[uv.u0, uv.v0], [uv.u1, uv.v0], [uv.u1, uv.v1], [uv.u0, uv.v1]],
    );
    spots.push({ id: `table-${table.no}`, point: table.spot, label: `VIP table ${table.no}` });
  }
  for (const [batch, material] of [[strips, stripMaterial], [warm, warmMaterial], [tableTop, tableMaterial], [plates, atlas.material]] as const) {
    const mesh = batch.build(scene, material);
    if (mesh) disposables.push(mesh);
  }

  const beams = palette.slice(0, 3).map((color, index) => {
    const beam = new PointLight(`club spot ${index}`, new Vector3(floorX, HEIGHT - 0.4, floorZ), scene);
    beam.diffuse = color.clone();
    beam.range = 7;
    beam.intensity = 6;
    disposables.push(beam);
    return beam;
  });
  const vipLight = new PointLight("club vip light", new Vector3(OX + HX - 1.6, HEIGHT - 0.5, OZ), scene);
  vipLight.diffuse = Color3.FromHexString("#ff5a7a");
  vipLight.intensity = 4;
  vipLight.range = 6;
  disposables.push(vipLight);

  // Bottles on each table, with sparklers on the showpiece bottles for a few seconds after they arrive.
  const glass = new PBRMaterial("club bottle glass", scene);
  glass.albedoColor = new Color3(0.05, 0.18, 0.08);
  glass.metallic = 0.1;
  glass.roughness = 0.1;
  const gold = new PBRMaterial("club bottle foil", scene);
  gold.albedoColor = new Color3(0.85, 0.65, 0.2);
  gold.metallic = 1;
  gold.roughness = 0.3;
  const spark = neon(scene, "club sparkler", Color3.FromHexString("#fff2b0"), disposables);
  disposables.push(glass, gold);
  const tableBottles = new Map<number, { ids: string; root: TransformNode; sparks: Array<{ mesh: ReturnType<typeof MeshBuilder.CreateBox>; until: number }> }>();
  let clock = 0;
  const setBottles = (no: number, bottles: Array<{ id: string; itemId: string }>) => {
    const table = CLUB_TABLES.find((entry) => entry.no === no);
    if (!table) return;
    const ids = bottles.map((bottle) => bottle.id).join(",");
    const previous = tableBottles.get(no);
    if (previous?.ids === ids) return;
    const known = new Set(previous?.ids.split(",") ?? []);
    previous?.root.dispose();
    const root = new TransformNode(`club table ${no} bottles`, scene);
    const sparks: Array<{ mesh: ReturnType<typeof MeshBuilder.CreateBox>; until: number }> = [];
    bottles.forEach((bottle, index) => {
      const [tx, tz] = table.table;
      const x = tx + (index % 2 ? 0.14 : -0.14);
      const z = tz - 0.45 + Math.floor(index / 2) * 0.42;
      const body = MeshBuilder.CreateCylinder(`bottle ${bottle.id}`, { height: 0.26, diameter: 0.09, tessellation: 10 }, scene);
      body.position.set(x, 0.6, z);
      body.material = glass;
      body.parent = root;
      const neck = MeshBuilder.CreateCylinder(`bottle neck ${bottle.id}`, { height: 0.1, diameterTop: 0.03, diameterBottom: 0.07, tessellation: 8 }, scene);
      neck.position.set(x, 0.78, z);
      neck.material = gold;
      neck.parent = root;
      if (bottleById.get(bottle.itemId)?.sparkler && !known.has(bottle.id)) {
        const flare = MeshBuilder.CreateBox(`sparkler ${bottle.id}`, { size: 0.07 }, scene);
        flare.position.set(x, 0.9, z);
        flare.material = spark;
        flare.parent = root;
        sparks.push({ mesh: flare, until: clock + 12 });
      }
    });
    tableBottles.set(no, { ids, root, sparks });
  };
  disposables.push({ dispose: () => tableBottles.forEach((entry) => entry.root.dispose()) });

  let lastLed = -1;
  let party = { until: -1, table: 0 };
  const celebrate = (no: number) => {
    party = { until: clock + 8, table: no };
  };
  const animate = (seconds: number) => {
    clock = seconds;
    const beat = (seconds * bpm) / 60;
    const partying = seconds < party.until;
    const pulse = partying ? Math.pow(1 - ((beat * 2) % 1), 2) : Math.pow(1 - (beat % 1), 2.5);
    const step = Math.floor(beat);
    panels.forEach((material, index) => {
      const colour = palette[(index + step) % palette.length]!;
      const level = 0.25 + 0.75 * (index % 2 === step % 2 ? pulse : 0.35);
      material.emissiveColor.set(colour.r * level, colour.g * level, colour.b * level);
    });
    const glow = 0.55 + 0.45 * pulse;
    const stripColour = palette[Math.floor(beat / 8) % palette.length]!;
    stripMaterial.emissiveColor.set(stripColour.r * glow, stripColour.g * glow, stripColour.b * glow);
    beams.forEach((beam, index) => {
      const angle = seconds * 0.9 + (index * Math.PI * 2) / beams.length;
      beam.position.set(floorX + Math.cos(angle) * halfX * 0.8, HEIGHT - 0.4, floorZ + Math.sin(angle) * halfZ * 0.8);
      beam.intensity = partying ? 6 + 14 * pulse : 3 + 7 * pulse;
    });
    vipLight.intensity = partying ? 8 + 10 * pulse : 4;
    if (partying) {
      const strobe = Math.floor(seconds * 12) % 3 === 0;
      stripMaterial.emissiveColor.set(strobe ? 1 : 0.9, strobe ? 1 : 0.75, strobe ? 1 : 0.2);
    }
    ball.rotation.y = seconds * 0.6;
    for (const entry of tableBottles.values()) {
      for (const flare of entry.sparks) {
        const live = seconds < flare.until;
        flare.mesh.setEnabled(live);
        if (live) flare.mesh.scaling.setAll(0.6 + Math.random() * 0.9);
      }
    }
    if (seconds - lastLed > 1 / 15) {
      lastLed = seconds;
      ledContext.fillStyle = "#05030a";
      ledContext.fillRect(0, 0, ledSize.w, ledSize.h);
      const bars = 24;
      for (let index = 0; index < bars; index += 1) {
        const wave = 0.5 + 0.5 * Math.sin(seconds * 3 + index * 0.55) * Math.cos(seconds * 1.3 + index * 0.21);
        const height = (0.2 + 0.8 * wave * (0.55 + 0.45 * pulse)) * ledSize.h;
        const colour = palette[(index + Math.floor(beat / 4)) % palette.length]!;
        ledContext.fillStyle = colour.toHexString();
        ledContext.fillRect(index * (ledSize.w / bars) + 1, ledSize.h - height, ledSize.w / bars - 2, height);
      }
      ledContext.fillStyle = "rgba(255,255,255,0.9)";
      ledContext.font = "bold 18px Inter, Arial, sans-serif";
      ledContext.textAlign = "center";
      ledContext.fillText(partying ? `BOTTLE SERVICE · VIP ${party.table}` : club ? club.dj.toUpperCase() : "LIVE", ledSize.w / 2, 24);
      led.update(false);
    }
  };
  return { animate, setBottles, celebrate };
}
