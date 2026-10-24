import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { Scene } from "@babylonjs/core/scene";

type Bit = { x: number; y: number; z: number; vx: number; vy: number; vz: number; spin: number; age: number; life: number; size: number };

const SPARKS = 28;
const DEBRIS = 16;
const GRAVITY = 9.8;

/**
 * A crash you can see and feel: sparks and bits of trim thrown from the point of contact, a camera jolt scaled to
 * the speed of the hit, and a buzz on phones that can vibrate. Each kind of bit is one thin-instanced mesh, so a
 * pile-up costs two draw calls and nothing at all once the bits have settled.
 */
export class ImpactFx {
  private readonly sparks: Mesh;
  private readonly debris: Mesh;
  private readonly sparkBits: Bit[] = [];
  private readonly debrisBits: Bit[] = [];
  private readonly sparkMatrices = new Float32Array(SPARKS * 16);
  private readonly debrisMatrices = new Float32Array(DEBRIS * 16);
  private shakeLeft = 0;
  private shakeStrength = 0;
  private time = 0;

  constructor(scene: Scene, private readonly ground: (x: number, z: number) => number) {
    const sparkMaterial = new StandardMaterial("impact sparks", scene);
    sparkMaterial.disableLighting = true;
    sparkMaterial.emissiveColor = new Color3(1, 0.72, 0.28);
    this.sparks = MeshBuilder.CreateBox("impact sparks", { size: 1 }, scene);
    this.sparks.material = sparkMaterial;
    const debrisMaterial = new StandardMaterial("impact debris", scene);
    debrisMaterial.diffuseColor = new Color3(0.2, 0.2, 0.22);
    debrisMaterial.specularColor = new Color3(0.3, 0.3, 0.3);
    this.debris = MeshBuilder.CreateBox("impact debris", { size: 1 }, scene);
    this.debris.material = debrisMaterial;
    for (const [mesh, matrices] of [[this.sparks, this.sparkMatrices], [this.debris, this.debrisMatrices]] as const) {
      mesh.isPickable = false;
      mesh.alwaysSelectAsActiveMesh = true;
      mesh.thinInstanceSetBuffer("matrix", matrices, 16, false);
      mesh.thinInstanceCount = 0;
      mesh.setEnabled(false);
    }
  }

  /** `severity` 0..1 (a parking-speed tap to a full-speed wreck); `dir` is the way the car was travelling. */
  burst(x: number, y: number, z: number, dirX: number, dirZ: number, severity: number) {
    const s = Math.max(0.15, Math.min(1, severity));
    const throwOut = (bits: Bit[], count: number, spark: boolean) => {
      bits.length = 0;
      for (let index = 0; index < count; index += 1) {
        const angle = Math.atan2(dirX, dirZ) + Math.PI + (Math.random() - 0.5) * 2.6;
        const speed = (spark ? 3 + Math.random() * 6 : 1.5 + Math.random() * 3) * (0.5 + s);
        bits.push({
          x: x + (Math.random() - 0.5) * 0.4,
          y: y + Math.random() * 0.4,
          z: z + (Math.random() - 0.5) * 0.4,
          vx: Math.sin(angle) * speed,
          vy: (spark ? 1.5 : 2) + Math.random() * 3 * s,
          vz: Math.cos(angle) * speed,
          spin: (Math.random() - 0.5) * 14,
          age: 0,
          life: spark ? 0.35 + Math.random() * 0.4 : 2.5 + Math.random() * 1.5,
          size: spark ? 0.025 + Math.random() * 0.025 : 0.05 + Math.random() * 0.07 * s,
        });
      }
    };
    throwOut(this.sparkBits, Math.round(SPARKS * (0.4 + 0.6 * s)), true);
    throwOut(this.debrisBits, s > 0.3 ? Math.round(DEBRIS * s) : 0, false);
    this.sparks.setEnabled(true);
    this.debris.setEnabled(this.debrisBits.length > 0);
    this.shakeStrength = 0.06 + 0.22 * s;
    this.shakeLeft = 0.25 + 0.35 * s;
    try {
      navigator.vibrate?.(Math.round(40 + 120 * s));
    } catch {
      // Vibration is a nicety; some browsers throw when it is blocked.
    }
  }

  /** Camera offset for this frame; zero once the jolt has died away. */
  shake(dt: number, out: Vector3) {
    this.time += dt;
    if (this.shakeLeft <= 0) return out.setAll(0);
    this.shakeLeft -= dt;
    const amount = this.shakeStrength * Math.max(0, this.shakeLeft) * 2.5;
    const t = this.time * 38;
    return out.set(Math.sin(t) * amount, Math.sin(t * 1.3 + 1) * amount * 0.6, Math.cos(t * 0.9) * amount);
  }

  update(dt: number) {
    this.step(this.sparks, this.sparkBits, this.sparkMatrices, dt, true);
    this.step(this.debris, this.debrisBits, this.debrisMatrices, dt, false);
  }

  private step(mesh: Mesh, bits: Bit[], matrices: Float32Array, dt: number, spark: boolean) {
    if (!mesh.isEnabled()) return;
    let live = 0;
    const scale = new Vector3();
    const rotation = new Quaternion();
    const position = new Vector3();
    const matrix = new Matrix();
    for (const bit of bits) {
      bit.age += dt;
      if (bit.age >= bit.life) continue;
      bit.vy -= GRAVITY * dt;
      bit.x += bit.vx * dt;
      bit.y += bit.vy * dt;
      bit.z += bit.vz * dt;
      const floor = this.ground(bit.x, bit.z) + bit.size / 2;
      if (bit.y < floor) {
        bit.y = floor;
        bit.vy = Math.abs(bit.vy) * 0.3;
        bit.vx *= 0.6;
        bit.vz *= 0.6;
        bit.spin *= 0.5;
      }
      const fade = spark ? 1 - bit.age / bit.life : Math.min(1, (bit.life - bit.age) / 0.5);
      if (spark) scale.set(bit.size, bit.size, bit.size * (2 + Math.hypot(bit.vx, bit.vz) * 0.5)).scaleInPlace(fade);
      else scale.set(bit.size, bit.size * 0.4, bit.size * 1.3).scaleInPlace(fade);
      Quaternion.RotationYawPitchRollToRef(Math.atan2(bit.vx, bit.vz), spark ? -Math.atan2(bit.vy, Math.hypot(bit.vx, bit.vz)) : bit.age * bit.spin, spark ? 0 : bit.age * bit.spin * 0.7, rotation);
      position.set(bit.x, bit.y, bit.z);
      Matrix.ComposeToRef(scale, rotation, position, matrix);
      matrix.copyToArray(matrices, live * 16);
      live += 1;
    }
    mesh.thinInstanceCount = live;
    mesh.thinInstanceBufferUpdated("matrix");
    if (!live) {
      mesh.setEnabled(false);
      bits.length = 0;
    }
  }

  dispose() {
    this.sparks.dispose(false, true);
    this.debris.dispose(false, true);
  }
}
