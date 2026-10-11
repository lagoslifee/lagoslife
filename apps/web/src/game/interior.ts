import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import { CLUB_LAYOUT, INTERIOR_EXIT, INTERIOR_HALF, INTERIOR_ORIGIN, type Club, type Vec2 } from "@lagos-living/shared";
import { MeshBuilderBatch } from "./geometry";
import type { Materials } from "./materials";
import { SignAtlas } from "./sign-atlas";

export type InteriorKind = "starter" | "preview" | "home" | "club";
export type Placement = { id?: string; itemId: string; gridX: number; gridZ: number; rotation: number };
export type InteriorSpot = { id: "exit" | "bed" | "storage" | "kitchen" | "bar" | "dance"; point: Vec2; label: string };

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
  if (kind === "club") {
    animate = buildClub(scene, get, solid, spots, disposables, club);
    sofa(OX + HX - 0.6, OZ - 1.8, -Math.PI / 2);
    sofa(OX + HX - 0.6, OZ + 1.2, -Math.PI / 2);
    get("darkFrame").box(OX + HX - 1.6, 0.4, OZ - 1.8, 0.6, 0.06, 0.6);
    get("darkFrame").box(OX + HX - 1.6, 0.4, OZ + 1.2, 0.6, 0.06, 0.6);
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
    dispose() {
      for (const mesh of meshes) mesh.dispose();
      for (const item of disposables) item.dispose();
      light.dispose();
    },
  };
}

export type InteriorView = ReturnType<typeof buildInterior>;

type Solid = (key: string, x: number, y: number, z: number, w: number, h: number, d: number, yaw?: number, color?: [number, number, number], collide?: boolean) => void;

/** Bar, DJ booth and a tiled dance floor whose panels and spotlights pulse to the club's tempo. */
function buildClub(
  scene: Scene,
  get: (key: string) => MeshBuilderBatch,
  solid: Solid,
  spots: InteriorSpot[],
  disposables: Array<{ dispose(): void }>,
  club: Club | undefined,
) {
  const accent = Color3.FromHexString(club?.accent ?? "#8a3cff");
  const bpm = club?.bpm ?? 112;
  const palette = [accent, Color3.FromHexString("#1ec8ff"), Color3.FromHexString("#ffd21e"), Color3.FromHexString("#ff3df0")];

  const [barX, barZ] = CLUB_LAYOUT.bar;
  const counterX = barX - 0.85;
  solid("darkFrame", counterX, 0.55, barZ, 0.6, 1.1, 4.2);
  get("chrome").box(counterX, 1.12, barZ, 0.7, 0.04, 4.3);
  for (const shelfY of [1.2, 1.6, 2.0]) {
    get("wood").box(OX - HX + 0.15, shelfY, barZ, 0.3, 0.04, 3.6);
    for (let index = 0; index < 9; index += 1) {
      const tint = palette[(index + Math.round(shelfY * 10)) % palette.length]!;
      get("chrome").box(OX - HX + 0.15, shelfY + 0.14, barZ - 1.6 + index * 0.4, 0.08, 0.24, 0.08, 0, 1, [tint.r, tint.g, tint.b]);
    }
  }
  for (const offset of [-1.2, 0, 1.2]) get("chrome").box(barX - 0.2, 0.4, barZ + offset, 0.36, 0.06, 0.36);
  spots.push({ id: "bar", point: [barX, barZ], label: "Order at the bar" });

  const [djX, djZ] = CLUB_LAYOUT.dj;
  solid("darkFrame", djX, 0.55, djZ, 2.4, 1.1, 0.8);
  get("chrome").box(djX - 0.5, 1.13, djZ, 0.5, 0.05, 0.4);
  get("chrome").box(djX + 0.5, 1.13, djZ, 0.5, 0.05, 0.4);
  for (const side of [-1, 1]) {
    solid("darkFrame", djX + side * 2.0, 0.9, djZ + 0.2, 0.8, 1.8, 0.7, 0, [0.12, 0.12, 0.13]);
    for (const [y, size] of [[1.35, 0.3], [0.7, 0.5]] as const) get("chrome").box(djX + side * 2.0, y, djZ - 0.16, size, size, 0.04, 0, 1, [0.2, 0.2, 0.22]);
  }

  const [floorX, floorZ] = CLUB_LAYOUT.floor.centre;
  const [halfX, halfZ] = CLUB_LAYOUT.floor.half;
  const columns = 6;
  const rows = 5;
  const sizeX = (halfX * 2) / columns;
  const sizeZ = (halfZ * 2) / rows;
  const panels: StandardMaterial[] = [];
  for (let index = 0; index < palette.length; index += 1) {
    const material = new StandardMaterial(`club floor ${index}`, scene);
    material.disableLighting = true;
    material.emissiveColor = palette[index]!.clone();
    panels.push(material);
    disposables.push(material);
  }
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

  const beams = palette.slice(0, 3).map((color, index) => {
    const beam = new PointLight(`club spot ${index}`, new Vector3(floorX, HEIGHT - 0.4, floorZ), scene);
    beam.diffuse = color.clone();
    beam.range = 7;
    beam.intensity = 6;
    disposables.push(beam);
    return beam;
  });

  return (seconds: number) => {
    const beat = (seconds * bpm) / 60;
    const pulse = Math.pow(1 - (beat % 1), 2.5);
    const step = Math.floor(beat);
    panels.forEach((material, index) => {
      const colour = palette[(index + step) % palette.length]!;
      const level = 0.25 + 0.75 * (index % 2 === step % 2 ? pulse : 0.35);
      material.emissiveColor.set(colour.r * level, colour.g * level, colour.b * level);
    });
    beams.forEach((beam, index) => {
      const angle = seconds * 0.9 + (index * Math.PI * 2) / beams.length;
      beam.position.set(floorX + Math.cos(angle) * halfX * 0.8, HEIGHT - 0.4, floorZ + Math.sin(angle) * halfZ * 0.8);
      beam.intensity = 3 + 7 * pulse;
    });
  };
}
