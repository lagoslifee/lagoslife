import type { Scene } from "@babylonjs/core/scene";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Avatar } from "./avatar";

/** Competition bumper colours by plate weight, and the smaller iron change plates. */
const PLATES: Array<{ kg: number; diameter: number; thickness: number; colour: string }> = [
  { kg: 25, diameter: 0.45, thickness: 0.067, colour: "#c62828" },
  { kg: 20, diameter: 0.45, thickness: 0.056, colour: "#1f4fa3" },
  { kg: 15, diameter: 0.45, thickness: 0.045, colour: "#e3b31a" },
  { kg: 10, diameter: 0.45, thickness: 0.035, colour: "#2e7d32" },
  { kg: 5, diameter: 0.23, thickness: 0.03, colour: "#2b2b2e" },
  { kg: 2.5, diameter: 0.19, thickness: 0.022, colour: "#2b2b2e" },
];
const BAR_KG = 20;

/** Plates loaded on each sleeve for a total of `kg` on a 20 kg bar, heaviest first. */
export function platesFor(kg: number) {
  let left = Math.max(0, (kg - BAR_KG) / 2);
  const loaded: typeof PLATES = [];
  for (const plate of PLATES) {
    while (left >= plate.kg - 1e-9) {
      loaded.push(plate);
      left -= plate.kg;
    }
  }
  return loaded;
}

const materials = new WeakMap<Scene, Map<string, PBRMaterial>>();
/** PBR like the room around it: the gym's lights are tuned for physical falloff and burn plain materials to white. */
function material(scene: Scene, colour: string, shiny = false) {
  let cache = materials.get(scene);
  if (!cache) materials.set(scene, (cache = new Map()));
  const key = `${colour}${shiny ? "s" : ""}`;
  let found = cache.get(key);
  if (!found) {
    found = new PBRMaterial(`gym gear ${key}`, scene);
    found.albedoColor = Color3.FromHexString(colour);
    found.metallic = shiny ? 0.9 : 0.15;
    found.roughness = shiny ? 0.32 : 0.7;
    cache.set(key, found);
  }
  return found;
}

/**
 * A loaded Olympic bar or a pair of hex dumbbells that ride in the lifter's hands. Call `follow` after the avatar's
 * pose is set each frame; the bar lies along the line between the palms, so it tilts if the hands do.
 */
export class GymGear {
  private readonly nodes: TransformNode[] = [];
  private readonly meshes: Mesh[] = [];

  constructor(
    private readonly scene: Scene,
    readonly kind: "barbell" | "dumbbells",
    readonly kg: number,
  ) {
    if (kind === "barbell") this.nodes.push(this.barbell(kg));
    else this.nodes.push(this.dumbbell(kg), this.dumbbell(kg));
  }

  private part(mesh: Mesh, parent: TransformNode, colour: string, shiny = false) {
    mesh.parent = parent;
    mesh.material = material(this.scene, colour, shiny);
    mesh.isPickable = false;
    this.meshes.push(mesh);
    return mesh;
  }

  private disc(parent: TransformNode, x: number, diameter: number, thickness: number, colour: string) {
    const plate = this.part(MeshBuilder.CreateCylinder("gym plate", { diameter, height: thickness, tessellation: 24 }, this.scene), parent, colour);
    plate.rotation.z = Math.PI / 2;
    plate.position.x = x;
  }

  private barbell(kg: number) {
    const root = new TransformNode("barbell", this.scene);
    const shaft = this.part(MeshBuilder.CreateCylinder("bar shaft", { diameter: 0.028, height: 1.31, tessellation: 10 }, this.scene), root, "#b9bcc2", true);
    shaft.rotation.z = Math.PI / 2;
    for (const side of [-1, 1]) {
      const sleeve = this.part(MeshBuilder.CreateCylinder("bar sleeve", { diameter: 0.05, height: 0.42, tessellation: 12 }, this.scene), root, "#d5d8dd", true);
      sleeve.rotation.z = Math.PI / 2;
      sleeve.position.x = side * 0.865;
      this.disc(root, side * 0.66, 0.075, 0.03, "#9ea2a8");
      let at = 0.69;
      for (const plate of platesFor(kg)) {
        this.disc(root, side * (at + plate.thickness / 2), plate.diameter, plate.thickness, plate.colour);
        at += plate.thickness + 0.002;
      }
      this.disc(root, side * (at + 0.015), 0.07, 0.03, "#50545a");
    }
    return root;
  }

  private dumbbell(kg: number) {
    const root = new TransformNode("dumbbell", this.scene);
    const handle = this.part(MeshBuilder.CreateCylinder("dumbbell handle", { diameter: 0.032, height: 0.13, tessellation: 10 }, this.scene), root, "#b9bcc2", true);
    handle.rotation.z = Math.PI / 2;
    const size = 0.075 + Math.sqrt(kg) * 0.022;
    const width = 0.035 + kg * 0.0022;
    for (const side of [-1, 1]) {
      const head = this.part(MeshBuilder.CreateCylinder("dumbbell head", { diameter: size, height: width, tessellation: 6 }, this.scene), root, "#26272b");
      head.rotation.z = Math.PI / 2;
      head.position.x = side * (0.065 + width / 2);
    }
    return root;
  }

  /** Puts the gear in the avatar's hands for this frame; `yaw` is the way the lifter faces (for the dumbbells' grip). */
  follow(avatar: Avatar, yaw: number, onBack = false) {
    const grips = avatar.grips();
    const shown = avatar.root.isEnabled();
    for (const node of this.nodes) node.setEnabled(Boolean(grips) && shown);
    if (!grips) return;
    const back = onBack && this.kind === "barbell" ? avatar.shoulders() : null;
    // A loaded bar stays level and square to the lifter even when the clip moves one arm ahead of the other; it sits
    // centred between the hands (or shoulders) so both grips stay on it.
    if (back) {
      const bar = this.nodes[0]!;
      const mid = back.left.add(back.right).scaleInPlace(0.5);
      // Behind the neck, on the traps: a little above the shoulder joints and back from them.
      bar.position.set(mid.x - Math.sin(yaw) * 0.09, (mid.y * 2 + back.neck.y) / 3 + 0.02, mid.z - Math.cos(yaw) * 0.09);
      bar.rotation.set(0, yaw, 0);
      return;
    }
    if (this.kind === "barbell") {
      const bar = this.nodes[0]!;
      bar.position.copyFrom(grips.left.add(grips.right).scaleInPlace(0.5));
      bar.rotation.set(0, yaw, 0);
      return;
    }
    const [left, right] = this.nodes;
    left!.position.copyFrom(grips.left);
    right!.position.copyFrom(grips.right);
    left!.rotation.set(0, yaw, 0);
    right!.rotation.set(0, yaw, 0);
  }

  /** Racks the gear at a fixed spot (a barbell sits level across the hooks, facing `yaw`). */
  rest(x: number, y: number, z: number, yaw: number) {
    this.nodes.forEach((node, i) => {
      node.setEnabled(true);
      const side = this.nodes.length > 1 ? (i === 0 ? -0.12 : 0.12) : 0;
      node.position.set(x + Math.cos(yaw) * side, y, z - Math.sin(yaw) * side);
      node.rotation.set(0, yaw, 0);
    });
  }

  dispose() {
    for (const mesh of this.meshes) mesh.dispose();
    for (const node of this.nodes) node.dispose();
  }
}

/** Where things sit on a flat press bench, in its own frame (the lifter's head toward −z, feet toward +z). */
export const PRESS_BENCH = {
  padTop: 0.44,
  /** The bar on the J-hooks, over the lifter's eyes. */
  rack: { y: 1.02, z: -0.5 },
  /** The lying lifter's root (the avatar lies along −z from it, with the shoulders near the head end of the pad). */
  lifter: { y: 0.53, z: 1.02 },
};

/** Point `local` (x, z in a piece's own frame) of something at `x`, `z` turned to `yaw`, in the world. */
export function turned(x: number, z: number, yaw: number, localX: number, localZ: number): [number, number] {
  return [x + Math.cos(yaw) * localX + Math.sin(yaw) * localZ, z - Math.sin(yaw) * localX + Math.cos(yaw) * localZ];
}

export type BenchPart = { size: [number, number, number]; at: [number, number, number]; colour: [number, number, number]; steel?: boolean };

/**
 * A flat bench with a pair of uprights and J-hooks at the head end, the bench press station, as boxes in its own frame.
 * The pad runs along local z, so the lifter lies the way the bench faces.
 */
export function pressBenchParts(): BenchPart[] {
  const frame: [number, number, number] = [0.15, 0.15, 0.17];
  const steel: [number, number, number] = [0.79, 0.8, 0.82];
  const parts: BenchPart[] = [
    { size: [0.3, 0.07, 1.22], at: [0, PRESS_BENCH.padTop - 0.035, 0.02], colour: [0.08, 0.08, 0.09] },
    { size: [0.08, 0.06, 1.1], at: [0, 0.32, 0.02], colour: frame },
    { size: [1.16, 0.05, 0.05], at: [0, 0.12, -0.62], colour: frame },
  ];
  for (const end of [-0.48, 0.5]) {
    parts.push({ size: [0.06, 0.32, 0.06], at: [0, 0.17, end], colour: frame }, { size: [0.42, 0.05, 0.08], at: [0, 0.025, end], colour: frame });
  }
  for (const side of [-1, 1]) {
    parts.push(
      { size: [0.06, 1.18, 0.06], at: [side * 0.55, 0.59, -0.62], colour: frame },
      { size: [0.06, 0.05, 0.62], at: [side * 0.55, 0.025, -0.56], colour: frame },
      // The J-hook: a short arm toward the lifter with a lip to keep the bar on.
      { size: [0.05, 0.03, 0.12], at: [side * 0.55, PRESS_BENCH.rack.y - 0.03, PRESS_BENCH.rack.z - 0.06], colour: steel, steel: true },
      { size: [0.05, 0.06, 0.02], at: [side * 0.55, PRESS_BENCH.rack.y, PRESS_BENCH.rack.z + 0.01], colour: steel, steel: true },
    );
  }
  return parts;
}

/** The press bench as loose meshes, for previews; rooms merge `pressBenchParts` into their own geometry. */
export function buildPressBench(scene: Scene, x: number, z: number, yaw: number) {
  const meshes = pressBenchParts().map((part) => {
    const mesh = MeshBuilder.CreateBox("press bench part", { width: part.size[0], height: part.size[1], depth: part.size[2] }, scene);
    const [px, pz] = turned(x, z, yaw, part.at[0], part.at[2]);
    mesh.position.set(px, part.at[1], pz);
    mesh.rotation.y = yaw;
    mesh.material = material(scene, new Color3(...part.colour).toHexString(), part.steel);
    mesh.isPickable = false;
    return mesh;
  });
  return {
    at: (localX: number, localY: number, localZ: number) => {
      const [px, pz] = turned(x, z, yaw, localX, localZ);
      return { x: px, y: localY, z: pz };
    },
    dispose() {
      for (const mesh of meshes) mesh.dispose();
    },
  };
}
