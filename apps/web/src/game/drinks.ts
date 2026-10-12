import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";

const cache = new WeakMap<Scene, Map<string, StandardMaterial>>();

function paint(scene: Scene, hex: string, alpha = 1, glow = 0) {
  let materials = cache.get(scene);
  if (!materials) cache.set(scene, (materials = new Map()));
  const key = `${hex}|${alpha}|${glow}`;
  let material = materials.get(key);
  if (!material) {
    material = new StandardMaterial(`drink ${key}`, scene);
    material.diffuseColor = Color3.FromHexString(hex);
    material.emissiveColor = Color3.FromHexString(hex).scale(glow);
    material.specularColor = new Color3(0.6, 0.6, 0.6);
    material.specularPower = 64;
    material.alpha = alpha;
    materials.set(key, material);
  }
  return material;
}

/**
 * Small, recognisable models of the club menu, sized for the hand: chapman in a tall glass with cucumber and a straw,
 * zobo over ice, a malt bottle with its gold label, an energy-drink can, a water bottle, a small-chops plate and a
 * suya wrap. The node's origin is where the hand holds it.
 */
export function buildMenuItem(scene: Scene, itemId: string) {
  const root = new TransformNode(`menu ${itemId}`, scene);
  const add = (mesh: Mesh, hex: string, x: number, y: number, z: number, alpha = 1, glow = 0) => {
    mesh.material = paint(scene, hex, alpha, glow);
    mesh.parent = root;
    mesh.position.set(x, y, z);
    mesh.isPickable = false;
    return mesh;
  };
  const cylinder = (name: string, height: number, top: number, bottom: number) => MeshBuilder.CreateCylinder(name, { height, diameterTop: top, diameterBottom: bottom, tessellation: 14 }, scene);
  const tallGlass = (liquid: string) => {
    add(cylinder("glass", 0.15, 0.072, 0.06), "#dfeef5", 0, 0.05, 0, 0.35);
    add(cylinder("liquid", 0.12, 0.066, 0.056), liquid, 0, 0.035, 0, 0.92, 0.2);
    for (let index = 0; index < 3; index++) add(MeshBuilder.CreateBox("ice", { size: 0.022 }, scene), "#ffffff", -0.015 + index * 0.015, 0.08 + (index % 2) * 0.012, 0.01 - index * 0.008, 0.7);
    const straw = add(cylinder("straw", 0.2, 0.007, 0.007), "#f6f6f6", 0.018, 0.12, 0);
    straw.rotation.z = -0.25;
  };
  switch (itemId) {
    case "chapman": {
      tallGlass("#d5321f");
      const slice = add(cylinder("cucumber", 0.008, 0.05, 0.05), "#5aa83a", 0.034, 0.12, 0, 1, 0.1);
      slice.rotation.z = Math.PI / 2;
      const orange = add(cylinder("orange", 0.008, 0.045, 0.045), "#f39c1f", -0.034, 0.12, 0.01, 1, 0.15);
      orange.rotation.x = Math.PI / 2;
      break;
    }
    case "zobo":
      tallGlass("#6a0d2b");
      add(MeshBuilder.CreateBox("mint", { width: 0.02, height: 0.005, depth: 0.03 }, scene), "#3f9a3a", 0, 0.115, 0.01);
      break;
    case "malt":
      add(cylinder("bottle", 0.16, 0.065, 0.065), "#3a1d0c", 0, 0.05, 0, 1, 0.05);
      add(cylinder("neck", 0.07, 0.025, 0.06), "#3a1d0c", 0, 0.165, 0);
      add(cylinder("label", 0.06, 0.067, 0.067), "#d4a017", 0, 0.05, 0, 1, 0.2);
      add(cylinder("cap", 0.012, 0.028, 0.028), "#c8102e", 0, 0.205, 0);
      break;
    case "energy-drink":
      add(cylinder("can", 0.15, 0.055, 0.055), "#1e4fd8", 0, 0.05, 0, 1, 0.15);
      add(cylinder("band", 0.04, 0.056, 0.056), "#c9d1d9", 0, 0.07, 0, 1, 0.2);
      add(cylinder("lid", 0.008, 0.05, 0.055), "#b8bec6", 0, 0.128, 0);
      break;
    case "water":
      add(cylinder("bottle", 0.2, 0.06, 0.06), "#cfe9f7", 0, 0.07, 0, 0.45);
      add(cylinder("water", 0.17, 0.056, 0.056), "#7fc3ea", 0, 0.055, 0, 0.55, 0.1);
      add(cylinder("label", 0.05, 0.062, 0.062), "#1f6fb2", 0, 0.07, 0);
      add(cylinder("cap", 0.02, 0.03, 0.03), "#1f6fb2", 0, 0.18, 0);
      break;
    case "small-chops": {
      add(cylinder("plate", 0.012, 0.2, 0.18), "#ffffff", 0, 0.0, 0);
      for (let index = 0; index < 4; index++) add(MeshBuilder.CreateSphere("puff-puff", { diameter: 0.04, segments: 6 }, scene), "#c7782b", -0.05 + index * 0.03, 0.025, -0.04);
      for (let index = 0; index < 2; index++) {
        const roll = add(cylinder("spring roll", 0.08, 0.025, 0.025), "#d9a441", -0.03 + index * 0.05, 0.02, 0.03);
        roll.rotation.z = Math.PI / 2;
      }
      const samosa = add(MeshBuilder.CreateCylinder("samosa", { height: 0.02, diameter: 0.06, tessellation: 3 }, scene), "#e0b052", 0.06, 0.02, 0);
      samosa.rotation.y = 0.4;
      add(MeshBuilder.CreateBox("toothpick", { width: 0.003, height: 0.06, depth: 0.003 }, scene), "#e8d8b0", -0.05, 0.06, -0.04);
      break;
    }
    case "suya": {
      add(cylinder("plate", 0.012, 0.18, 0.16), "#ffffff", 0, 0.0, 0);
      const wrap = add(cylinder("wrap", 0.15, 0.05, 0.05), "#e8d3a0", 0, 0.03, 0);
      wrap.rotation.z = Math.PI / 2;
      for (let index = 0; index < 3; index++) add(MeshBuilder.CreateBox("suya beef", { width: 0.03, height: 0.012, depth: 0.025 }, scene), "#5b2a12", -0.04 + index * 0.04, 0.06, 0);
      for (let index = 0; index < 3; index++) add(MeshBuilder.CreateTorus("onion", { diameter: 0.025, thickness: 0.004, tessellation: 10 }, scene), "#efe1f0", -0.06 + index * 0.05, 0.012, 0.05);
      break;
    }
    default:
      tallGlass("#f2b134");
  }
  return root;
}

/** A round silver serving tray with the order standing on it, for a waitress to carry at shoulder height. */
export function buildServingTray(scene: Scene, itemId: string) {
  const root = new TransformNode(`serving tray ${itemId}`, scene);
  const tray = MeshBuilder.CreateCylinder("serving tray", { height: 0.012, diameter: 0.34, tessellation: 18 }, scene);
  tray.material = paint(scene, "#c9ccd1");
  tray.parent = root;
  tray.isPickable = false;
  const item = buildMenuItem(scene, itemId);
  item.parent = root;
  item.position.y = 0.012;
  return root;
}
