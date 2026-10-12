import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { buildAirliner } from "./airliner";
import { MeshBuilderBatch } from "./geometry";

export type FlightShot = { eye: Vector3; look: Vector3 };
type Rgb = [number, number, number];

const RUNWAY_LENGTH = 1_200;
const RUNWAY_WIDTH = 45;
/** Seconds of the 60-second flight shown from outside: the take-off roll and climb, and the approach and touchdown. */
export const TAKEOFF_SHOT: [number, number] = [0, 13];
export const LANDING_SHOT: [number, number] = [49, 59.6];

/**
 * An airfield built well away from the cabin: runway with centreline, threshold bars and edge lights, a taxiway,
 * the terminal with the airport's name, a control tower, hangars and parked jets. The jet takes off from it or
 * lands on it while the camera watches from beside the runway.
 */
export function buildAirfield(scene: Scene, origin: [number, number], airport: "los" | "dxb") {
  const dubai = airport === "dxb";
  const [ax, az] = origin;
  const root = new TransformNode(`airfield ${airport}`, scene);
  root.position.set(ax, 0, az);
  const disposables: Array<{ dispose(): void }> = [];
  const solid = new StandardMaterial(`airfield ${airport} solid`, scene);
  solid.diffuseColor = Color3.White();
  solid.specularColor = new Color3(0.08, 0.08, 0.08);
  const glowing = new StandardMaterial(`airfield ${airport} lights`, scene);
  glowing.disableLighting = true;
  glowing.emissiveColor = Color3.White();
  disposables.push(solid, glowing);
  const body = new MeshBuilderBatch(`airfield ${airport} body`);
  const lamps = new MeshBuilderBatch(`airfield ${airport} lamps`);
  const box = (x: number, y: number, z: number, w: number, h: number, d: number, colour: Rgb) => body.box(x, y, z, w, h, d, 0, 1, colour);

  const ground: Rgb = dubai ? [0.82, 0.7, 0.5] : [0.36, 0.5, 0.26];
  box(0, -0.05, 0, 1_600, 0.1, 2_400, ground);
  box(0, 0.01, 0, RUNWAY_WIDTH, 0.04, RUNWAY_LENGTH, [0.17, 0.17, 0.18]);
  box(-110, 0.01, 0, 23, 0.04, RUNWAY_LENGTH * 0.9, [0.22, 0.22, 0.23]);
  for (const z of [-300, 0, 300]) box(-55, 0.012, z, 88, 0.04, 20, [0.22, 0.22, 0.23]);
  for (let z = -RUNWAY_LENGTH / 2 + 60; z < RUNWAY_LENGTH / 2 - 60; z += 50) box(0, 0.035, z, 0.9, 0.02, 30, [0.95, 0.95, 0.95]);
  for (const end of [-1, 1]) {
    for (let index = 0; index < 8; index += 1) {
      const x = -RUNWAY_WIDTH / 2 + 4 + index * 5.3 + (index > 3 ? 2 : 0);
      box(x, 0.035, end * (RUNWAY_LENGTH / 2 - 20), 2.2, 0.02, 30, [0.95, 0.95, 0.95]);
    }
    box(0, 0.035, end * (RUNWAY_LENGTH / 2 - 160), 18, 0.02, 45, [0.95, 0.95, 0.95]);
  }
  for (const side of [-1, 1]) {
    box(side * (RUNWAY_WIDTH / 2 - 1), 0.035, 0, 0.9, 0.02, RUNWAY_LENGTH, [0.95, 0.95, 0.95]);
    for (let z = -RUNWAY_LENGTH / 2; z <= RUNWAY_LENGTH / 2; z += 40) lamps.box(side * (RUNWAY_WIDTH / 2 + 1.5), 0.35, z, 0.4, 0.4, 0.4, 0, 1, [1, 0.95, 0.7]);
  }
  for (let index = 0; index < 6; index += 1) lamps.box(0, 0.35, RUNWAY_LENGTH / 2 + 30 + index * 30, 12, 0.3, 0.4, 0, 1, [1, 1, 0.92]);

  // Terminal and tower on the far side of the taxiway.
  const accent: Rgb = dubai ? [0.78, 0.62, 0.32] : [0.05, 0.45, 0.25];
  box(-200, 9, 60, 46, 18, 320, dubai ? [0.92, 0.9, 0.86] : [0.86, 0.87, 0.88]);
  box(-176.8, 9, 60, 0.4, 12, 310, [0.35, 0.55, 0.68]);
  box(-200, 18.8, 60, 50, 1.6, 326, accent);
  if (dubai) for (let index = 0; index < 9; index += 1) box(-200, 21 + (index % 2), -90 + index * 36, 40, 2, 3, [0.95, 0.94, 0.9]);
  for (const z of [-40, 60, 160]) {
    box(-172, 5, z, 14, 3, 3, [0.7, 0.72, 0.75]);
    box(-166, 3, z, 3, 6, 3, [0.7, 0.72, 0.75]);
  }
  box(-170, 22, -170, 7, 44, 7, [0.9, 0.9, 0.9]);
  box(-170, 46, -170, 15, 5, 15, [0.18, 0.32, 0.4]);
  box(-170, 49, -170, 17, 1.2, 17, [0.85, 0.85, 0.85]);
  box(-170, 52, -170, 0.5, 5, 0.5, [0.9, 0.2, 0.2]);
  lamps.box(-170, 54.8, -170, 0.9, 0.9, 0.9, 0, 1, [1, 0.25, 0.2]);
  for (const z of [-360, -300]) box(-200, 11, z, 50, 22, 50, [0.72, 0.74, 0.77]);
  if (dubai) {
    for (let index = 0; index < 10; index += 1) {
      const h = 60 + ((index * 53) % 220);
      box(-520 - (index % 3) * 60, h / 2, -500 + index * 110, 34, h, 34, [0.55, 0.62, 0.7]);
    }
    box(-640, 300, 200, 22, 600, 22, [0.62, 0.68, 0.74]);
  } else {
    for (let index = 0; index < 60; index += 1) {
      const x = 90 + ((index * 71) % 600);
      const z = -1_000 + ((index * 137) % 2_000);
      box(x, 4, z, 2, 8, 2, [0.35, 0.25, 0.15]);
      box(x, 9.5, z, 9, 4, 9, [0.18, 0.4, 0.16]);
    }
  }

  const meshes: Mesh[] = [];
  for (const [batch, material] of [[body, solid], [lamps, glowing]] as const) {
    const mesh = batch.build(scene, material);
    if (!mesh) continue;
    mesh.parent = root;
    mesh.isPickable = false;
    meshes.push(mesh);
  }

  const name = dubai ? "DUBAI INTERNATIONAL · DXB" : "MURTALA MUHAMMED INTL · LOS";
  const texture = new DynamicTexture(`airfield ${airport} name`, { width: 1024, height: 96 }, scene, true);
  const ctx = texture.getContext() as unknown as CanvasRenderingContext2D;
  ctx.fillStyle = dubai ? "#1d2a36" : "#0d4f2c";
  ctx.fillRect(0, 0, 1024, 96);
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 62px Inter, Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(name, 512, 70);
  texture.update(true);
  const signMaterial = new StandardMaterial(`airfield ${airport} sign`, scene);
  signMaterial.emissiveTexture = texture;
  signMaterial.diffuseColor = Color3.Black();
  signMaterial.disableLighting = true;
  const sign = MeshBuilder.CreatePlane(`airfield ${airport} sign`, { width: 120, height: 11 }, scene);
  sign.material = signMaterial;
  sign.parent = root;
  sign.position.set(-176.5, 24, 60);
  sign.rotation.y = -Math.PI / 2;
  disposables.push(texture, signMaterial, sign);

  const jet = buildAirliner(scene, `airfield ${airport} jet`, { accent: "#0d7a3e", title: "NAIJA WORLD AIR" });
  jet.root.parent = root;
  const gearHeight = jet.root.position.y;
  const parked = [-60, 40].map((z, index) => {
    const other = buildAirliner(scene, `airfield ${airport} parked ${index}`, { accent: index ? "#b8913c" : "#1f4f8a", title: index ? "DESERT AIR" : "ATLANTIC AIR" });
    other.root.parent = root;
    other.root.position.x = -150;
    other.root.position.z = z * 2.4;
    other.root.rotation.y = Math.PI / 2;
    return other;
  });

  const at = (x: number, y: number, z: number) => new Vector3(ax + x, y, az + z);
  const start = RUNWAY_LENGTH / 2 - 60;
  const place = (z: number, height: number, pitch: number) => {
    jet.root.position.set(0, gearHeight + height, z);
    jet.root.rotation.set(pitch, 0, 0);
  };

  return {
    root,
    /** Take-off: line up, roll, rotate and climb away. `t` is seconds since departure. */
    takeoff(t: number): FlightShot {
      const roll = Math.max(0, t - 1.5);
      const rotateAt = 7.5;
      const speedAtRotate = 10 * rotateAt;
      let z: number;
      let height = 0;
      let pitch = 0;
      if (roll < rotateAt) z = start - 5 * roll * roll;
      else {
        const air = roll - rotateAt;
        z = start - 5 * rotateAt * rotateAt - speedAtRotate * air;
        pitch = Math.min(0.2, air * 0.12);
        height = Math.max(0, air - 0.6) ** 1.6 * 4;
      }
      place(z, height, pitch);
      const nose = at(0, gearHeight + height, z);
      const eye = t < 6 ? at(40, 2.2, start - 70) : at(62, 6 + height * 0.25, z + 120 - Math.min(60, (t - 6) * 10));
      return { eye, look: nose };
    },
    /** Landing: a 3° final approach, flare, touchdown on the numbers, and the roll-out. `t` is seconds into the shot. */
    landing(t: number): FlightShot {
      const touchdown = 8;
      const threshold = RUNWAY_LENGTH / 2 - 160;
      let z: number;
      let height: number;
      let pitch: number;
      if (t < touchdown) {
        const left = touchdown - t;
        z = threshold - 10 + 68 * left;
        height = Math.max(0, 68 * left * Math.tan(0.052) - (left < 1.5 ? (1.5 - left) * 1.2 : 0));
        pitch = left < 1.6 ? 0.09 : 0.04;
      } else {
        const after = t - touchdown;
        z = threshold - 10 - (68 * after - 4 * after * after);
        height = 0;
        pitch = Math.max(0, 0.09 - after * 0.08);
      }
      place(z, height, pitch);
      const look = at(0, gearHeight + height, z);
      return { eye: at(44, 4, threshold + 70), look };
    },
    dispose() {
      jet.dispose();
      for (const other of parked) other.dispose();
      for (const mesh of meshes) mesh.dispose();
      for (const item of disposables) item.dispose();
      root.dispose();
    },
  };
}

export type Airfield = ReturnType<typeof buildAirfield>;

function part(scene: Scene, root: TransformNode, mesh: Mesh, hex: string, glow = 0) {
  const material = new StandardMaterial(`${mesh.name} paint`, scene);
  material.diffuseColor = Color3.FromHexString(hex);
  material.emissiveColor = Color3.FromHexString(hex).scale(glow);
  material.specularColor = new Color3(0.3, 0.3, 0.3);
  mesh.material = material;
  mesh.parent = root;
  mesh.isPickable = false;
  return mesh;
}

/** The crew's service trolley: a steel cart with drawers, a red top and drinks and snack boxes on it. */
export function buildTrolley(scene: Scene) {
  const root = new TransformNode("cabin trolley", scene);
  part(scene, root, MeshBuilder.CreateBox("trolley body", { width: 0.34, height: 0.95, depth: 0.78 }, scene), "#b9bec4").position.y = 0.52;
  part(scene, root, MeshBuilder.CreateBox("trolley top", { width: 0.36, height: 0.04, depth: 0.8 }, scene), "#9c1d22").position.y = 1.01;
  for (let row = 0; row < 3; row += 1) part(scene, root, MeshBuilder.CreateBox("trolley drawer", { width: 0.355, height: 0.02, depth: 0.7 }, scene), "#7d838a").position.y = 0.3 + row * 0.25;
  for (const [index, hex] of ["#f2a33a", "#2b6fd6", "#e8e2d0", "#3aa655"].entries()) {
    const bottle = part(scene, root, MeshBuilder.CreateCylinder("trolley drink", { diameter: 0.07, height: 0.22, tessellation: 10 }, scene), hex);
    bottle.position.set(-0.08 + (index % 2) * 0.16, 1.14, -0.25 + Math.floor(index / 2) * 0.14);
  }
  part(scene, root, MeshBuilder.CreateBox("trolley snacks", { width: 0.26, height: 0.1, depth: 0.22 }, scene), "#f5d36b").position.set(0, 1.08, 0.2);
  for (const z of [-0.33, 0.33]) for (const x of [-0.12, 0.12]) part(scene, root, MeshBuilder.CreateCylinder("trolley wheel", { diameter: 0.07, height: 0.03, tessellation: 8 }, scene), "#222222").position.set(x, 0.035, z);
  return root;
}

/** A fold-down tray table with the meal: a plate of jollof and chicken (or a snack pack), a cup and cutlery. */
export function buildMealTray(scene: Scene, business: boolean) {
  const root = new TransformNode("meal tray", scene);
  part(scene, root, MeshBuilder.CreateBox("tray table", { width: 0.42, height: 0.025, depth: 0.3 }, scene), "#3b3f46");
  part(scene, root, MeshBuilder.CreateBox("tray", { width: 0.36, height: 0.02, depth: 0.25 }, scene), "#d8d2c4").position.y = 0.022;
  if (business) {
    const plate = part(scene, root, MeshBuilder.CreateCylinder("plate", { diameter: 0.2, height: 0.015, tessellation: 20 }, scene), "#ffffff");
    plate.position.set(-0.04, 0.04, 0);
    const rice = part(scene, root, MeshBuilder.CreateSphere("jollof", { diameter: 0.12, segments: 8 }, scene), "#d4541c", 0.1);
    rice.scaling.y = 0.35;
    rice.position.set(-0.07, 0.055, 0.01);
    const chicken = part(scene, root, MeshBuilder.CreateSphere("chicken", { diameter: 0.08, segments: 8 }, scene), "#8a4a1f");
    chicken.scaling.set(1.2, 0.6, 0.8);
    chicken.position.set(0.0, 0.06, -0.02);
    const glass = part(scene, root, MeshBuilder.CreateCylinder("juice", { diameterTop: 0.07, diameterBottom: 0.055, height: 0.11, tessellation: 12 }, scene), "#f39c1f", 0.15);
    glass.position.set(0.12, 0.09, 0.06);
  } else {
    part(scene, root, MeshBuilder.CreateBox("snack pack", { width: 0.14, height: 0.04, depth: 0.1 }, scene), "#f5d36b").position.set(-0.06, 0.05, 0);
    const can = part(scene, root, MeshBuilder.CreateCylinder("soft drink", { diameter: 0.065, height: 0.12, tessellation: 12 }, scene), "#c8102e", 0.1);
    can.position.set(0.1, 0.09, 0.04);
  }
  part(scene, root, MeshBuilder.CreateBox("napkin", { width: 0.05, height: 0.005, depth: 0.16 }, scene), "#ffffff").position.set(0.15, 0.035, -0.06);
  return root;
}
