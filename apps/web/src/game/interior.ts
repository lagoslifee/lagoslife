import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import { INTERIOR_EXIT, INTERIOR_HALF, INTERIOR_ORIGIN, type Vec2 } from "@lagos-living/shared";
import { MeshBuilderBatch } from "./geometry";
import type { Materials } from "./materials";
import { SignAtlas } from "./sign-atlas";

export type InteriorKind = "starter" | "preview" | "home";
export type Placement = { id?: string; itemId: string; gridX: number; gridZ: number; rotation: number };
export type InteriorSpot = { id: "exit" | "bed" | "storage" | "kitchen"; point: Vec2; label: string };

const HEIGHT = 3.0;
const [OX, OZ] = INTERIOR_ORIGIN;
const [HX, HZ] = INTERIOR_HALF;

export function cellCentre(gridX: number, gridZ: number): Vec2 {
  return [OX - HX + (gridX + 0.5) * 1.4, OZ - HZ + (gridZ + 0.5) * 1.6];
}

/** Builds one room at the interior origin; obstacles are returned as axis-aligned boxes. */
export function buildInterior(scene: Scene, materials: Materials, atlas: SignAtlas, kind: InteriorKind, title: string, placements: Placement[]) {
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
  get("tiles").polygon(corners, 0.02, 1.2);
  get("plaster").polygon(corners, HEIGHT, 3, [0.97, 0.97, 0.95], true);
  const wallColor: [number, number, number] = kind === "starter" ? [0.86, 0.9, 0.84] : [0.98, 0.95, 0.88];
  for (let index = 0; index < 4; index += 1) {
    const a = corners[index]!;
    const b = corners[(index + 1) % 4]!;
    get("plaster").wall(b[0], b[1], a[0], a[1], 0, HEIGHT, 2.5, wallColor);
  }
  // Windows with a bright daylight view on the north and east walls.
  for (const x of [-3, 0, 3]) {
    get("lamp").quad([OX + x + 0.7, 1.0, OZ + HZ - 0.02], [OX + x - 0.7, 1.0, OZ + HZ - 0.02], [OX + x - 0.7, 2.3, OZ + HZ - 0.02], [OX + x + 0.7, 2.3, OZ + HZ - 0.02], [0, 0, -1], [[0, 0], [1, 0], [1, 1], [0, 1]]);
    get("frame").box(OX + x, 1.65, OZ + HZ - 0.04, 0.06, 1.3, 0.05);
    get("frame").box(OX + x, 1.0, OZ + HZ - 0.06, 1.5, 0.06, 0.12);
    get("frame").box(OX + x, 2.3, OZ + HZ - 0.04, 1.5, 0.06, 0.05);
  }
  get("lamp").quad([OX + HX - 0.02, 1.0, OZ - 0.8], [OX + HX - 0.02, 1.0, OZ + 0.8], [OX + HX - 0.02, 2.3, OZ + 0.8], [OX + HX - 0.02, 2.3, OZ - 0.8], [-1, 0, 0], [[0, 0], [1, 0], [1, 1], [0, 1]]);
  // Exit door on the south wall.
  const [exitX, exitZ] = INTERIOR_EXIT;
  get("wood").quad([exitX - 0.55, 0.02, OZ - HZ + 0.03], [exitX + 0.55, 0.02, OZ - HZ + 0.03], [exitX + 0.55, 2.2, OZ - HZ + 0.03], [exitX - 0.55, 2.2, OZ - HZ + 0.03], [0, 0, 1], [[0, 0], [1, 0], [1, 2], [0, 2]]);
  get("darkFrame").box(exitX, 2.25, OZ - HZ + 0.05, 1.3, 0.1, 0.1);
  const uv = atlas.get(title, "plate", kind === "preview" ? "Show flat preview" : kind === "starter" ? "Starter room" : "Your home");
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

  if (kind === "starter") {
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
  light.intensity = 18;
  light.range = 14;
  light.diffuse = Color3.FromHexString("#fff1dc");

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
    dispose() {
      for (const mesh of meshes) mesh.dispose();
      light.dispose();
    },
  };
}

export type InteriorView = ReturnType<typeof buildInterior>;
