/**
 * Builds furniture-scale props from Meshy text-to-3D models (assets-source/meshy/prop-<id>.glb, made by
 * `node scripts/meshy/generate.mjs props`). Each one is simplified, turned by `quarterTurns` so its front faces +Z,
 * scaled so its widest side is `width` metres, centred and set on the ground, with WebP textures and meshopt
 * compression. Outputs apps/web/public/assets/props/<id>-v1.glb.
 */
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { meshopt, simplify, textureCompress, weld } from "@gltf-transform/functions";
import { MeshoptEncoder, MeshoptSimplifier } from "meshoptimizer";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const sourceDir = path.join(root, "assets-source/meshy");
const outDir = path.join(root, "apps/web/public/assets/props");
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.encoder": MeshoptEncoder });

export const PROPS = [
  { id: "immigration-booth", width: 2.3, quarterTurns: Number(process.env.TURN_IMMIGRATION ?? 0) },
  { id: "checkin-counter", width: 4.8, quarterTurns: Number(process.env.TURN_CHECKIN ?? 0) },
  { id: "restaurant-table", width: 2.4, quarterTurns: 0 },
  { id: "treadmill", width: 1.9, quarterTurns: 0 },
  { id: "weight-bench", width: 2.1, quarterTurns: 0 },
  { id: "dumbbell-rack", width: 1.5, quarterTurns: 0 },
  { id: "generator", width: 3.2, quarterTurns: 0 },
  { id: "gas-cooker", width: 0.6, quarterTurns: 0 },
  { id: "standing-fan", width: 0.78, quarterTurns: 0 },
  // Home furniture: `fit` is the catalogue footprint (packages/shared/src/furniture.ts), `height` sets plants and lamps.
  { id: "double-bed", fit: [1.7, 2.2], quarterTurns: 0, texture: 512 },
  { id: "sofa", fit: [2.4, 1.0], quarterTurns: 0, texture: 512 },
  { id: "dining-set", fit: [2.4, 2.2], quarterTurns: 0, texture: 512 },
  { id: "king-bed", fit: [2.9, 2.4], quarterTurns: 0, texture: 512 },
  { id: "sectional", fit: [2.8, 2.0], quarterTurns: 0, texture: 512 },
  { id: "armchair", fit: [0.95, 0.95], quarterTurns: 0, texture: 512 },
  { id: "coffee-table", fit: [1.2, 0.65], quarterTurns: 0, texture: 512 },
  { id: "side-table", fit: [1.3, 0.8], quarterTurns: 0, texture: 512 },
  { id: "tv-console", fit: [1.9, 0.5], quarterTurns: 0, texture: 512 },
  { id: "wardrobe", fit: [1.7, 0.65], quarterTurns: 0, texture: 512 },
  { id: "bookshelf", fit: [1.0, 0.4], quarterTurns: 0, texture: 512 },
  { id: "work-desk", fit: [1.4, 1.2], quarterTurns: 0, texture: 512 },
  { id: "floor-lamp", height: 1.75, quarterTurns: 0, texture: 512 },
  { id: "potted-palm", height: 1.9, quarterTurns: 0, texture: 512 },
  // Built into the bigger homes (apps/web/src/game/interior.ts).
  { id: "kitchen-wall", width: 5.0, quarterTurns: 0, texture: 512 },
  { id: "kitchen-island", width: 3.0, quarterTurns: 0, texture: 512 },
  { id: "grand-piano", width: 2.7, quarterTurns: 0, texture: 512 },
  { id: "chandelier", width: 1.4, quarterTurns: 0, texture: 512 },
  { id: "wall-art", width: 1.8, quarterTurns: 0, texture: 512 },
  { id: "console-vase", width: 1.5, quarterTurns: 0, texture: 512 },
  // Parked on the helipad sky mansion's roof (apps/web/src/game/plots.ts).
  { id: "helicopter", width: 9.2, quarterTurns: 0 },
  // iFitness Lekki's training floor (apps/web/src/game/gym-interior.ts).
  { id: "squat-rack", width: 1.9, quarterTurns: 0 },
  { id: "exercise-bike", width: 1.25, quarterTurns: 0 },
];
const TRIANGLE_BUDGET = 7_000;

async function build(prop) {
  const document = await io.read(path.join(sourceDir, `prop-${prop.id}.glb`));
  await Promise.all([MeshoptSimplifier.ready, MeshoptEncoder.ready]);
  await document.transform(weld());
  const primitives = document.getRoot().listMeshes().flatMap((mesh) => mesh.listPrimitives());
  const triangles = primitives.reduce((sum, primitive) => sum + primitive.getIndices().getCount() / 3, 0);
  await document.transform(simplify({ simplifier: MeshoptSimplifier, ratio: Math.min(1, TRIANGLE_BUDGET / triangles), error: 0.004 }));

  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const turn = ([x, y, z]) => {
    let [a, b] = [x, z];
    for (let k = 0; k < ((prop.quarterTurns % 4) + 4) % 4; k += 1) [a, b] = [b, -a];
    return [a, y, b];
  };
  for (const primitive of primitives) {
    const position = primitive.getAttribute("POSITION");
    for (let i = 0; i < position.getCount(); i += 1) {
      const p = turn(position.getElement(i, []));
      for (let k = 0; k < 3; k += 1) {
        min[k] = Math.min(min[k], p[k]);
        max[k] = Math.max(max[k], p[k]);
      }
    }
  }
  const [sx, sy, sz] = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const scale = prop.fit ? Math.min(prop.fit[0] / sx, prop.fit[1] / sz) : prop.height ? prop.height / sy : prop.width / Math.max(sx, sz);
  const centre = [(min[0] + max[0]) / 2, min[1], (min[2] + max[2]) / 2];
  for (const primitive of primitives) {
    const position = primitive.getAttribute("POSITION");
    const normal = primitive.getAttribute("NORMAL");
    for (let i = 0; i < position.getCount(); i += 1) {
      const p = turn(position.getElement(i, []));
      position.setElement(i, [(p[0] - centre[0]) * scale, (p[1] - centre[1]) * scale, (p[2] - centre[2]) * scale]);
      if (normal) normal.setElement(i, turn(normal.getElement(i, [])));
    }
  }
  for (const node of document.getRoot().listNodes()) node.setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
  const texture = prop.texture ?? 1024;
  await document.transform(textureCompress({ encoder: sharp, targetFormat: "webp", resize: [texture, texture] }), meshopt({ encoder: MeshoptEncoder, level: "medium" }));
  await mkdir(outDir, { recursive: true });
  const target = path.join(outDir, `${prop.id}-v1.glb`);
  await io.write(target, document);
  const size = (await stat(target)).size;
  const height = (max[1] - min[1]) * scale;
  console.log(`${prop.id}: ${Math.round(triangles)} → ≤${TRIANGLE_BUDGET} triangles, ${(size / 1024).toFixed(0)} KB, ${(sx * scale).toFixed(2)} × ${(sz * scale).toFixed(2)} m, ${height.toFixed(2)} m tall`);
}

const only = process.argv.slice(2);
for (const prop of PROPS.filter((entry) => !only.length || only.includes(entry.id))) await build(prop);
