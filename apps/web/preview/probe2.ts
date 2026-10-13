import "@babylonjs/core/Meshes/instancedMesh";
import "@babylonjs/loaders/glTF";
import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { Axis, Quaternion, Vector3 } from "@babylonjs/core/Maths/math";
import { AvatarFactory } from "../src/game/avatar";
const engine = new Engine(document.getElementById("c") as HTMLCanvasElement, true);
const scene = new Scene(engine);
new FreeCamera("cam", new Vector3(0, 1, 5), scene);
const avatars = await AvatarFactory.load(scene);
const a = avatars.create("p", { body: "male", skinTone: "rich", hairstyle: "low-fade", outfit: "athleisure", accessory: "none" });
type J = { rotationQuaternion: Quaternion; computeWorldMatrix(f: boolean): void; getAbsolutePosition(): Vector3 };
const limbs = (a as unknown as { instance: { limbs: Record<string, J> } }).instance.limbs;
const child: Record<string, string> = { rightUp: "rightLow", leftUp: "leftLow", rightLow: "foot", leftLow: "foot", rightArm: "rightFore", leftArm: "leftFore", rightFore: "rightHand", leftFore: "leftHand", spine: "neck" };
let job: null | { limb: string; axis: string; angle: number } = null;
const out: Record<string, number[]> = {};
scene.onBeforeRenderObservable.add(() => {
  a.update(0, "idle", 0.016);
  if (job) {
    const j = limbs[job.limb]!;
    if (job.axis !== "none") j.rotationQuaternion.multiplyInPlace(Quaternion.RotationAxis((Axis as Record<string, Vector3>)[job.axis]!, job.angle));
  }
});
scene.onAfterRenderObservable.add(() => {
  if (!job) return;
  const target = child[job.limb]!;
  const node = target === "foot" ? (limbs[job.limb] as unknown as { getChildren(): J[] }).getChildren()[0]! : limbs[target]!;
  const base = limbs[job.limb]!;
  base.computeWorldMatrix(true); node.computeWorldMatrix(true);
  const d = node.getAbsolutePosition().subtract(base.getAbsolutePosition());
  out[`${job.limb}:${job.axis}:${job.angle}`] = [d.x, d.y, d.z].map((v) => Math.round(v * 100) / 100);
});
engine.runRenderLoop(() => scene.render());
(window as unknown as Record<string, unknown>).probe = async (limb: string, axis: string, angle: number) => { job = { limb, axis, angle }; await new Promise((r) => setTimeout(r, 300)); return out[`${limb}:${axis}:${angle}`]; };
setTimeout(() => ((window as unknown as { ready: boolean }).ready = true), 3000);
