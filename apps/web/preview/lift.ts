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
import { AvatarFactory, LIFT_TUNING, POSE_TUNING, SWIM_TUNING, liftDepth, type Workout } from "../src/game/avatar";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { GymGear, PRESS_BENCH, buildPressBench } from "../src/game/gym-gear";
import { PropLibrary } from "../src/game/props";
import { Book } from "../src/game/book";
const p = new URLSearchParams(location.search);
Object.assign(LIFT_TUNING, JSON.parse(p.get("l") ?? "{}"));
Object.assign(POSE_TUNING, JSON.parse(p.get("pz") ?? "{}"));
Object.assign(SWIM_TUNING, JSON.parse(p.get("sw") ?? "{}"));
const canvas = document.getElementById("c") as HTMLCanvasElement;
const engine = new Engine(canvas, true);
const scene = new Scene(engine);
scene.clearColor = new Color4(0.75, 0.82, 0.9, 1);
const cam = new FreeCamera("cam", new Vector3(Number(p.get("x") ?? 0), Number(p.get("y") ?? 1.9), Number(p.get("z") ?? 5)), scene);
cam.setTarget(new Vector3(Number(p.get("tx") ?? 0), 0.8, 0));
new HemisphericLight("h", new Vector3(0.3, 1, 0.4), scene).intensity = 0.9;
new DirectionalLight("d", new Vector3(-0.5, -1, -0.6), scene).intensity = 1.2;
MeshBuilder.CreateGround("g", { width: 20, height: 20 }, scene);
const avatars = await AvatarFactory.load(scene);
const props = await PropLibrary.load(scene, []);
await props.ensure(["weight-bench", "squat-rack", "dumbbell-rack"]);
const keep: Array<{ dispose(): void }> = [];
const time = Number(p.get("t") ?? 0);
const only = p.get("only");
const setups: Array<{ kind: Workout; x: number; prop?: string; propYaw?: number; kg: number }> = [
  { kind: "bench", x: -2, kg: 60 },
  { kind: "squat", x: 0, prop: "squat-rack", propYaw: Math.PI, kg: 100 },
  { kind: "dumbbells", x: 2, kg: 14 },
  { kind: "sleep" as Workout, x: 4, kg: 0 },
  { kind: "read" as Workout, x: 6, kg: 0 },
  { kind: "readlie" as Workout, x: 8, kg: 0 },
  { kind: "crawl" as Workout, x: -3, kg: 0 },
  { kind: "crawl2" as Workout, x: -1, kg: 0 },
  { kind: "crawl3" as Workout, x: 1, kg: 0 },
  { kind: "tread" as Workout, x: 3, kg: 0 },
  { kind: "float" as Workout, x: 5, kg: 0 },
];
const SURFACE = 1.0;
if (p.get("water")) {
  const water = MeshBuilder.CreateGround("water", { width: 20, height: 20 }, scene);
  water.position.y = SURFACE;
  const wm = new StandardMaterial("wm", scene);
  wm.diffuseColor = Color3.FromHexString("#3fb6d9");
  wm.alpha = 0.45;
  water.material = wm;
}
for (const s of setups.filter((s) => !only || s.kind === only)) {
  if (s.prop) props.place(s.prop as never, s.x, 0, s.propYaw ?? 0, keep);
  const bench = s.kind === "bench" ? buildPressBench(scene, s.x, 0, Number(p.get("lieYaw") ?? 0)) : null;
  if (p.get("noav")) {
    if (bench) {
      const r = bench.at(0, PRESS_BENCH.rack.y, PRESS_BENCH.rack.z);
      new GymGear(scene, "barbell", s.kg).rest(r.x, r.y, r.z, Number(p.get("lieYaw") ?? 0));
    }
    continue;
  }
  const a = avatars.create(`w${s.kind}`, { body: "male", skinTone: "rich", hairstyle: "low-fade", outfit: "athleisure", accessory: "none" });
  a.setBuild(0.5);
  const gear = new GymGear(scene, s.kind === "dumbbells" ? "dumbbells" : "barbell", s.kg || 20);
  const book = new Book(scene, "#b5462a");
  const yaw = s.kind === "bench" ? Number(p.get("lieYaw") ?? 0) : 0;
  scene.onBeforeRenderObservable.add(() => {
    a.root.rotation.y = yaw;
    if (s.kind === "bench" && p.get("stand")) a.root.position.set(s.x, 0, 0);
    else if (s.kind === "bench") {
      a.root.rotation.x = -Math.PI / 2;
      const at = bench!.at(0, Number(p.get("by") ?? PRESS_BENCH.lifter.y), Number(p.get("bz") ?? PRESS_BENCH.lifter.z));
      a.root.position.set(at.x, at.y, at.z);
    } else a.root.position.set(s.x, s.kind === "squat" ? -Number(p.get("drop") ?? 0.42) * liftDepth("squat", time) : 0, 0);
    a.update(0, "idle", 0.016);
    if ((s.kind as string) === "read") {
      a.root.position.set(s.x, 0, 0);
      a.update(0, "sit", 0.5);
      a.read(time);
      a.seatHips(0.45, [s.x, 0]);
      book.follow(a, time);
      return;
    }
    if ((s.kind as string) === "readlie") {
      a.root.rotation.x = -Math.PI / 2;
      a.root.position.set(s.x, 0.3, 0.9);
      a.read(time, true);
      book.follow(a, time);
      return;
    }
    const swim = (s.kind as string).replace(/\d$/, "");
    if (swim === "crawl" || swim === "tread" || swim === "float") {
      a.root.rotation.x = 0;
      a.root.position.set(s.x, 0, 0);
      a.root.rotation.y = Number(p.get("syaw") ?? 0);
      const offset = (s.kind as string).endsWith("2") ? 0.6 : (s.kind as string).endsWith("3") ? 1.2 : 0;
      a.swim(time + offset, swim, SURFACE);
      return;
    }
    if ((s.kind as string) === "sleep") {
      a.root.rotation.x = -Math.PI / 2;
      a.root.position.set(s.x, 0.3, 0.9);
      a.sleep(time);
      return;
    }
    a.exercise(s.kind, time, Number(p.get("strain") ?? 0));
    gear.follow(a, yaw, s.kind === "squat");
  });
}
engine.runRenderLoop(() => scene.render());
setTimeout(() => ((window as unknown as { ready: boolean }).ready = true), 5000);
