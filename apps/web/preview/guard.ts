import "@babylonjs/core/Meshes/instancedMesh";
import "@babylonjs/loaders/glTF";
import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { AvatarFactory } from "../src/game/avatar";
import { equipSecurity, securityLook } from "../src/game/security-kit";
const canvas = document.getElementById("c") as HTMLCanvasElement;
const engine = new Engine(canvas, true);
const scene = new Scene(engine);
scene.clearColor = new Color4(0.75, 0.82, 0.9, 1);
const p = new URLSearchParams(location.search);
const cam = new FreeCamera("cam", new Vector3(Number(p.get("x") ?? 1.5), 1.5, Number(p.get("z") ?? 3.2)), scene);
cam.setTarget(new Vector3(0, 1.1, 0));
new HemisphericLight("h", new Vector3(0.3, 1, -0.4), scene).intensity = 0.9;
new DirectionalLight("d", new Vector3(-0.5, -1, -0.6), scene).intensity = 1.5;
MeshBuilder.CreateGround("g", { width: 20, height: 20 }, scene);
const avatars = await AvatarFactory.load(scene);
for (let i = 0; i < 3; i++) {
  const a = avatars.create(`g${i}`, securityLook(i));
  a.root.position.set(i * 1.1 - 1.1, 0, 0);
  a.root.rotation.y = i === 2 ? Math.PI : 0;
  equipSecurity(scene, a, i !== 1);
  scene.onBeforeRenderObservable.add(() => a.update(0, "idle", engine.getDeltaTime() / 1000));
}
engine.runRenderLoop(() => scene.render());
setTimeout(() => ((window as unknown as { ready: boolean }).ready = true), 4000);
setTimeout(() => {
  const a = avatars.create("probe", securityLook(0));
  a.root.position.set(5, 0, 0);
  a.update(0, "idle", 0.016);
  scene.render();
  const holder = (a as unknown as { instance: { holder: import("@babylonjs/core/Meshes/transformNode").TransformNode; body: import("@babylonjs/core/Meshes/abstractMesh").AbstractMesh } }).instance;
  const body = holder.body;
  body.refreshBoundingInfo({ applySkeleton: true });
  const bb = body.getBoundingInfo().boundingBox;
  console.error("BB", JSON.stringify({ min: bb.minimumWorld, max: bb.maximumWorld }));
  const sk = body.skeleton!;
  for (const b of sk.bones) if (/spine|neck|pelvis|clavicle|upperarm/.test(b.name)) { const p = b.getAbsolutePosition(body); console.error("BONE", b.name, p.x.toFixed(3), p.y.toFixed(3), p.z.toFixed(3)); }
  const sample: number[] = [];
  const pos = body.getVerticesData("position")!;
  console.error("VERTS", pos.length / 3);
}, 3000);
setTimeout(() => {
  const probe = scene.getTransformNodeByName("avatar probe")!;
  const body = probe.getChildMeshes(false).find((m) => m.name.endsWith(":Outfit"))!;
  const pos = body.getPositionData(true, true)!;
  const wm = body.getWorldMatrix();
  const { Vector3: V } = { Vector3 };
  for (const y0 of [1.0, 1.1, 1.2, 1.3, 1.4, 1.45]) {
    let zmin = 9, zmax = -9, xmin = 9, xmax = -9;
    for (let i = 0; i < pos.length; i += 3) {
      const w = V.TransformCoordinates(new V(pos[i]!, pos[i + 1]!, pos[i + 2]!), wm);
      if (Math.abs(w.y - y0) > 0.025) continue;
      if (Math.abs(w.x - 5.04) < 0.08) { zmin = Math.min(zmin, w.z); zmax = Math.max(zmax, w.z); }
      if (Math.abs(w.z + 0.04) < 0.1) { xmin = Math.min(xmin, w.x); xmax = Math.max(xmax, w.x); }
    }
    console.error("SLICE", y0, "z", zmin.toFixed(3), zmax.toFixed(3), "x", (xmin - 5).toFixed(3), (xmax - 5).toFixed(3));
  }
}, 3500);
