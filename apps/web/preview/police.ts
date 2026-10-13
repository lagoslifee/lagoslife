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
import type { CharacterAppearance } from "@lagos-living/shared";
import { AvatarFactory } from "../src/game/avatar";
import { equipPolice } from "../src/game/security-kit";
const canvas = document.getElementById("c") as HTMLCanvasElement;
const engine = new Engine(canvas, true);
const scene = new Scene(engine);
scene.clearColor = new Color4(0.75, 0.82, 0.9, 1);
const p = new URLSearchParams(location.search);
const cam = new FreeCamera("cam", new Vector3(Number(p.get("x") ?? 0.6), Number(p.get("y") ?? 1.5), Number(p.get("z") ?? 3.4)), scene);
cam.setTarget(new Vector3(0, Number(p.get("ty") ?? 1.1), 0));
new HemisphericLight("h", new Vector3(0.3, 1, -0.4), scene).intensity = 0.9;
new DirectionalLight("d", new Vector3(-0.5, -1, -0.6), scene).intensity = 1.5;
MeshBuilder.CreateGround("g", { width: 20, height: 20 }, scene);
const avatars = await AvatarFactory.load(scene);
const looks: CharacterAppearance[] = [
  { body: "male", skinTone: "rich", hairstyle: "low-fade", outfit: "police-uniform", accessory: "cap" },
  { body: "female", skinTone: "deep", hairstyle: "buns", outfit: "police-uniform", accessory: "cap" },
  { body: "male", skinTone: "deep", hairstyle: "low-fade", outfit: "police-uniform", accessory: "cap" },
  { body: "female", skinTone: "warm", hairstyle: "buns", outfit: "police-uniform", accessory: "cap" },
];
looks.forEach((look, i) => {
  const a = avatars.create(`p${i}`, look);
  a.root.position.set(i * 0.9 - 1.35, 0, 0);
  a.root.rotation.y = i >= 2 ? Math.PI : 0;
  if (!p.has("bare")) equipPolice(scene, a);
  if (p.has("slim")) a.setBuild(Number(p.get("slim")));
  scene.onBeforeRenderObservable.add(() => a.update(0, "idle", engine.getDeltaTime() / 1000));
});
engine.runRenderLoop(() => scene.render());
setTimeout(() => ((window as unknown as { ready: boolean }).ready = true), 4000);
if (p.has("bones")) setTimeout(() => {
  const probe = scene.getTransformNodeByName("avatar p0")!;
  const nodes = probe.getChildTransformNodes(false).map((n) => `${n.name} s=${n.scaling.toString()}`);
  console.error("NODES", nodes.join(" | "));
  const groups = scene.animationGroups.filter((g) => g.name.startsWith("p0:")).slice(0, 1);
  for (const g of groups) console.error("ANIM", g.name, [...new Set(g.targetedAnimations.map((t) => t.animation.targetProperty))].join(","));
}, 3000);
setTimeout(() => {
  const a = avatars.create("probe", looks[1]!);
  a.root.position.set(5, 0, 0);
  a.update(0, "idle", 0.016);
  scene.render();
}, 2500);
setTimeout(() => {
  const probe = scene.getTransformNodeByName("avatar probe")!;
  const body = probe.getChildMeshes(false).find((m) => m.name.endsWith(":Outfit"))!;
  const pos = body.getPositionData(true, true)!;
  const wm = body.getWorldMatrix();
  for (const y0 of [0.9, 0.95, 1.0, 1.1, 1.2, 1.3, 1.35, 1.4]) {
    let zmin = 9, zmax = -9, xmin = 9, xmax = -9;
    for (let i = 0; i < pos.length; i += 3) {
      const w = Vector3.TransformCoordinates(new Vector3(pos[i]!, pos[i + 1]!, pos[i + 2]!), wm);
      if (Math.abs(w.y - y0) > 0.025) continue;
      if (Math.abs(w.x - 5.0) < 0.08) { zmin = Math.min(zmin, w.z); zmax = Math.max(zmax, w.z); }
      if (Math.abs(w.z + 0.04) < 0.1) { xmin = Math.min(xmin, w.x); xmax = Math.max(xmax, w.x); }
    }
    console.error("SLICE", y0, "z", zmin.toFixed(3), zmax.toFixed(3), "x", (xmin - 5).toFixed(3), (xmax - 5).toFixed(3));
  }
}, 3500);
