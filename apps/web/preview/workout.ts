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
import { AvatarFactory, type Workout } from "../src/game/avatar";
import { PropLibrary } from "../src/game/props";
const canvas = document.getElementById("c") as HTMLCanvasElement;
const engine = new Engine(canvas, true);
const scene = new Scene(engine);
scene.clearColor = new Color4(0.75, 0.82, 0.9, 1);
const p = new URLSearchParams(location.search);
const cam = new FreeCamera("cam", new Vector3(Number(p.get("x") ?? 1.5), Number(p.get("y") ?? 1.8), Number(p.get("z") ?? 4.5)), scene);
cam.setTarget(new Vector3(0, 0.9, 0));
new HemisphericLight("h", new Vector3(0.3, 1, -0.4), scene).intensity = 0.9;
new DirectionalLight("d", new Vector3(-0.5, -1, -0.6), scene).intensity = 1.5;
MeshBuilder.CreateGround("g", { width: 20, height: 20 }, scene);
const avatars = await AvatarFactory.load(scene);
const props = await PropLibrary.load(scene, []);
const time = Number(p.get("t") ?? 0.5);
const kinds: Workout[] = ["treadmill", "bench", "dumbbells"];
const stations = { treadmill: "treadmill", bench: "weight-bench", dumbbells: "dumbbell-rack" } as const;
await props.ensure(Object.values(stations));
const keep: Array<{ dispose(): void }> = [];
kinds.forEach((kind, i) => {
  const x = i * 1.8 - 1.8;
  const pose = workoutPose(kind);
  props.place(stations[kind], x + pose.prop[0], pose.prop[1], pose.propYaw, keep);
  const a = avatars.create(`w${i}`, { body: i === 1 ? "female" : "male", skinTone: "rich", hairstyle: "low-fade", outfit: "athleisure", accessory: "none" });
  a.root.position.set(x, pose.y, 0);
  a.setBuild(Number(p.get("build") ?? 0.3));
  scene.onBeforeRenderObservable.add(() => {
    a.update(pose.speed, pose.motion, 0.016);
    a.exercise(kind, time);
  });
});
function workoutPose(kind: Workout) {
  if (kind === "treadmill") return { motion: "walk" as const, speed: 3.2, y: 0.22, prop: [0, 0.15] as const, propYaw: 0 };
  if (kind === "bench") return { motion: "sit" as const, speed: 0, y: 0, prop: [0, -0.2] as const, propYaw: 0 };
  return { motion: "idle" as const, speed: 0, y: 0, prop: [0, -0.9] as const, propYaw: 0 };
}
engine.runRenderLoop(() => scene.render());
setTimeout(() => ((window as unknown as { ready: boolean }).ready = true), 4000);
