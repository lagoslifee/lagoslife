#!/usr/bin/env node
// Optimises Meshy source GLBs (assets-source/, not committed) into the
// versioned browser assets under apps/web/public/assets/. Residents are built
// by build-residents.mjs instead.
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import {
  dedup,
  prune,
  quantize,
  resample,
  textureCompress,
  weld,
} from "@gltf-transform/functions";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

const jobs = [
  {
    input: "assets-source/meshy/danfo-shell.glb",
    output: "apps/web/public/assets/vehicles/danfo-shell-v1.glb",
    texture: 1024,
  },
];

for (const job of jobs) {
  const input = path.join(root, job.input);
  const output = path.join(root, job.output);
  const document = await io.read(input);
  await document.transform(
    dedup(),
    weld(),
    resample(),
    prune(),
    textureCompress({
      encoder: sharp,
      targetFormat: "webp",
      resize: [job.texture, job.texture],
      quality: 82,
    }),
    quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12 }),
  );
  await mkdir(path.dirname(output), { recursive: true });
  await io.write(output, document);
  const before = (await stat(input)).size;
  const after = (await stat(output)).size;
  console.log(`${job.output}: ${(before / 1e6).toFixed(1)} MB -> ${(after / 1e6).toFixed(2)} MB`);
}
