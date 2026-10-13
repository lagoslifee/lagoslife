import type { Scene } from "@babylonjs/core/scene";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { INTERIOR_ORIGIN, hash01, type Vec2 } from "@lagos-living/shared";
import { drawBroadcast } from "./football-broadcast";

const [OX, OZ] = INTERIOR_ORIGIN;

/** Long wooden benches either side of a middle aisle, every row facing the big screen on the back wall. */
export const VIEWING_ROWS = [-2.3, -0.9, 0.5, 1.9] as const;
export const VIEWING_BENCH_X = [-2.55, 2.55] as const;
export const VIEWING_BENCH_LENGTH = 3.3;
const SEAT_OFFSETS = [-1.2, -0.4, 0.4, 1.2];
export const VIEWING_SEAT_Y = 0.47;
export const VIEWING_SCREEN = { z: 4.74, y: 1.78, width: 4.8, height: 2.7 } as const;
export const VIEWING_KIOSK = { counter: [OX - 4.7, OZ - 3.0] as Vec2, staff: [OX - 5.25, OZ - 3.0] as Vec2 };

export type BenchSeat = { at: Vec2; yaw: number; fan: number | null };

/** Every seat in the hall; about a third are taken by regulars who are always there for the football. */
export function viewingSeats(): BenchSeat[] {
  const seats: BenchSeat[] = [];
  VIEWING_ROWS.forEach((row, rowIndex) => {
    for (const bx of VIEWING_BENCH_X) {
      for (const lx of SEAT_OFFSETS) {
        const index = seats.length;
        const fan = hash01(`viewing-fan:${index}`) < 0.34 && rowIndex > 0 ? index : null;
        seats.push({ at: [OX + bx + lx, OZ + row], yaw: 0, fan });
      }
    }
  });
  return seats;
}

/**
 * The projector screen on the back wall and a flat TV on each side wall, all showing the same live feed. The feed is
 * redrawn about fifteen times a second.
 */
export function buildViewingScreens(scene: Scene, disposables: Array<{ dispose(): void }>) {
  const texture = new DynamicTexture("viewing feed", { width: 768, height: 432 }, scene, true);
  const material = new StandardMaterial("viewing screen", scene);
  material.disableLighting = true;
  material.emissiveTexture = texture;
  material.diffuseColor = Color3.Black();
  material.specularColor = Color3.Black();
  disposables.push(texture, material);
  const big = MeshBuilder.CreatePlane("viewing screen main", { width: VIEWING_SCREEN.width, height: VIEWING_SCREEN.height }, scene);
  big.position.set(OX, VIEWING_SCREEN.y, OZ + VIEWING_SCREEN.z);
  big.material = material;
  big.isPickable = false;
  disposables.push(big);
  for (const side of [-1, 1]) {
    const tv = MeshBuilder.CreatePlane(`viewing screen side ${side}`, { width: 1.6, height: 0.9 }, scene);
    tv.position.set(OX + side * 5.52, 2.05, OZ - 0.2);
    tv.rotation.y = side * (Math.PI / 2);
    tv.material = material;
    tv.isPickable = false;
    disposables.push(tv);
  }
  const fanMaterial = new StandardMaterial("viewing fan", scene);
  fanMaterial.diffuseColor = new Color3(0.86, 0.86, 0.84);
  disposables.push(fanMaterial);
  const rotors = [-2.6, 0, 2.6].flatMap((z) =>
    [-2.6, 2.6].map((x) => {
      const rotor = new TransformNode(`viewing fan ${x} ${z}`, scene);
      rotor.position.set(OX + x, 2.62, OZ + z);
      const hub = MeshBuilder.CreateCylinder("viewing fan hub", { diameter: 0.18, height: 0.12 }, scene);
      const rod = MeshBuilder.CreateCylinder("viewing fan rod", { diameter: 0.03, height: 0.36 }, scene);
      rod.position.set(OX + x, 2.82, OZ + z);
      hub.parent = rotor;
      for (let blade = 0; blade < 3; blade += 1) {
        const wing = MeshBuilder.CreateBox("viewing fan blade", { width: 0.62, height: 0.012, depth: 0.12 }, scene);
        const turn = (blade / 3) * Math.PI * 2;
        wing.position.set(Math.cos(turn) * 0.38, 0, Math.sin(turn) * 0.38);
        wing.rotation.y = -turn;
        wing.parent = rotor;
        wing.material = fanMaterial;
      }
      for (const mesh of [hub, rod]) mesh.material = fanMaterial;
      for (const mesh of [...rotor.getChildMeshes(), rod]) mesh.isPickable = false;
      disposables.push(rod, rotor);
      return rotor;
    }),
  );
  let last = 0;
  return {
    update(seconds: number) {
      rotors.forEach((rotor, index) => (rotor.rotation.y = seconds * (5.2 + index * 0.3)));
      const now = Date.now();
      if (now - last < 66) return;
      last = now;
      const ctx = texture.getContext() as unknown as CanvasRenderingContext2D;
      drawBroadcast(ctx, 768, 432, now);
      texture.update(true);
    },
  };
}
