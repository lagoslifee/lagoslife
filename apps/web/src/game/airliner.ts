import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import type { Scene } from "@babylonjs/core/scene";

type V3 = [number, number, number];

/** A closed slab between a four-point outline and the same outline moved by `offset` (wings, fins, stabilisers). */
function slab(name: string, outline: [V3, V3, V3, V3], offset: V3, scene: Scene) {
  const top = outline;
  const bottom = outline.map(([x, y, z]) => [x + offset[0], y + offset[1], z + offset[2]] as V3) as [V3, V3, V3, V3];
  const faces: Array<[V3, V3, V3, V3]> = [
    [top[0], top[1], top[2], top[3]],
    [bottom[3], bottom[2], bottom[1], bottom[0]],
    ...[0, 1, 2, 3].map((i) => {
      const j = (i + 1) % 4;
      return [top[j]!, top[i]!, bottom[i]!, bottom[j]!] as [V3, V3, V3, V3];
    }),
  ];
  const all = [...top, ...bottom];
  const centre = [0, 1, 2].map((axis) => all.reduce((sum, point) => sum + point[axis]!, 0) / all.length);
  const positions: number[] = [];
  const indices: number[] = [];
  for (const face of faces) {
    const base = positions.length / 3;
    for (const point of face) positions.push(...point);
    // Babylon's front faces have the edge cross product pointing inwards, so wind each face to put it there.
    const [a, b, c] = face;
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const cross = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
    const out = [0, 1, 2].map((axis) => face.reduce((sum, point) => sum + point[axis]!, 0) / 4 - centre[axis]!);
    const inward = cross[0]! * out[0]! + cross[1]! * out[1]! + cross[2]! * out[2]! < 0;
    if (inward) indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    else indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);
  const data = new VertexData();
  data.positions = positions;
  data.indices = indices;
  data.normals = normals;
  data.uvs = positions.slice(0, (positions.length / 3) * 2).map(() => 0);
  const mesh = new Mesh(name, scene);
  data.applyToMesh(mesh);
  return mesh;
}

function paint(scene: Scene, name: string, hex: string, specular = 0.4) {
  const material = new StandardMaterial(name, scene);
  material.diffuseColor = Color3.FromHexString(hex);
  material.specularColor = new Color3(specular, specular, specular);
  material.specularPower = 64;
  return material;
}

/**
 * A narrow-body airliner (roughly A320 proportions) parked nose towards -z with its wheels on y = 0: round fuselage,
 * nose and tail cones, swept low wings with winglets, two underwing engines, tailplane, fin in the airline colour,
 * cabin windows, cockpit glazing, landing gear and the airline name along both sides.
 */
export function buildAirliner(scene: Scene, name: string, livery: { accent: string; title: string }) {
  const root = new TransformNode(name, scene);
  const white = paint(scene, `${name} white`, "#e6eaee", 0.2);
  const accent = paint(scene, `${name} accent`, livery.accent, 0.5);
  const metal = paint(scene, `${name} metal`, "#9aa1a8", 0.8);
  const dark = paint(scene, `${name} glass`, "#11161d", 0.9);
  const rubber = paint(scene, `${name} tyres`, "#1a1a1a", 0.05);
  const materials = [white, accent, metal, dark, rubber];
  const parts = new Map<StandardMaterial, Mesh[]>(materials.map((material) => [material, []]));
  const add = (mesh: Mesh, material: StandardMaterial) => {
    parts.get(material)!.push(mesh);
    return mesh;
  };
  const along = (mesh: Mesh, x: number, y: number, z: number) => {
    mesh.rotation.x = Math.PI / 2;
    mesh.position.set(x, y, z);
    return mesh;
  };

  const radius = 2;
  add(along(MeshBuilder.CreateCylinder(`${name} fuselage`, { height: 30, diameter: radius * 2, tessellation: 28 }, scene), 0, 0, 0), white);
  const nose = add(MeshBuilder.CreateSphere(`${name} nose`, { diameter: radius * 2, segments: 16 }, scene), white);
  nose.scaling.z = 1.7;
  nose.position.z = -15;
  add(along(MeshBuilder.CreateCylinder(`${name} tail cone`, { height: 8, diameterTop: 0.5, diameterBottom: radius * 2, tessellation: 28 }, scene), 0, 0.35, 19), white);
  for (const side of [-1, 1]) {
    const cockpit = add(MeshBuilder.CreateBox(`${name} cockpit ${side}`, { width: 0.9, height: 0.42, depth: 0.7 }, scene), dark);
    cockpit.position.set(side * 0.62, 0.72, -16.75);
    cockpit.rotation.set(-0.55, side * 0.45, 0);
  }

  // Cheatline in the airline colour and a row of cabin windows on each side.
  for (const side of [-1, 1]) {
    const stripe = add(MeshBuilder.CreateBox(`${name} stripe ${side}`, { width: 0.04, height: 0.28, depth: 29 }, scene), accent);
    stripe.position.set(side * (radius - 0.03), -0.25, 0.5);
    for (let z = -12.5; z < 13.5; z += 0.85) {
      if (Math.abs(z + 11) < 0.5 || Math.abs(z - 12) < 0.5) continue;
      const window = add(MeshBuilder.CreateBox(`${name} window`, { width: 0.06, height: 0.34, depth: 0.24 }, scene), dark);
      window.position.set(side * (radius - 0.04), 0.45, z);
    }
    for (const z of [-11, 12]) {
      const door = add(MeshBuilder.CreateBox(`${name} door`, { width: 0.05, height: 1.85, depth: 0.85 }, scene), metal);
      door.position.set(side * (radius - 0.03), 0.05, z);
    }
  }

  // Swept wings with dihedral and winglets; engines hang ahead of the leading edge.
  for (const side of [-1, 1]) {
    const s = side;
    add(slab(`${name} wing ${side}`, [[s * 1.6, -1.0, -3], [s * 17, -0.15, 6], [s * 17, -0.15, 8], [s * 1.6, -1.0, 4.2]], [0, -0.32, 0], scene), white);
    add(slab(`${name} winglet ${side}`, [[s * 17, -0.15, 6], [s * 17.2, 2.1, 7.6], [s * 17.2, 2.1, 8.4], [s * 17, -0.15, 8]], [s * 0.12, 0, 0], scene), accent);
    add(along(MeshBuilder.CreateCylinder(`${name} engine ${side}`, { height: 4.2, diameterTop: 1.6, diameterBottom: 2.05, tessellation: 24 }, scene), s * 5.8, -2.3, -2.2), metal);
    add(along(MeshBuilder.CreateCylinder(`${name} intake ${side}`, { height: 0.08, diameter: 1.85, tessellation: 24 }, scene), s * 5.8, -2.3, -4.28), dark);
    add(along(MeshBuilder.CreateCylinder(`${name} exhaust ${side}`, { height: 0.8, diameterTop: 0.5, diameterBottom: 1.4, tessellation: 18 }, scene), s * 5.8, -2.3, 0.25), metal);
    const pylon = add(MeshBuilder.CreateBox(`${name} pylon ${side}`, { width: 0.3, height: 0.9, depth: 3.4 }, scene), white);
    pylon.position.set(s * 5.8, -1.55, -1.4);
    add(slab(`${name} tailplane ${side}`, [[s * 0.4, 0.75, 15.2], [s * 6.4, 1.15, 19.2], [s * 6.4, 1.15, 20.6], [s * 0.4, 0.75, 19.6]], [0, -0.22, 0], scene), white);
  }
  add(slab(`${name} fin`, [[0, 1.6, 13.2], [0, 9.2, 19.6], [0, 9.2, 22], [0, 1.6, 20.8]], [0.32, 0, 0], scene), accent).position.x = -0.16;

  // Landing gear: twin nose wheels and two main bogies under the wing roots.
  const gear = (x: number, z: number, strut: number, wheel: number) => {
    const leg = add(MeshBuilder.CreateCylinder(`${name} gear leg`, { height: strut, diameter: 0.22 }, scene), metal);
    leg.position.set(x, -radius + 0.3 - strut / 2, z);
    for (const dx of [-0.32, 0.32]) {
      const tyre = add(MeshBuilder.CreateCylinder(`${name} tyre`, { height: 0.32, diameter: wheel, tessellation: 18 }, scene), rubber);
      tyre.rotation.z = Math.PI / 2;
      tyre.position.set(x + dx, -radius + 0.3 - strut, z);
    }
  };
  gear(0, -12, 1.55, 0.75);
  for (const side of [-1, 1]) gear(side * 2.6, 3.4, 1.3, 1.1);
  root.position.y = radius - 0.3 + 1.55 + 0.375;

  const meshes: Mesh[] = [];
  for (const [material, list] of parts) {
    const merged = Mesh.MergeMeshes(list, true, true);
    if (!merged) continue;
    merged.name = `${name} ${material.name}`;
    merged.material = material;
    merged.parent = root;
    merged.isPickable = false;
    meshes.push(merged);
  }

  // Airline name above the windows.
  const texture = new DynamicTexture(`${name} title`, { width: 1024, height: 96 }, scene, true);
  texture.hasAlpha = true;
  const ctx = texture.getContext() as unknown as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, 1024, 96);
  ctx.fillStyle = livery.accent;
  ctx.font = "bold 72px Inter, Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(livery.title, 512, 74);
  texture.update(true);
  const titleMaterial = new StandardMaterial(`${name} title`, scene);
  titleMaterial.diffuseTexture = texture;
  titleMaterial.useAlphaFromDiffuseTexture = true;
  titleMaterial.specularColor = Color3.Black();
  materials.push(titleMaterial);
  for (const side of [-1, 1]) {
    const title = MeshBuilder.CreatePlane(`${name} title ${side}`, { width: 10, height: 0.95 }, scene);
    title.material = titleMaterial;
    title.parent = root;
    title.position.set(side * (radius + 0.02), 1.15, -4);
    title.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
    meshes.push(title);
  }

  return {
    root,
    meshes,
    dispose() {
      root.dispose();
      for (const material of materials) material.dispose();
      texture.dispose();
    },
  };
}
