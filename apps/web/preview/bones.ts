import "@babylonjs/loaders/glTF";
import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { Vector3 } from "@babylonjs/core/Maths/math";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
const engine = new Engine(document.getElementById("c") as HTMLCanvasElement, true);
const scene = new Scene(engine);
new FreeCamera("c", new Vector3(0, 1, 4), scene);
const out: Record<string, Record<string, string>> = {};
for (const body of ["male", "female"]) {
  const c = await LoadAssetContainerAsync(`/assets/characters/resident-${body}-v2.glb`, scene);
  const sk = c.skeletons[0]!;
  out[body] = {};
  for (const name of ["spine_02", "spine_03", "clavicle_l", "upperarm_l", "lowerarm_l", "thigh_l", "calf_l"]) {
    const bone = sk.bones.find((b) => b.name.endsWith(name))!;
    const child = bone.getChildren()[0];
    const t = child?.getTransformNode()?.position ?? child?.getLocalMatrix().getTranslation();
    out[body][name] = t ? `${t.x.toFixed(3)},${t.y.toFixed(3)},${t.z.toFixed(3)}` : "none";
  }
}
(window as unknown as { result: unknown }).result = out;
(window as unknown as { ready: boolean }).ready = true;
