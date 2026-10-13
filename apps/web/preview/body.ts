import "@babylonjs/core/Meshes/instancedMesh";
import "@babylonjs/loaders/glTF";
import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { Vector3 } from "@babylonjs/core/Maths/math";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import { AvatarFactory, POSE_TUNING } from "../src/game/avatar";
Object.assign(POSE_TUNING, JSON.parse(new URLSearchParams(location.search).get("t") ?? "{}"));
const canvas = document.getElementById("c") as HTMLCanvasElement;
const engine = new Engine(canvas, true);
const scene = new Scene(engine);
scene.clearColor = new Color4(0.75, 0.82, 0.9, 1);
const p = new URLSearchParams(location.search);
const cam = new FreeCamera("cam", new Vector3(0, 1.1, Number(p.get("z") ?? 5.2)), scene);
cam.setTarget(new Vector3(0, 0.95, 0));
new HemisphericLight("h", new Vector3(0.3, 1, 0.4), scene).intensity = 0.9;
new DirectionalLight("d", new Vector3(-0.3, -0.6, -1), scene).intensity = 1.2;
const avatars = await AvatarFactory.load(scene);
const list = JSON.parse(p.get("a")!);
list.forEach((entry, i) => {
  const a = avatars.create(`p${i}`, { body: "female", skinTone: "rich", hairstyle: "long", outfit: "athleisure", accessory: "none", ...entry.look });
  a.setBuild(entry.build ?? 0);
  a.root.position.set(i * 0.95 - (list.length - 1) * 0.475, 0, 0);
  let t = 0;
  if (entry.pose === "sleep") { a.root.rotation.x = -Math.PI / 2; a.root.position.y = 0.3; a.root.position.z = 0.9; }
  if (entry.yaw) a.root.rotation.y = entry.yaw;
  scene.onBeforeRenderObservable.add(() => {
    t += 0.016;
    a.update(0, entry.motion ?? "idle", 0.016);
    if (entry.pose === "sleep") a.sleep(t);
    if (entry.pose === "lounge") a.lounge(t);
  });
});
engine.runRenderLoop(() => scene.render());
setTimeout(() => ((window as unknown as { ready: boolean }).ready = true), 5000);
