#!/usr/bin/env node
// Converts downloaded Poly Haven 1k JPEG maps into compact WebP files.
import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const dir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../apps/web/public/assets/textures",
);

for (const file of await readdir(dir)) {
  if (!file.endsWith(".jpg")) continue;
  const source = path.join(dir, file);
  const isRough = file.includes("_rough");
  const size = isRough ? 256 : 1024;
  const target = source.replace(/\.jpg$/, ".webp");
  await sharp(source)
    .resize(size, size)
    .webp({ quality: file.includes("_nor") ? 90 : 78 })
    .toFile(target);
  const before = (await stat(source)).size;
  const after = (await stat(target)).size;
  await rm(source);
  console.log(`${file} ${Math.round(before / 1024)}KB -> ${path.basename(target)} ${Math.round(after / 1024)}KB`);
}
