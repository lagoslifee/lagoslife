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
  const scale = prop.width / Math.max(max[0] - min[0], max[2] - min[2]);
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
  await document.transform(textureCompress({ encoder: sharp, targetFormat: "webp", resize: [1024, 1024] }), meshopt({ encoder: MeshoptEncoder, level: "medium" }));
  await mkdir(outDir, { recursive: true });
  const target = path.join(outDir, `${prop.id}-v1.glb`);
  await io.write(target, document);
  const size = (await stat(target)).size;
  const height = (max[1] - min[1]) * scale;
  console.log(`${prop.id}: ${Math.round(triangles)} → ≤${TRIANGLE_BUDGET} triangles, ${(size / 1024).toFixed(0)} KB, ${prop.width} m wide, ${height.toFixed(2)} m tall`);
}

const only = process.argv.slice(2);
for (const prop of PROPS.filter((entry) => !only.length || only.includes(entry.id))) await build(prop);
