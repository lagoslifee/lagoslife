import "@babylonjs/core/Meshes/instancedMesh";
import "@babylonjs/loaders/glTF";
import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import { INTERIOR_ORIGIN } from "@lagos-living/shared";
import { createMaterials } from "../src/game/materials";
import { SignAtlas } from "../src/game/sign-atlas";
import { buildInterior, interiorModels } from "../src/game/interior";
import { HOME_LAYOUTS } from "@lagos-living/shared";
import { PropLibrary } from "../src/game/props";
import { Blanket } from "../src/game/bedding";
import { AvatarFactory } from "../src/game/avatar";
const canvas = document.getElementById("c") as HTMLCanvasElement;
const engine = new Engine(canvas, true);
const scene = new Scene(engine);
scene.clearColor = new Color4(0.05, 0.05, 0.05, 1);
const p = new URLSearchParams(location.search);
const [ox, oz] = INTERIOR_ORIGIN;
const cam = new FreeCamera("cam", new Vector3(ox + Number(p.get("x") ?? 0), Number(p.get("y") ?? 6), oz + Number(p.get("z") ?? -5)), scene);
cam.setTarget(new Vector3(ox + Number(p.get("tx") ?? 0), Number(p.get("ty") ?? 0.5), oz + Number(p.get("tz") ?? 0.5)));
cam.fov = 1.1;
new HemisphericLight("h", new Vector3(0.3, 1, -0.4), scene).intensity = 0.5;
const materials = createMaterials(scene, "high" as never);
const atlas = new SignAtlas(scene, 1);
const placements = [
  { itemId: "dining-set", gridX: 0, gridZ: 0, rotation: 0, x: 2.6, z: 2.4 },
  { itemId: "ikoyi-sectional", gridX: 0, gridZ: 0, rotation: 0, x: -2.4, z: -1.0 },
  { itemId: "eko-king-bed", gridX: 0, gridZ: 0, rotation: Number(p.get("bed") ?? 180), x: -3.0, z: 2.9 },
  { itemId: "velvet-armchair", gridX: 0, gridZ: 0, rotation: 90, x: 1.0, z: -2.0 },
  { itemId: "lagoon-sofa", gridX: 0, gridZ: 0, rotation: 270, x: 4.2, z: -1.6 },
];
const layout = HOME_LAYOUTS[(p.get("tier") ?? "flat") as keyof typeof HOME_LAYOUTS];
const props = await PropLibrary.load(scene, []);
await props.ensure(interiorModels("home", layout, placements as never));
const view = buildInterior(scene, materials as never, atlas, (p.get("kind") ?? "home") as never, "Test home", placements as never, undefined, { props, layout } as never);
const avatars = await AvatarFactory.load(scene);
const looks = ["male", "female"] as const;
const actors = view.seats.map((seat, index) => {
  const a = avatars.create(`p${index}`, { body: looks[index % 2], skinTone: "rich", hairstyle: index % 2 ? "braids" : "low-fade", outfit: "athleisure", accessory: "none" } as never);
  const lying = seat.rest === "bed";
  const lean = 0;
  a.root.position.set(seat.at[0] + Math.sin(seat.yaw) * lean, seat.y, seat.at[1] + Math.cos(seat.yaw) * lean);
  a.root.rotation.y = seat.yaw;
  a.root.rotation.x = lying ? -Math.PI / 2 : 0;
  if (lying && !p.get("nosheet")) new Blanket(scene).show(seat.at[0], seat.y - 0.09, seat.at[1], seat.yaw, seat.width ?? 1.3);
  return { a, lying };
});
console.log("seats", view.seats.length, view.spots.map((s) => s.id).join(","));
scene.onBeforeRenderObservable.add(() => {
  const dt = engine.getDeltaTime() / 1000;
  const t = Number(p.get("t") ?? performance.now() / 1000);
  for (const actor of actors) {
    actor.a.update(0, actor.lying ? "idle" : "sit", dt);
    if (actor.lying) actor.a.sleep(t);
    else {
      if (view.seats[actors.indexOf(actor)]!.rest === "sofa") actor.a.lounge(t);
      actor.a.seatHips(view.seats[actors.indexOf(actor)]!.y, view.seats[actors.indexOf(actor)]!.at);
    }
  }
});
engine.runRenderLoop(() => scene.render());
setTimeout(() => ((window as unknown as { ready: boolean }).ready = true), 4000);
setTimeout(() => {
  for (const [i, actor] of actors.entries()) {
    const limbs = (actor.a as unknown as { instance: { limbs: Record<string, import("@babylonjs/core/Meshes/transformNode").TransformNode> } }).instance.limbs;
    limbs.leftUp!.computeWorldMatrix(true);
    const hip = limbs.leftUp!.getAbsolutePosition();
    const seat = view.seats[i]!;
    console.error(`seat ${i} ${seat.rest} y=${seat.y.toFixed(2)} at=${(seat.at[0] - ox).toFixed(2)},${(seat.at[1] - oz).toFixed(2)} hipFwd=${((hip.x - actor.a.root.position.x) * Math.sin(seat.yaw) + (hip.z - actor.a.root.position.z) * Math.cos(seat.yaw)).toFixed(2)} hipY=${hip.y.toFixed(2)} rootY=${actor.a.root.position.y.toFixed(2)}`);
  }
}, 3500);
