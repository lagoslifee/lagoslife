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
