import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { Scene } from "@babylonjs/core/scene";
import type { VehicleView } from "./vehicles";

const cache = new WeakMap<Scene, { sign: StandardMaterial; checks: StandardMaterial }>();

function liveryMaterials(scene: Scene) {
  const existing = cache.get(scene);
  if (existing) return existing;
  const signTexture = new DynamicTexture("taxi sign", { width: 256, height: 64 }, scene, true);
  const signContext = signTexture.getContext() as CanvasRenderingContext2D;
  signContext.fillStyle = "#f6d23a";
  signContext.fillRect(0, 0, 256, 64);
  signContext.fillStyle = "#111111";
  signContext.font = "bold 46px Arial, sans-serif";
  signContext.textAlign = "center";
  signContext.textBaseline = "middle";
  signContext.fillText("TAXI", 128, 34);
  signTexture.update();
  const sign = new StandardMaterial("taxi sign", scene);
  sign.diffuseTexture = signTexture;
  sign.emissiveTexture = signTexture;
  sign.emissiveColor = new Color3(0.55, 0.55, 0.55);
  sign.specularColor = Color3.Black();

  const checkTexture = new DynamicTexture("taxi checks", { width: 256, height: 32 }, scene, true);
  const checkContext = checkTexture.getContext() as CanvasRenderingContext2D;
  for (let column = 0; column < 16; column += 1) {
    for (let row = 0; row < 2; row += 1) {
      checkContext.fillStyle = (column + row) % 2 ? "#111111" : "#f4f4ef";
      checkContext.fillRect(column * 16, row * 16, 16, 16);
    }
  }
  checkTexture.update();
  const checks = new StandardMaterial("taxi checks", scene);
  checks.diffuseTexture = checkTexture;
  checks.specularColor = new Color3(0.1, 0.1, 0.1);

  const made = { sign, checks };
  cache.set(scene, made);
  return made;
}

/** Roof sign and chequered side stripes for Lagos Living Ride cars. They are children of the view, so they go with it. */
export function addTaxiLivery(view: VehicleView) {
  const { model } = view;
  if (model.body === "bicycle") return;
  const scene = view.root.getScene();
  const { sign, checks } = liveryMaterials(scene);
  const roof = MeshBuilder.CreateBox(`${view.id} taxi sign`, { width: 0.72, height: 0.24, depth: 0.3 }, scene);
  roof.material = sign;
  roof.parent = view.body;
  roof.position.set(0, model.height + 0.1, -model.length * 0.06);
  roof.isPickable = false;
  for (const side of [-1, 1]) {
    const stripe = MeshBuilder.CreateBox(`${view.id} taxi stripe`, { width: 0.012, height: 0.11, depth: model.length * 0.72 }, scene);
    stripe.material = checks;
    stripe.parent = view.body;
    stripe.position.set(side * model.width * 0.475, model.height * 0.5, 0);
    stripe.isPickable = false;
  }
}
