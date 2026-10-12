import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";

/**
 * A way out that reads as a door from across any room: a dark frame with two glass leaves, a push bar, a lit green
 * EXIT box sign with a running-man arrow above it, a glowing threshold strip and a floor mat. `x`, `z` is the middle of
 * the doorway on the wall; the door faces `yaw` (0 = into the room towards +z). `freestanding` adds side walls for
 * open-air decks, where the way out is a lobby door with no wall around it.
 */
export function buildExitDoor(scene: Scene, x: number, z: number, yaw: number, disposables: Array<{ dispose(): void }>, options: { label?: string; freestanding?: boolean; width?: number } = {}) {
  const root = new TransformNode("exit door", scene);
  root.position.set(x, 0, z);
  root.rotation.y = yaw;
  disposables.push(root);
  const width = options.width ?? 1.8;
  const paint = (name: string, hex: string, glow = 0, alpha = 1) => {
    const material = new StandardMaterial(`exit ${name}`, scene);
    material.diffuseColor = Color3.FromHexString(hex);
    material.emissiveColor = Color3.FromHexString(hex).scale(glow);
    material.specularColor = new Color3(0.3, 0.3, 0.3);
    material.alpha = alpha;
    if (glow >= 1) material.disableLighting = true;
    disposables.push(material);
    return material;
  };
  const frame = paint("frame", "#2a2d33", 1);
  const glass = paint("glass", "#9fd6e8", 0.25, 0.45);
  const steel = paint("steel", "#c9ccd1", 0.1);
  const green = paint("green", "#19c25a", 1);
  const mat = paint("mat", "#33373d", 1);
  const box = (w: number, h: number, d: number, px: number, py: number, pz: number, material: StandardMaterial) => {
    const mesh = MeshBuilder.CreateBox("exit part", { width: w, height: h, depth: d }, scene);
    mesh.position.set(px, py, pz);
    mesh.material = material;
    mesh.parent = root;
    mesh.isPickable = false;
    return mesh;
  };
  const half = width / 2;
  for (const side of [-1, 1]) box(0.12, 2.5, 0.16, side * (half + 0.06), 1.25, 0.04, frame);
  box(width + 0.24, 0.14, 0.16, 0, 2.57, 0.04, frame);
  for (const side of [-1, 1]) {
    box(half - 0.04, 2.36, 0.04, side * (half / 2), 1.2, 0.02, glass);
    box(0.06, 2.36, 0.06, side * 0.03, 1.2, 0.03, frame);
    box(half * 0.7, 0.05, 0.06, side * (half / 2), 1.05, 0.07, steel);
  }
  box(width + 0.1, 0.03, 0.06, 0, 0.02, 0.12, green);
  box(width * 0.9, 0.02, 0.9, 0, 0.012, 0.6, mat);
  if (options.freestanding) {
    const wall = paint("lobby wall", "#d9d4ca");
    for (const side of [-1, 1]) box(1.4, 3.0, 0.3, side * (half + 0.82), 1.5, -0.1, wall);
    box(width + 3.0, 0.5, 0.3, 0, 2.9, -0.1, wall);
  }

  const texture = new DynamicTexture("exit sign", { width: 256, height: 96 }, scene, true);
  const context = texture.getContext() as CanvasRenderingContext2D;
  context.fillStyle = "#0f8f41";
  context.fillRect(0, 0, 256, 96);
  context.fillStyle = "#ffffff";
  context.font = "bold 52px system-ui, sans-serif";
  context.textAlign = "center";
  context.fillText("EXIT", 148, 54);
  context.font = "bold 46px system-ui, sans-serif";
  context.fillText("🏃", 50, 58);
  context.font = "20px system-ui, sans-serif";
  context.fillText(options.label ?? "Way out", 128, 86);
  texture.update();
  const signMaterial = new StandardMaterial("exit sign", scene);
  signMaterial.disableLighting = true;
  signMaterial.emissiveTexture = texture;
  disposables.push(texture, signMaterial);
  box(1.0, 0.4, 0.12, 0, 2.8, 0.06, frame);
  const sign = MeshBuilder.CreatePlane("exit sign face", { width: 0.94, height: 0.35 }, scene);
  sign.material = signMaterial;
  sign.parent = root;
  sign.position.set(0, 2.8, 0.125);
  sign.rotation.y = Math.PI;
  sign.isPickable = false;
  return root;
}
