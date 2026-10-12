import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
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

/** Clase Azul's hand-painted look: cobalt brush strokes winding round white ceramic. */
function claseAzulCeramic(scene: Scene) {
  let materials = cache.get(scene);
  if (!materials) cache.set(scene, (materials = new Map()));
  const existing = materials.get("clase-azul");
  if (existing) return existing;
  const texture = new DynamicTexture("clase azul ceramic", { width: 256, height: 256 }, scene, true);
  const context = texture.getContext() as CanvasRenderingContext2D;
  context.fillStyle = "#f7f6f1";
  context.fillRect(0, 0, 256, 256);
  context.strokeStyle = "#1d3f9e";
  context.lineCap = "round";
  for (let index = 0; index < 9; index += 1) {
    const x = index * 30 + 8;
    context.lineWidth = 7 + (index % 3) * 2;
    context.beginPath();
    context.moveTo(x, 256);
    context.bezierCurveTo(x + 28, 190, x - 26, 120, x + 18, 30);
    context.stroke();
    context.lineWidth = 3;
    for (let leaf = 0; leaf < 3; leaf += 1) {
      const y = 200 - leaf * 60;
      context.beginPath();
      context.ellipse(x + 12, y, 9, 4, -0.6, 0, Math.PI * 2);
      context.stroke();
    }
  }
  context.fillStyle = "#1d3f9e";
  context.fillRect(0, 0, 256, 14);
  context.fillRect(0, 242, 256, 14);
  texture.update();
  const material = new StandardMaterial("clase azul ceramic", scene);
  material.diffuseTexture = texture;
  material.specularColor = new Color3(0.9, 0.9, 0.9);
  material.specularPower = 96;
  material.emissiveColor = new Color3(0.12, 0.12, 0.14);
  materials.set("clase-azul", material);
  return material;
}

/**
 * The VIP bottles as their real shapes, about 30 cm tall with the base at the origin: Clase Azul's tall white-and-blue
 * ceramic decanter with a silver stopper, Don Julio 1942's slender amber bottle, Dom Pérignon's shield-labelled dark
 * champagne, Moët's white label and gold foil, Hennessy's squat amber cognac bottle, and the alcohol-free jugs.
 */
export function buildBottle(scene: Scene, itemId: string) {
  const root = new TransformNode(`bottle ${itemId}`, scene);
  const lathe = (name: string, profile: Array<[number, number]>, material: StandardMaterial) => {
    const mesh = MeshBuilder.CreateLathe(name, { shape: profile.map(([r, y]) => new Vector3(r, y, 0)), tessellation: 18, sideOrientation: Mesh.DOUBLESIDE }, scene);
    mesh.material = material;
    mesh.parent = root;
    mesh.isPickable = false;
    return mesh;
  };
  const band = (name: string, radius: number, y0: number, y1: number, hex: string, glow = 0.15) => {
    const mesh = MeshBuilder.CreateCylinder(name, { height: y1 - y0, diameter: radius * 2, tessellation: 18 }, scene);
    mesh.material = paint(scene, hex, 1, glow);
    mesh.position.y = (y0 + y1) / 2;
    mesh.parent = root;
    mesh.isPickable = false;
    return mesh;
  };
  const champagne = (glass: string, label: string, foil: string) => {
    lathe("champagne", [[0, 0], [0.046, 0], [0.047, 0.17], [0.04, 0.215], [0.018, 0.255], [0.015, 0.3], [0, 0.3]], paint(scene, glass, 1, 0.08));
    band("label", 0.0485, 0.07, 0.14, label, 0.25);
    band("foil", 0.0175, 0.25, 0.31, foil, 0.3);
  };
  switch (itemId) {
    case "clase-azul": {
      lathe("decanter", [[0, 0], [0.05, 0], [0.058, 0.04], [0.062, 0.12], [0.056, 0.2], [0.04, 0.245], [0.02, 0.265], [0.018, 0.285], [0, 0.285]], claseAzulCeramic(scene));
      band("collar", 0.022, 0.282, 0.292, "#c9ccd1", 0.25);
      const stopper = MeshBuilder.CreateSphere("stopper", { diameterX: 0.05, diameterY: 0.07, diameterZ: 0.05, segments: 8 }, scene);
      stopper.material = paint(scene, "#d7dadf", 1, 0.25);
      stopper.position.y = 0.33;
      stopper.parent = root;
      break;
    }
    case "don-julio-1942":
      lathe("bottle", [[0, 0], [0.034, 0], [0.036, 0.04], [0.04, 0.25], [0.03, 0.285], [0.016, 0.3], [0.015, 0.34], [0, 0.34]], paint(scene, "#8a4f14", 1, 0.3));
      band("label", 0.0405, 0.12, 0.19, "#efe6cf", 0.25);
      band("stopper", 0.022, 0.34, 0.375, "#2a2420", 0.05);
      break;
    case "dom-perignon":
      champagne("#14251a", "#d9cfb4", "#1b1b1b");
      band("shield", 0.0488, 0.085, 0.125, "#1b1b1b", 0.1);
      break;
    case "moet":
      champagne("#1b3322", "#f4f2ea", "#d4a537");
      band("ribbon", 0.0488, 0.135, 0.145, "#b5121b", 0.2);
      break;
    case "hennessy-vs":
      lathe("bottle", [[0, 0], [0.05, 0], [0.056, 0.03], [0.058, 0.13], [0.048, 0.18], [0.02, 0.215], [0.018, 0.25], [0, 0.25]], paint(scene, "#6b3510", 1, 0.15));
      band("label", 0.0585, 0.05, 0.11, "#e8dcc0", 0.25);
      band("cap", 0.02, 0.25, 0.28, "#1b1b1b", 0.05);
      break;
    case "sparkling-juice":
      champagne("#2e4d1f", "#6a2a7a", "#c9ccd1");
      break;
    default:
      lathe("chapman", [[0, 0.005], [0.058, 0.005], [0.067, 0.12], [0.057, 0.19], [0, 0.19]], paint(scene, "#d5321f", 1, 0.25));
      lathe("jug", [[0, 0], [0.06, 0], [0.07, 0.12], [0.06, 0.2], [0.05, 0.24], [0, 0.24]], paint(scene, "#dfeef5", 0.35));
  }
  return root;
}
