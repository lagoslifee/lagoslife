import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { Scene } from "@babylonjs/core/scene";
import type { VehicleView } from "./vehicles";

const cache = new WeakMap<Scene, { sign: StandardMaterial; dubaiSign: StandardMaterial; roof: StandardMaterial; checks: StandardMaterial }>();

function signMaterial(scene: Scene, name: string, background: string, ink: string, text: string, size: number) {
  const texture = new DynamicTexture(name, { width: 256, height: 64 }, scene, true);
  const context = texture.getContext() as CanvasRenderingContext2D;
  context.fillStyle = background;
  context.fillRect(0, 0, 256, 64);
  context.fillStyle = ink;
  context.font = `bold ${size}px Arial, sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text, 128, 34);
  texture.update();
  const material = new StandardMaterial(name, scene);
  material.diffuseTexture = texture;
  material.emissiveTexture = texture;
  material.emissiveColor = new Color3(0.55, 0.55, 0.55);
  material.specularColor = Color3.Black();
  return material;
}

function liveryMaterials(scene: Scene) {
  const existing = cache.get(scene);
  if (existing) return existing;
  const sign = signMaterial(scene, "taxi sign", "#f6d23a", "#111111", "TAXI", 46);
  const dubaiSign = signMaterial(scene, "dubai taxi sign", "#ffffff", "#c8102e", "DUBAI TAXI", 34);
  const roof = new StandardMaterial("dubai taxi roof", scene);
  roof.diffuseColor = Color3.FromHexString("#c8102e");
  roof.specularColor = new Color3(0.25, 0.25, 0.25);

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

  const made = { sign, dubaiSign, roof, checks };
  cache.set(scene, made);
  return made;
}

/**
 * Taxi livery, as children of the view so it goes with it: Lagos cars get the yellow roof sign and chequered stripes,
 * Dubai cars the cream body (set by the ride colour) with a red roof and a "DUBAI TAXI" sign.
 */
export function addTaxiLivery(view: VehicleView, region: "lagos" | "dubai" = "lagos") {
  const { model } = view;
  if (model.body === "bicycle") return;
  const scene = view.root.getScene();
  const materials = liveryMaterials(scene);
  const { checks } = materials;
  const roof = MeshBuilder.CreateBox(`${view.id} taxi sign`, { width: 0.72, height: 0.24, depth: 0.3 }, scene);
  roof.material = region === "dubai" ? materials.dubaiSign : materials.sign;
  roof.parent = view.body;
  roof.position.set(0, model.height + 0.1, -model.length * 0.06);
  roof.isPickable = false;
  if (region === "dubai") {
    const panel = MeshBuilder.CreateBox(`${view.id} taxi roof`, { width: model.width * 0.7, height: 0.03, depth: model.length * 0.34 }, scene);
    panel.material = materials.roof;
    panel.parent = view.body;
    panel.position.set(0, model.height - 0.01, -model.length * 0.06);
    panel.isPickable = false;
    return;
  }
  for (const side of [-1, 1]) {
    const stripe = MeshBuilder.CreateBox(`${view.id} taxi stripe`, { width: 0.012, height: 0.11, depth: model.length * 0.72 }, scene);
    stripe.material = checks;
    stripe.parent = view.body;
    stripe.position.set(side * model.width * 0.475, model.height * 0.5, 0);
    stripe.isPickable = false;
  }
}
