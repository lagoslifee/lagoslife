// Regenerates only the clothes (shirt, sleeves, trousers, shoes, skirt) of the shipped resident GLBs from the body
// mesh inside them, for when the garment code changes and the Quaternius sources (assets-source/) are not at hand.
// Usage: node scripts/assets/rebuild-garments.mjs
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, dequantize, prune, quantize } from "@gltf-transform/functions";
import { stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { garments } from "./lib/garments.mjs";
import { bindMatrices } from "./lib/skin-math.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

const report = {};
for (const body of ["male", "female"]) {
  const file = path.join(root, `apps/web/public/assets/characters/resident-${body}-v2.glb`);
  const document = await io.read(file);
  await document.transform(dequantize());
  const graph = document.getRoot();
  const bodyNode = graph.listNodes().find((node) => node.getName() === "Body" && node.getMesh());
  if (!bodyNode) throw new Error(`${body}: no Body mesh`);
  const old = graph.listNodes().filter((node) => node.getMesh()?.listPrimitives()[0]?.getMaterial()?.getName() === "Fabric");
  if (!old.length) throw new Error(`${body}: no garments to replace`);
  const fabric = old[0].getMesh().listPrimitives()[0].getMaterial();
  for (const node of old) {
    const mesh = node.getMesh();
    node.dispose();
    mesh.dispose();
  }
  const outfit = garments(document, graph.listBuffers()[0], bodyNode, bindMatrices(bodyNode.getSkin()), fabric);
  await document.transform(dedup(), prune(), quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12, quantizeColor: 8 }));
  await io.write(file, document);
  report[body] = { size: `${((await stat(file)).size / 1e6).toFixed(2)} MB`, outfitTriangles: outfit.triangles };
}
console.log(JSON.stringify(report));
