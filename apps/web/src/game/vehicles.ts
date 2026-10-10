import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import type { Material } from "@babylonjs/core/Materials/material";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Matrix } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { getVehicleModel, type VehicleModel } from "@lagos-living/shared";
import type { Materials } from "./materials";

type Part = "paint" | "glass" | "trim" | "lamp" | "tail";
const PARTS: Part[] = ["paint", "glass", "trim", "lamp", "tail"];

function box(scene: Scene, width: number, height: number, depth: number, x: number, y: number, z: number) {
  const mesh = MeshBuilder.CreateBox("vehicle part", { width, height, depth }, scene);
  mesh.bakeTransformIntoVertices(Matrix.Translation(x, y, z));
  return mesh;
}

/** Procedural body per style, sized from the catalogue so collisions match what is drawn. */
function buildTemplate(scene: Scene, model: VehicleModel) {
  const { length: L, width: W, height: H } = model;
  const tall = model.body === "suv" || model.body === "pickup";
  const wheel = tall ? 0.74 : 0.64;
  const clearance = wheel * (tall ? 0.42 : 0.3);
  const lower = H * (tall ? 0.36 : 0.38);
  const lowerTop = clearance + lower;
  const roofY = H - 0.05;
  const cabin = {
    hatch: { length: L * 0.56, z: -L * 0.1 },
    saloon: { length: L * 0.44, z: -L * 0.04 },
    suv: { length: L * 0.66, z: -L * 0.1 },
    pickup: { length: L * 0.34, z: L * 0.08 },
  }[model.body];
  const parts: Record<Part, Mesh[]> = { paint: [], glass: [], trim: [], lamp: [], tail: [] };

  parts.paint.push(box(scene, W, lower, L, 0, clearance + lower / 2, 0));
  parts.paint.push(box(scene, W * 0.97, 0.08, L * 0.36, 0, lowerTop + 0.04, L / 2 - L * 0.18));
  parts.glass.push(box(scene, W * 0.86, roofY - lowerTop, cabin.length, 0, (lowerTop + roofY) / 2, cabin.z));
  parts.paint.push(box(scene, W * 0.9, 0.07, cabin.length * 0.94, 0, roofY + 0.02, cabin.z));
  for (const side of [-1, 1]) {
    parts.paint.push(box(scene, 0.06, roofY - lowerTop, 0.12, side * W * 0.43, (lowerTop + roofY) / 2, cabin.z + cabin.length / 2 - 0.08));
  }
  if (model.body === "pickup") {
    const bedFront = cabin.z - cabin.length / 2;
    const bedLength = bedFront + L / 2 - 0.05;
    const bedZ = bedFront - bedLength / 2;
    for (const side of [-1, 1]) parts.paint.push(box(scene, 0.07, 0.38, bedLength, side * (W / 2 - 0.035), lowerTop + 0.19, bedZ));
    parts.paint.push(box(scene, W, 0.38, 0.07, 0, lowerTop + 0.19, -L / 2 + 0.035));
    parts.trim.push(box(scene, W * 0.92, 0.04, bedLength, 0, lowerTop + 0.01, bedZ));
  }
  parts.trim.push(box(scene, W * 1.02, 0.18, 0.14, 0, clearance + 0.12, L / 2));
  parts.trim.push(box(scene, W * 1.02, 0.18, 0.14, 0, clearance + 0.12, -L / 2));
  parts.trim.push(box(scene, W * 0.42, 0.12, 0.02, 0, clearance + 0.32, -L / 2 - 0.075));
  for (const side of [-1, 1]) {
    parts.lamp.push(box(scene, W * 0.22, 0.12, 0.04, side * W * 0.34, lowerTop - 0.12, L / 2 + 0.01));
    parts.tail.push(box(scene, W * 0.2, 0.14, 0.04, side * W * 0.36, lowerTop - 0.12, -L / 2 - 0.01));
  }
  const axle = model.wheelbase / 2;
  for (const [x, z] of [[-1, 1], [1, 1], [-1, -1], [1, -1]] as const) {
    const tyre = MeshBuilder.CreateCylinder("vehicle tyre", { diameter: wheel, height: 0.24, tessellation: 14 }, scene);
    tyre.bakeTransformIntoVertices(Matrix.RotationZ(Math.PI / 2).multiply(Matrix.Translation(x * (W / 2 - 0.1), wheel / 2, z * axle)));
    parts.trim.push(tyre);
  }

  return PARTS.map((part) => {
    const merged = Mesh.MergeMeshes(parts[part], true, true)!;
    merged.name = `${model.id} ${part}`;
    merged.isPickable = false;
    merged.setEnabled(false);
    return merged;
  });
}

type Sample = { t: number; x: number; z: number; yaw: number };

export class VehicleView {
  readonly root: TransformNode;
  readonly model: VehicleModel;
  private samples: Sample[] = [];

  constructor(
    readonly id: string,
    readonly meshes: Mesh[],
    root: TransformNode,
    model: VehicleModel,
  ) {
    this.root = root;
    this.model = model;
  }

  get x() {
    return this.root.position.x;
  }

  get z() {
    return this.root.position.z;
  }

  get yaw() {
    return this.root.rotation.y;
  }

  setPose(x: number, y: number, z: number, yaw: number) {
    this.root.position.set(x, y, z);
    this.root.rotation.y = yaw;
  }

  push(t: number, x: number, z: number, yaw: number) {
    const last = this.samples.at(-1);
    if (last && Math.hypot(last.x - x, last.z - z) > 40) this.samples = [];
    this.samples.push({ t, x, z, yaw });
    if (this.samples.length > 10) this.samples.shift();
  }

  /** Interpolated pose ~120 ms in the past, matching remote players. */
  sample(now: number) {
    const samples = this.samples;
    if (!samples.length) return null;
    const renderTime = now - 120;
    let a = samples[0]!;
    let b = samples[samples.length - 1]!;
    for (let index = 1; index < samples.length; index += 1) {
      if (samples[index]!.t >= renderTime) {
        a = samples[index - 1]!;
        b = samples[index]!;
        break;
      }
    }
    const t = Math.max(0, Math.min(1, (renderTime - a.t) / Math.max(1, b.t - a.t)));
    let dyaw = b.yaw - a.yaw;
    dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
    return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, yaw: a.yaw + dyaw * t };
  }

  /** Pushes a walker's circle out of the car's oriented footprint. */
  pushOut(px: number, pz: number, radius: number): [number, number] {
    const yaw = this.yaw;
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const dx = px - this.x;
    const dz = pz - this.z;
    const along = dx * fx + dz * fz;
    const across = dx * fz - dz * fx;
    const halfL = this.model.length / 2 + radius;
    const halfW = this.model.width / 2 + radius;
    if (Math.abs(along) >= halfL || Math.abs(across) >= halfW) return [px, pz];
    const pushAlong = halfL - Math.abs(along);
    const pushAcross = halfW - Math.abs(across);
    if (pushAcross < pushAlong) {
      const shift = Math.sign(across || 1) * pushAcross;
      return [px + fz * shift, pz - fx * shift];
    }
    const shift = Math.sign(along || 1) * pushAlong;
    return [px + fx * shift, pz + fz * shift];
  }

  dispose() {
    for (const mesh of this.meshes) mesh.dispose();
    this.root.dispose();
  }
}

export class VehicleFactory {
  private templates = new Map<string, Mesh[]>();
  private paints = new Map<string, PBRMaterial>();
  private tail: PBRMaterial;

  constructor(
    private readonly scene: Scene,
    private readonly materials: Materials,
  ) {
    this.tail = new PBRMaterial("tail lamp", scene);
    this.tail.albedoColor = Color3.FromHexString("#8a0f12");
    this.tail.emissiveColor = Color3.FromHexString("#5a0508");
    this.tail.roughness = 0.3;
  }

  private paint(hex: string) {
    let material = this.paints.get(hex);
    if (!material) {
      material = new PBRMaterial(`vehicle paint ${hex}`, this.scene);
      material.albedoColor = Color3.FromHexString(hex);
      material.metallic = 0.55;
      material.roughness = 0.3;
      this.paints.set(hex, material);
    }
    return material;
  }

  create(id: string, modelId: string, colour: string) {
    const model = getVehicleModel(modelId);
    let template = this.templates.get(modelId);
    if (!template) {
      template = buildTemplate(this.scene, model);
      this.templates.set(modelId, template);
    }
    const root = new TransformNode(`vehicle ${id}`, this.scene);
    const looks: Record<Part, Material> = {
      paint: this.paint(colour),
      glass: this.materials.glass,
      trim: this.materials.rubber,
      lamp: this.materials.lamp,
      tail: this.tail,
    };
    const meshes = template.map((source, index) => {
      const mesh = source.clone(`${id} ${PARTS[index]}`, root)!;
      mesh.setEnabled(true);
      mesh.material = looks[PARTS[index]!];
      return mesh;
    });
    return new VehicleView(id, meshes, root, model);
  }
}
