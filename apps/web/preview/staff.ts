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
import { staffLook } from "../src/game/service-staff";
const canvas = document.getElementById("c") as HTMLCanvasElement;
const engine = new Engine(canvas, true);
const scene = new Scene(engine);
scene.clearColor = new Color4(0.75, 0.82, 0.9, 1);
const cam = new FreeCamera("cam", new Vector3(0, 1.4, 5.5), scene);
cam.setTarget(new Vector3(0, 1.0, 0));
new HemisphericLight("h", new Vector3(0.3, 1, 0.4), scene).intensity = 0.9;
new DirectionalLight("d", new Vector3(-0.5, -1, -0.6), scene).intensity = 1.5;
MeshBuilder.CreateGround("g", { width: 20, height: 20 }, scene);
const avatars = await AvatarFactory.load(scene);
const looks = [
  { ...staffLook(901, false, "hostess"), outfit: "ankara-dress" },
  { ...staffLook(902, true, "hostess"), outfit: "office-skirt" },
  staffLook(81, false, "hostess"),
  staffLook(82, true, "hostess"),
];
const extra = new URLSearchParams(location.search).get("looks");
const list = extra ? JSON.parse(extra) : looks;
list.forEach((look: never, i: number) => {
  const a = avatars.create(`s${i}`, look);
  a.root.position.set(i * 1.0 - (list.length - 1) / 2, 0, 0);
  a.root.rotation.y = 0;
  scene.onBeforeRenderObservable.add(() => a.update(0, "idle", engine.getDeltaTime() / 1000));
});
engine.runRenderLoop(() => scene.render());
setTimeout(() => ((window as unknown as { ready: boolean }).ready = true), 4000);
