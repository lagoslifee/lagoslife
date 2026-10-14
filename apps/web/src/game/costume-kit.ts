import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import type { Avatar } from "./avatar";

/**
 * Work clothes layered over an avatar's outfit, hung off its root like the security vest: a waiter's waistcoat, bow
 * tie and apron; an agbero's union tabard, headband and wad of notes; a highlife singer's microphone. Sizes are fitted
 * to the bodies at rest (male chest front z 0.10, shoulders y 1.42; the female body is a little shorter and slimmer).
 */
function flat(scene: Scene, name: string, hex: string, glow = 0) {
  const material = new StandardMaterial(name, scene);
  material.diffuseColor = Color3.FromHexString(hex);
  material.emissiveColor = Color3.FromHexString(hex).scale(glow);
  material.specularColor = new Color3(0.08, 0.08, 0.08);
  return material;
}

function rig(scene: Scene, avatar: Avatar, name: string) {
  const root = new TransformNode(`${avatar.root.name} ${name}`, scene);
  avatar.attachProp(root);
  const female = avatar.female;
  const part = (mesh: Mesh, material: StandardMaterial, x: number, y: number, z: number) => {
    mesh.material = material;
    mesh.parent = root;
    mesh.position.set(x, female ? y * 0.95 : y, z);
    if (female) mesh.scaling.x = 0.9;
    mesh.isPickable = false;
    return mesh;
  };
  return { root, part };
}

/** Black waistcoat over the white shirt, a bow tie, a long white apron and a cloth over the left arm. */
export function equipWaiter(scene: Scene, avatar: Avatar) {
  const { part } = rig(scene, avatar, "waiter kit");
  const black = flat(scene, "waiter black", "#15161a");
  const white = flat(scene, "waiter white", "#f4f2ec", 0.12);
  const gold = flat(scene, "waiter button", "#c8a24a", 0.2);
  part(MeshBuilder.CreateBox("waistcoat front", { width: 0.36, height: 0.3, depth: 0.04 }, scene), black, 0, 1.24, 0.115);
  part(MeshBuilder.CreateBox("waistcoat back", { width: 0.38, height: 0.32, depth: 0.03 }, scene), black, 0, 1.25, -0.215);
  for (const y of [1.3, 1.22, 1.14]) part(MeshBuilder.CreateSphere("waistcoat button", { diameter: 0.022, segments: 4 }, scene), gold, 0, y, 0.14);
  part(MeshBuilder.CreateBox("bow tie", { width: 0.1, height: 0.035, depth: 0.03 }, scene), black, 0, 1.43, 0.12);
  part(MeshBuilder.CreateBox("apron", { width: 0.34, height: 0.48, depth: 0.015 }, scene), white, 0, 0.78, 0.13);
  part(MeshBuilder.CreateBox("apron tie", { width: 0.42, height: 0.03, depth: 0.32 }, scene), white, 0, 1.03, -0.04);
  part(MeshBuilder.CreateBox("arm cloth", { width: 0.06, height: 0.26, depth: 0.11 }, scene), white, -0.27, 1.05, 0.03);
}

/** A sleeveless motor-park union tabard with a number on the back, a red headband and a fat wad of notes in hand. */
export function equipAgbero(scene: Scene, avatar: Avatar, index: number) {
  const { part } = rig(scene, avatar, "agbero kit");
  const tabard = flat(scene, "agbero tabard", index % 2 ? "#e2c21b" : "#e86a12", 0.18);
  const band = flat(scene, "agbero headband", "#b3121b", 0.1);
  const cash = flat(scene, "agbero cash", "#7f9f6a", 0.1);
  const texture = new DynamicTexture("agbero number", { width: 256, height: 128 }, scene, true);
  const ctx = texture.getContext() as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, 256, 128);
  ctx.fillStyle = "#1a1a1a";
  ctx.textAlign = "center";
  ctx.font = "bold 34px sans-serif";
  ctx.fillText("MOTOR PARK", 128, 46);
  ctx.font = "bold 58px sans-serif";
  ctx.fillText(String(100 + ((index * 37) % 800)), 128, 110);
  texture.hasAlpha = true;
  texture.update();
  const print = new StandardMaterial("agbero print", scene);
  print.diffuseTexture = texture;
  print.useAlphaFromDiffuseTexture = true;
  print.specularColor = Color3.Black();
  part(MeshBuilder.CreateBox("tabard front", { width: 0.38, height: 0.4, depth: 0.03 }, scene), tabard, 0, 1.2, 0.12);
  part(MeshBuilder.CreateBox("tabard back", { width: 0.4, height: 0.42, depth: 0.03 }, scene), tabard, 0, 1.21, -0.22);
  for (const x of [-0.13, 0.13]) part(MeshBuilder.CreateBox("tabard strap", { width: 0.07, height: 0.03, depth: 0.34 }, scene), tabard, x, 1.42, -0.05);
  part(MeshBuilder.CreatePlane("tabard number", { width: 0.3, height: 0.15 }, scene), print, 0, 1.25, -0.237);
  part(MeshBuilder.CreateTorus("headband", { diameter: 0.2, thickness: 0.025, tessellation: 16 }, scene), band, 0, 1.66, -0.02);
  const wad = MeshBuilder.CreateBox("agbero cash", { width: 0.075, height: 0.025, depth: 0.15 }, scene);
  wad.material = cash;
  wad.isPickable = false;
  avatar.hold(wad, "hand");
  // A held item isn't parented to the body, so it has to go with it explicitly.
  avatar.root.onDisposeObservable.addOnce(() => wad.dispose());
}

/**
 * A chrome microphone stand in front of the singer and a wireless microphone in the right hand; call `avatar.sip()`
 * while they sing to bring it up to the mouth.
 */
export function equipSinger(scene: Scene, avatar: Avatar) {
  const { part } = rig(scene, avatar, "singer kit");
  const chrome = flat(scene, "mic chrome", "#c9ccd2", 0.15);
  const black = flat(scene, "mic black", "#18181b");
  part(MeshBuilder.CreateCylinder("mic stand", { diameter: 0.025, height: 1.3, tessellation: 8 }, scene), chrome, 0, 0.65, 0.55);
  part(MeshBuilder.CreateCylinder("mic stand base", { diameter: 0.34, height: 0.03, tessellation: 16 }, scene), black, 0, 0.015, 0.55);
  const clip = part(MeshBuilder.CreateCylinder("mic stand clip", { diameter: 0.03, height: 0.12, tessellation: 8 }, scene), black, 0, 1.33, 0.5);
  clip.rotation.x = -0.9;
  const mic = new TransformNode(`${avatar.root.name} microphone`, scene);
  const handle = MeshBuilder.CreateCylinder("microphone", { diameterTop: 0.04, diameterBottom: 0.026, height: 0.17, tessellation: 10 }, scene);
  handle.material = black;
  handle.parent = mic;
  handle.position.y = 0.04;
  const grille = MeshBuilder.CreateSphere("microphone head", { diameter: 0.056, segments: 6 }, scene);
  grille.material = chrome;
  grille.parent = mic;
  grille.position.y = 0.14;
  for (const mesh of [handle, grille]) mesh.isPickable = false;
  avatar.hold(mic, "hand");
  avatar.root.onDisposeObservable.addOnce(() => mic.dispose(false, true));
}
