#!/usr/bin/env node
// Builds the UV-space region mask that lets the game recolour the single-texture Meshy resident:
// skin, top, bottom, shoes and hair. Each triangle gets a body part from its dominant skin joint and a
// garment from the colours it covers. Skin and the ankara print share orange-browns, so the shirt is
// separated from skin by geometry instead: it covers the torso and the arms out to the measured sleeve end.
//
//   node scripts/assets/build-resident-regions.mjs
//
// Writes apps/web/public/assets/characters/resident-v1-regions.png (R = region id, G = skin weight) and
// prints the mean colour of each region, which the runtime uses as the recolouring reference.
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const modelPath = path.join(root, "apps/web/public/assets/characters/resident-v1.glb");
const outPath = path.join(root, "apps/web/public/assets/characters/resident-v1-regions.png");

export const REGION = { other: 0, skin: 1, top: 2, bottom: 3, shoes: 4, hair: 5 };
const SIZE = 1024;

await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder });
const document = await io.read(modelPath);
const gltf = document.getRoot();
const primitive = gltf.listMeshes()[0].listPrimitives()[0];
const jointNames = gltf.listSkins()[0].listJoints().map((joint) => joint.getName());
const texture = gltf.listTextures()[0];
const image = await sharp(Buffer.from(texture.getImage())).resize(SIZE, SIZE).raw().ensureAlpha().toBuffer();

const position = primitive.getAttribute("POSITION");
const uv = primitive.getAttribute("TEXCOORD_0");
const joints = primitive.getAttribute("JOINTS_0");
const weights = primitive.getAttribute("WEIGHTS_0");
const indices = primitive.getIndices();

const PARTS = {
  head: ["neck", "Head", "head_end", "headfront"],
  torso: ["Hips", "Spine02", "Spine01", "Spine"],
  upperArm: ["LeftShoulder", "LeftArm", "RightShoulder", "RightArm"],
  foreArm: ["LeftForeArm", "RightForeArm"],
  hand: ["LeftHand", "RightHand"],
  thigh: ["LeftUpLeg", "RightUpLeg"],
  shin: ["LeftLeg", "RightLeg"],
  foot: ["LeftFoot", "LeftToeBase", "RightFoot", "RightToeBase"],
};
const jointPart = jointNames.map((name) => Object.entries(PARTS).find(([, list]) => list.includes(name))?.[0] ?? "torso");

const vertexCount = position.getCount();
const vertexPart = new Array(vertexCount);
for (let vertex = 0; vertex < vertexCount; vertex += 1) {
  const joint = joints.getElement(vertex, []);
  const weight = weights.getElement(vertex, []);
  let best = 0;
  for (let k = 1; k < 4; k += 1) if (weight[k] > weight[best]) best = k;
  vertexPart[vertex] = jointPart[joint[best]];
}

function hsv(r, g, b) {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const delta = max - min;
  let hue = 0;
  if (delta > 0) {
    const [R, G, B] = [r / 255, g / 255, b / 255];
    hue = max === R ? ((G - B) / delta) % 6 : max === G ? (B - R) / delta + 2 : (R - G) / delta + 4;
    hue *= 60;
    if (hue < 0) hue += 360;
  }
  return [hue, max ? delta / max : 0, max];
}

function colourClass(offset) {
  const [h, s, v] = hsv(image[offset], image[offset + 1], image[offset + 2]);
  if (v < 0.13) return "black";
  if (s < 0.2 && v > 0.6) return "white";
  if (h >= 180 && h <= 260 && v < 0.42) return "navy";
  if (h >= 165 && h <= 260 && s > 0.25) return "blue";
  if (h >= 5 && h <= 45 && s > 0.22) return "warm";
  return "other";
}

/** Texel offsets covered by a triangle in UV space (always at least its centroid). */
function rasterise(a, b, c) {
  const points = [a, b, c].map((vertex) => {
    const [u, v] = uv.getElement(vertex, []);
    return [u * SIZE, v * SIZE];
  });
  const minX = Math.max(0, Math.floor(Math.min(...points.map((p) => p[0]))));
  const maxX = Math.min(SIZE - 1, Math.ceil(Math.max(...points.map((p) => p[0]))));
  const minY = Math.max(0, Math.floor(Math.min(...points.map((p) => p[1]))));
  const maxY = Math.min(SIZE - 1, Math.ceil(Math.max(...points.map((p) => p[1]))));
  const [[x0, y0], [x1, y1], [x2, y2]] = points;
  const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
  const texels = [];
  if (Math.abs(area) > 1e-9) {
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const px = x + 0.5;
        const py = y + 0.5;
        const w0 = ((x1 - px) * (y2 - py) - (x2 - px) * (y1 - py)) / area;
        const w1 = ((x2 - px) * (y0 - py) - (x0 - px) * (y2 - py)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 >= -0.02 && w1 >= -0.02 && w2 >= -0.02) texels.push(y * SIZE + x);
      }
    }
  }
  if (texels.length === 0) {
    const cx = Math.min(SIZE - 1, Math.floor((x0 + x1 + x2) / 3));
    const cy = Math.min(SIZE - 1, Math.floor((y0 + y1 + y2) / 3));
    texels.push(cy * SIZE + cx);
  }
  return texels;
}

const triangleCount = indices.getCount() / 3;
const triangles = [];
for (let t = 0; t < triangleCount; t += 1) {
  const corners = [indices.getScalar(t * 3), indices.getScalar(t * 3 + 1), indices.getScalar(t * 3 + 2)];
  const parts = corners.map((vertex) => vertexPart[vertex]);
  const part = parts[0] === parts[1] || parts[0] === parts[2] ? parts[0] : parts[1];
  const texels = rasterise(...corners);
  const counts = { black: 0, white: 0, navy: 0, blue: 0, warm: 0, other: 0 };
  for (const texel of texels) counts[colourClass(texel * 4)] += 1;
  const share = Object.fromEntries(Object.entries(counts).map(([key, value]) => [key, value / texels.length]));
  const centre = [0, 1, 2].map((axis) => corners.reduce((sum, vertex) => sum + position.getElement(vertex, [])[axis], 0) / 3);
  triangles.push({ corners, part, texels, share, reach: Math.abs(centre[0]), height: centre[1], label: REGION.other });
}

// The bind pose holds the arms out sideways, so distance from the body's centre line runs along the arm.
// Sleeves end where the printed fabric stops: the 97th percentile reach of clearly printed arm triangles.
const printedReach = triangles
  .filter(({ part, share }) => (part === "upperArm" || part === "foreArm") && share.blue + share.navy > 0.12)
  .map(({ reach }) => reach)
  .sort((a, b) => a - b);
const sleeveEnd = printedReach[Math.floor(printedReach.length * 0.97)] ?? 0;
console.error(`sleeve ends at reach ${sleeveEnd.toFixed(3)} (${printedReach.length} printed arm triangles)`);

/** Normalised bind-pose height of the trouser waistband; dark print above it is still shirt. */
const WAIST = 0.25;
/** Bind-pose height just above the Head joint (0.70): the shirt collar wraps the neck up to here. */
const COLLAR = 0.73;

function initialLabel({ part, share, reach, height }) {
  switch (part) {
    case "hand":
      return REGION.skin;
    case "head":
      if (share.black + share.navy > 0.45) return REGION.hair;
      return REGION.skin;
    case "foot":
      return share.navy > 0.5 ? REGION.bottom : REGION.shoes;
    case "thigh":
    case "shin":
      if (share.white > 0.5) return REGION.shoes;
      return REGION.bottom;
    case "foreArm":
    case "upperArm":
      return reach <= sleeveEnd ? REGION.top : REGION.skin;
    case "torso":
      return share.navy + share.black > 0.5 && height < WAIST ? REGION.bottom : REGION.top;
    default:
      return REGION.other;
  }
}
for (const triangle of triangles) triangle.label = initialLabel(triangle);

const regions = new Uint8Array(SIZE * SIZE);
for (const triangle of triangles) {
  const body = triangle.part !== "head";
  const collar = triangle.part === "head" && triangle.height < COLLAR;
  for (const texel of triangle.texels) {
    // Print that crosses onto bare arms or the neck (cuts follow triangles) is still shirt, never skin.
    const colour = triangle.label === REGION.skin || triangle.label === REGION.hair ? colourClass(texel * 4) : "";
    const fabric = (body && triangle.label === REGION.skin && ["black", "navy", "blue"].includes(colour)) || (collar && colour === "blue");
    regions[texel] = fabric ? REGION.top : triangle.label;
  }
}

// Grow labels into unlabelled gutter texels so bilinear filtering at chart edges never mixes in "other".
for (let pass = 0; pass < 4; pass += 1) {
  const grown = regions.slice();
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const texel = y * SIZE + x;
      if (regions[texel] !== REGION.other) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= SIZE || ny >= SIZE) continue;
        const label = regions[ny * SIZE + nx];
        if (label !== REGION.other) {
          grown[texel] = label;
          break;
        }
      }
    }
  }
  regions.set(grown);
}

// Skin weight keeps eye whites, teeth and dark brows out of the skin recolour.
const output = Buffer.alloc(SIZE * SIZE * 3);
const sums = Object.fromEntries(Object.values(REGION).map((id) => [id, [0, 0, 0, 0]]));
for (let texel = 0; texel < SIZE * SIZE; texel += 1) {
  const offset = texel * 4;
  const region = regions[texel];
  let skinWeight = 0;
  if (region === REGION.skin) {
    const [h, s, v] = hsv(image[offset], image[offset + 1], image[offset + 2]);
    const hueFit = h >= 2 && h <= 48 ? 1 : h >= 350 || h <= 60 ? 0.5 : 0;
    skinWeight = Math.round(255 * hueFit * Math.min(1, Math.max(0, (s - 0.12) / 0.2)) * Math.min(1, Math.max(0, (v - 0.08) / 0.15)));
  }
  output[texel * 3] = region;
  output[texel * 3 + 1] = skinWeight;
  output[texel * 3 + 2] = 0;
  if (region !== REGION.skin || skinWeight > 200) {
    const sum = sums[region];
    sum[0] += image[offset];
    sum[1] += image[offset + 1];
    sum[2] += image[offset + 2];
    sum[3] += 1;
  }
}
await sharp(output, { raw: { width: SIZE, height: SIZE, channels: 3 } }).png({ compressionLevel: 9 }).toFile(outPath);

const names = Object.fromEntries(Object.entries(REGION).map(([name, id]) => [id, name]));
const means = {};
for (const [id, [r, g, b, n]] of Object.entries(sums)) {
  if (!n) continue;
  means[names[id]] = { texels: n, mean: [r / n, g / n, b / n].map((value) => Math.round(value)) };
}
console.log(JSON.stringify(means, null, 2));

if (process.argv.includes("--preview")) {
  const palette = { 0: [40, 40, 40], 1: [230, 160, 110], 2: [40, 200, 90], 3: [40, 80, 220], 4: [250, 250, 250], 5: [200, 40, 200] };
  const preview = Buffer.alloc(SIZE * SIZE * 3);
  for (let texel = 0; texel < SIZE * SIZE; texel += 1) preview.set(palette[regions[texel]], texel * 3);
  await sharp(preview, { raw: { width: SIZE, height: SIZE, channels: 3 } }).png().toFile("/tmp/resident-regions-preview.png");

  // Front and back orthographic renders of the labelled bind pose, for checking the result by eye.
  const view = 400;
  const render = Buffer.alloc(view * 2 * view * 3, 30);
  for (const [panel, facing] of [[0, 1], [1, -1]]) {
    const depth = new Float32Array(view * view).fill(-Infinity);
    for (const triangle of triangles) {
      const points = triangle.corners.map((vertex) => {
        const [x, y, z] = position.getElement(vertex, []);
        return [(x * facing * 0.5 + 0.5) * view, (0.5 - y * 0.5) * view, z * facing];
      });
      const [[x0, y0], [x1, y1], [x2, y2]] = points;
      const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
      if (Math.abs(area) < 1e-6) continue;
      const colour = palette[triangle.label];
      for (let y = Math.max(0, Math.floor(Math.min(y0, y1, y2))); y <= Math.min(view - 1, Math.ceil(Math.max(y0, y1, y2))); y += 1) {
        for (let x = Math.max(0, Math.floor(Math.min(x0, x1, x2))); x <= Math.min(view - 1, Math.ceil(Math.max(x0, x1, x2))); x += 1) {
          const w0 = ((x1 - x) * (y2 - y) - (x2 - x) * (y1 - y)) / area;
          const w1 = ((x2 - x) * (y0 - y) - (x0 - x) * (y2 - y)) / area;
          const w2 = 1 - w0 - w1;
          if (w0 < 0 || w1 < 0 || w2 < 0) continue;
          const z = w0 * points[0][2] + w1 * points[1][2] + w2 * points[2][2];
          if (z <= depth[y * view + x]) continue;
          depth[y * view + x] = z;
          render.set(colour, (y * view * 2 + panel * view + x) * 3);
        }
      }
    }
  }
  await sharp(render, { raw: { width: view * 2, height: view, channels: 3 } }).png().toFile(process.env.PREVIEW_3D ?? "/tmp/resident-regions-3d.png");
}
