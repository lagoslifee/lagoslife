import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { kerbSlot, type Place } from "@lagos-living/shared";

export const BAY_SIZE = { width: 3, length: 6 };

/** Where cars pull in at a workshop: the first kerb slot outside it. */
export function serviceBay(place: Place) {
  const [x, z] = kerbSlot(place.kerb, place.kerbYaw, 0);
  return { x, z, yaw: place.kerbYaw };
}

/** Painted bay outline and a lit sign, so the workshop forecourt reads as a place to drive into. */
export function buildServiceBay(scene: Scene, place: Place, groundHeight: (x: number, z: number) => number) {
  const bay = serviceBay(place);
  const root = new TransformNode(`service bay ${place.id}`, scene);
  root.position.set(bay.x, groundHeight(bay.x, bay.z) + 0.02, bay.z);
  root.rotation.y = bay.yaw;
  const paint = new StandardMaterial(`bay paint ${place.id}`, scene);
  paint.diffuseColor = Color3.FromHexString("#f2b705");
  paint.emissiveColor = Color3.FromHexString("#3a2c00");
  const { width, length } = BAY_SIZE;
  const strips: Array<[number, number, number, number]> = [
    [-width / 2, 0, 0.14, length],
    [width / 2, 0, 0.14, length],
    [0, length / 2, width, 0.14],
  ];
  for (const [x, z, w, d] of strips) {
    const strip = MeshBuilder.CreateBox(`bay line ${place.id}`, { width: w, height: 0.02, depth: d }, scene);
    strip.position.set(x, 0, z);
    strip.material = paint;
    strip.parent = root;
    strip.isPickable = false;
  }
  const texture = new DynamicTexture(`bay sign ${place.id}`, { width: 512, height: 160 }, scene, false);
  const context = texture.getContext() as CanvasRenderingContext2D;
  context.fillStyle = "#1c1d20";
  context.fillRect(0, 0, 512, 160);
  context.fillStyle = "#f2b705";
  context.font = "bold 58px sans-serif";
  context.textAlign = "center";
  context.fillText("SERVICE BAY", 256, 72);
  context.fillStyle = "#ffffff";
  context.font = "34px sans-serif";
  context.fillText("Drive in · repair quote", 256, 128);
  texture.update();
  const signMaterial = new StandardMaterial(`bay sign material ${place.id}`, scene);
  signMaterial.diffuseTexture = texture;
  signMaterial.emissiveColor = new Color3(0.55, 0.55, 0.55);
  const board = MeshBuilder.CreatePlane(`bay sign board ${place.id}`, { width: 1.8, height: 0.56, sideOrientation: 2 }, scene);
  board.material = signMaterial;
  board.position.set(width / 2 + 0.6, 2.1, length / 2);
  board.rotation.y = Math.PI;
  board.parent = root;
  const post = MeshBuilder.CreateBox(`bay sign post ${place.id}`, { width: 0.1, height: 1.9, depth: 0.1 }, scene);
  post.position.set(width / 2 + 0.6, 0.95, length / 2 + 0.06);
  post.material = paint;
  post.parent = root;
  return root;
}
