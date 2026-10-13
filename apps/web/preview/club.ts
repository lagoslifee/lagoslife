import "@babylonjs/core/Meshes/instancedMesh";
import "@babylonjs/loaders/glTF";
import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import { CLUBS, INTERIOR_ORIGIN } from "@lagos-living/shared";
import { createMaterials } from "../src/game/materials";
import { SignAtlas } from "../src/game/sign-atlas";
import { buildInterior } from "../src/game/interior";
import { AvatarFactory } from "../src/game/avatar";
import { buildMenuItem, buildServingTray } from "../src/game/drinks";
import { clubWaitress } from "../src/game/service-staff";
const canvas = document.getElementById("c") as HTMLCanvasElement;
const engine = new Engine(canvas, true);
const scene = new Scene(engine);
scene.clearColor = new Color4(0.05, 0.05, 0.05, 1);
const p = new URLSearchParams(location.search);
const [ox, oz] = INTERIOR_ORIGIN;
const cam = new FreeCamera("cam", new Vector3(ox + Number(p.get("x") ?? 3), Number(p.get("y") ?? 2.4), oz + Number(p.get("z") ?? -4)), scene);
cam.setTarget(new Vector3(ox + Number(p.get("tx") ?? -2), Number(p.get("ty") ?? 1.0), oz + Number(p.get("tz") ?? 1)));
cam.fov = 1.0;
new HemisphericLight("h", new Vector3(0.3, 1, -0.4), scene).intensity = 0.35;
const materials = createMaterials(scene, "high" as never);
const atlas = new SignAtlas(scene, 1);
const club = CLUBS[p.get("club") ?? "eko-nights"]!;
const view = buildInterior(scene, materials as never, atlas, "club", club.id, [], club);
const avatars = await AvatarFactory.load(scene);
const [stool, stool2] = view.seats.filter((seat) => seat.stool);
const sofa = view.seats.find((seat) => !seat.stool)!;
const dubai = club.id === "pearl-club-dubai";
const people = [
  { seat: stool!, motion: "sit", look: { body: "male", skinTone: "deep", hairstyle: "low-fade", outfit: "agbada-royal", accessory: "none" } },
  { seat: stool2!, motion: "dance", look: { body: "female", skinTone: "rich", hairstyle: "braids", outfit: "lace-wine", accessory: "none" } },
  { seat: sofa, motion: "sit", look: { body: "female", skinTone: "deep", hairstyle: "long", outfit: "gown-emerald", accessory: "none" } },
] as const;
const actors = people.map((person, index) => {
  const a = avatars.create(`p${index}`, person.look as never);
  const lean = person.motion === "sit" ? 0.08 : 0;
  a.root.position.set(person.seat.at[0] + Math.sin(person.seat.yaw) * lean, person.seat.y, person.seat.at[1] + Math.cos(person.seat.yaw) * lean);
  a.root.rotation.y = person.seat.yaw;
  if (index === 0) a.hold(buildMenuItem(scene, "chapman"));
  return { a, motion: person.motion };
});
const waitress = avatars.create("w", clubWaitress(321, dubai));
waitress.root.position.set(ox - 2.2, 0.02, oz + 0.2);
waitress.root.rotation.y = Math.PI / 2;
const tray = buildServingTray(scene, "zobo");
tray.parent = waitress.root;
tray.position.set(0.05, 1.08, 0.36);
let t = 0;
scene.onBeforeRenderObservable.add(() => {
  const dt = engine.getDeltaTime() / 1000;
  t += dt;
  view.update(t);
  for (const actor of actors) actor.a.update(0, actor.motion as never, dt);
  waitress.update(0, "idle", dt);
});
engine.runRenderLoop(() => scene.render());
setTimeout(() => ((window as unknown as { ready: boolean }).ready = true), 4000);
