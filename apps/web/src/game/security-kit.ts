import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import type { CharacterAppearance } from "@lagos-living/shared";
import type { Avatar } from "./avatar";

const SKINS: CharacterAppearance["skinTone"][] = ["deep", "rich", "warm", "rich"];

/** Private security: dark uniform, close crop, shades or a cap. */
export function securityLook(index: number): CharacterAppearance {
  return { body: "male", skinTone: SKINS[index % SKINS.length]!, hairstyle: "low-fade", outfit: "security-uniform", accessory: index % 3 === 1 ? "cap" : "glasses" };
}

/** Each kit owns its materials: disposing an avatar disposes the materials of everything under its root. */
function kit(scene: Scene) {
  const flat = (name: string, hex: string, specular = 0.15) => {
    const material = new StandardMaterial(name, scene);
    material.diffuseColor = Color3.FromHexString(hex);
    material.specularColor = new Color3(specular, specular, specular);
    return material;
  };
  const texture = new DynamicTexture("security lettering", { width: 256, height: 64 }, scene, true);
  const ctx = texture.getContext() as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, 256, 64);
  ctx.fillStyle = "#f2c230";
  ctx.font = "bold 44px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("SECURITY", 128, 48);
  texture.hasAlpha = true;
  texture.update();
  const letters = new StandardMaterial("security lettering", scene);
  letters.diffuseTexture = texture;
  letters.useAlphaFromDiffuseTexture = true;
  letters.emissiveColor = new Color3(0.35, 0.3, 0.1);
  letters.specularColor = Color3.Black();
  return { vest: flat("security vest", "#23272c"), letters, metal: flat("rifle metal", "#1a1b1d", 0.5), wood: flat("rifle furniture", "#3b2a1e") };
}

/**
 * Puts a plate-carrier vest with SECURITY on the back and, when `armed`, a rifle held across the chest on an avatar.
 * The kit hangs off the avatar root, so it follows the body's position and heading rather than individual bones.
 */
export function equipSecurity(scene: Scene, avatar: Avatar, armed: boolean) {
  const materials = kit(scene);
  avatar.setBuild(1);
  const root = new TransformNode(`${avatar.root.name} security kit`, scene);
  avatar.attachProp(root);
  const part = (mesh: Mesh, material: StandardMaterial, x: number, y: number, z: number) => {
    mesh.material = material;
    mesh.parent = root;
    mesh.position.set(x, y, z);
    mesh.isPickable = false;
    return mesh;
  };
  // Fitted to the male body's chest at rest: front at z 0.10, back at z -0.21, shoulders at y 1.42.
  part(MeshBuilder.CreateBox("vest", { width: 0.4, height: 0.34, depth: 0.36 }, scene), materials.vest, 0, 1.25, -0.05);
  for (const x of [-0.13, 0.13]) part(MeshBuilder.CreateBox("vest strap", { width: 0.08, height: 0.05, depth: 0.34 }, scene), materials.vest, x, 1.43, -0.05);
  for (const x of [-0.1, 0, 0.1]) part(MeshBuilder.CreateBox("vest pouch", { width: 0.085, height: 0.1, depth: 0.05 }, scene), materials.vest, x, 1.15, 0.15);
  const back = part(MeshBuilder.CreatePlane("vest back", { width: 0.34, height: 0.085 }, scene), materials.letters, 0, 1.33, -0.235);
  back.rotation.y = 0;
  const front = part(MeshBuilder.CreatePlane("vest front", { width: 0.2, height: 0.05 }, scene), materials.letters, 0, 1.36, 0.135);
  front.rotation.y = Math.PI;
  if (armed) {
    const rifle = new TransformNode("rifle", scene);
    rifle.parent = root;
    rifle.position.set(0.02, 1.16, 0.25);
    rifle.rotation.set(0, 0, 0.62);
    const piece = (mesh: Mesh, material: StandardMaterial, x: number, y: number) => {
      mesh.material = material;
      mesh.parent = rifle;
      mesh.position.set(x, y, 0);
      mesh.isPickable = false;
    };
    piece(MeshBuilder.CreateBox("rifle body", { width: 0.42, height: 0.07, depth: 0.05 }, scene), materials.metal, 0, 0);
    piece(MeshBuilder.CreateBox("rifle stock", { width: 0.24, height: 0.09, depth: 0.045 }, scene), materials.wood, -0.31, -0.02);
    piece(MeshBuilder.CreateBox("rifle grip", { width: 0.04, height: 0.1, depth: 0.04 }, scene), materials.wood, -0.1, -0.07);
    piece(MeshBuilder.CreateBox("rifle magazine", { width: 0.05, height: 0.15, depth: 0.035 }, scene), materials.metal, 0.06, -0.09);
    const barrel = MeshBuilder.CreateCylinder("rifle barrel", { diameter: 0.022, height: 0.3, tessellation: 8 }, scene);
    barrel.rotation.z = Math.PI / 2;
    piece(barrel, materials.metal, 0.36, 0.015);
    piece(MeshBuilder.CreateBox("rifle handguard", { width: 0.16, height: 0.06, depth: 0.05 }, scene), materials.wood, 0.25, -0.005);
  }
  return root;
}

/** Uniform fittings measured from each body's outfit mesh at rest (metres, +z out of the chest). */
const POLICE_FIT = {
  male: { chestY: 1.3, front: 0.13, back: -0.26, shoulderX: 0.2, shoulderY: 1.44, beltY: 1.0, beltZ: -0.06, beltWidth: 0.37, beltDepth: 0.32 },
  female: { chestY: 1.36, front: 0.105, back: -0.19, shoulderX: 0.17, shoulderY: 1.385, beltY: 1.02, beltZ: -0.09, beltWidth: 0.33, beltDepth: 0.31 },
} as const;

function policeKit(scene: Scene) {
  const flat = (name: string, hex: string, specular = 0.15, glow = 0) => {
    const material = new StandardMaterial(name, scene);
    material.diffuseColor = Color3.FromHexString(hex);
    material.specularColor = new Color3(specular, specular, specular);
    material.emissiveColor = Color3.FromHexString(hex).scale(glow);
    return material;
  };
  const texture = new DynamicTexture("police back lettering", { width: 256, height: 64 }, scene, true);
  const ctx = texture.getContext() as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, 256, 64);
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 48px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("POLICE", 128, 50);
  texture.hasAlpha = true;
  texture.update();
  const letters = new StandardMaterial("police back lettering", scene);
  letters.diffuseTexture = texture;
  letters.useAlphaFromDiffuseTexture = true;
  letters.emissiveColor = new Color3(0.45, 0.45, 0.45);
  letters.specularColor = Color3.Black();
  return {
    letters,
    belt: flat("police belt", "#0b0b0d", 0.3),
    silver: flat("police silver", "#c9ccd2", 0.8, 0.15),
    gold: flat("police badge", "#d4a537", 0.8, 0.2),
    tag: flat("police name tag", "#f1f1ee", 0.1, 0.2),
    navy: flat("police epaulette", "#1d2b4f", 0.2),
  };
}

/**
 * Nigeria Police kit over the black uniform: epaulettes with stars, a gold badge and name tag on the chest, a duty belt
 * with buckle and holster, and POLICE across the back. Officers are drawn at the trained build the fittings match.
 */
export function equipPolice(scene: Scene, avatar: Avatar) {
  const materials = policeKit(scene);
  avatar.setBuild(1);
  const root = new TransformNode(`${avatar.root.name} police kit`, scene);
  avatar.attachProp(root);
  const fit = POLICE_FIT[avatar.appearance.body];
  const part = (mesh: Mesh, material: StandardMaterial, x: number, y: number, z: number) => {
    mesh.material = material;
    mesh.parent = root;
    mesh.position.set(x, y, z);
    mesh.isPickable = false;
    return mesh;
  };
  for (const side of [-1, 1]) {
    part(MeshBuilder.CreateBox("epaulette", { width: 0.09, height: 0.025, depth: 0.12 }, scene), materials.navy, side * fit.shoulderX, fit.shoulderY, -0.04);
    part(MeshBuilder.CreateBox("epaulette star", { width: 0.03, height: 0.012, depth: 0.03 }, scene), materials.silver, side * fit.shoulderX, fit.shoulderY + 0.016, -0.02);
  }
  const badge = part(MeshBuilder.CreateCylinder("chest badge", { diameter: 0.05, height: 0.012, tessellation: 10 }, scene), materials.gold, 0.075, fit.chestY, fit.front);
  badge.rotation.x = Math.PI / 2;
  part(MeshBuilder.CreateBox("name tag", { width: 0.075, height: 0.02, depth: 0.01 }, scene), materials.tag, -0.075, fit.chestY, fit.front);
  part(MeshBuilder.CreateBox("duty belt", { width: fit.beltWidth, height: 0.055, depth: fit.beltDepth }, scene), materials.belt, 0, fit.beltY, fit.beltZ);
  part(MeshBuilder.CreateBox("belt buckle", { width: 0.06, height: 0.04, depth: 0.012 }, scene), materials.silver, 0, fit.beltY, fit.beltZ + fit.beltDepth / 2 + 0.005);
  part(MeshBuilder.CreateBox("holster", { width: 0.05, height: 0.14, depth: 0.09 }, scene), materials.belt, fit.beltWidth / 2 + 0.02, fit.beltY - 0.05, fit.beltZ);
  part(MeshBuilder.CreateBox("radio", { width: 0.05, height: 0.08, depth: 0.04 }, scene), materials.belt, -fit.beltWidth / 2 + 0.03, fit.beltY - 0.01, fit.beltZ + fit.beltDepth / 2);
  part(MeshBuilder.CreatePlane("police back", { width: 0.26, height: 0.065 }, scene), materials.letters, 0, fit.chestY, fit.back);
  return root;
}
