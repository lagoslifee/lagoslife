/**
 * Builds the real-world car fleet from Meshy text-to-3D models (assets-source/meshy/car-<id>.glb, made by
 * `node scripts/meshy/generate.mjs cars`).
 *
 * Meshy gives one textured shell per car. It is simplified, turned so +Z is forward (the red tail lamps mark the
 * back), scaled to the real car's length and set on the ground. The tyres are found as tall columns of dark texels
 * near the ground; each wheel's triangles are cut out so the game can spin and steer them, and the front-left one is
 * exported centred on its axle. The white paint is split from the trim so it can be recoloured, and the tail lamps
 * are split so brake lights work. Cabins are not modelled: the glass is opaque.
 *
 * Outputs apps/web/public/assets/vehicles/<id>-v1.glb (+Z forward, +X left as in glTF, Y up), the measured layout in
 * packages/shared/src/vehicle-assets-real.ts, and a side/top check image per car in assets-source/meshy/check/.
 */
import { Document, NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { meshopt, simplify, textureCompress, weld } from "@gltf-transform/functions";
import { MeshoptEncoder, MeshoptSimplifier } from "meshoptimizer";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { REAL_CARS } from "../meshy/real-cars.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const sourceDir = path.join(root, "assets-source/meshy");
const outDir = path.join(root, "apps/web/public/assets/vehicles");
const checkDir = path.join(sourceDir, "check");
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.encoder": MeshoptEncoder });
const only = process.argv.slice(2);
const r2 = (value) => Math.round(value * 100) / 100;
/** Triangles kept per car before the wheels are cut out. */
const TRIANGLE_BUDGET = 11_000;

async function rasterOf(texture) {
  const { data, info } = await sharp(Buffer.from(texture.getImage())).raw().toBuffer({ resolveWithObject: true });
  return (u, v) => {
    const x = Math.min(info.width - 1, Math.max(0, Math.floor((u - Math.floor(u)) * info.width)));
    const y = Math.min(info.height - 1, Math.max(0, Math.floor((v - Math.floor(v)) * info.height)));
    const o = (y * info.width + x) * info.channels;
    return [data[o] / 255, data[o + 1] / 255, data[o + 2] / 255];
  };
}

/** Average colour of a triangle from its corners and centroid. */
function triColour(texel, uv) {
  const samples = [...uv, [(uv[0][0] + uv[1][0] + uv[2][0]) / 3, (uv[0][1] + uv[1][1] + uv[2][1]) / 3]].map(([u, v]) => texel(u, v));
  return [0, 1, 2].map((k) => samples.reduce((sum, c) => sum + c[k], 0) / samples.length);
}

const luminance = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const saturation = (c) => (Math.max(...c) - Math.min(...c)) / (Math.max(...c) || 1);
const isRed = ([r, g, b]) => r > 0.45 && r > g * 2 && r > b * 2;
const isDark = (c) => luminance(c) < 0.16;
const isPaint = (c) => luminance(c) > 0.6 && saturation(c) < 0.14;

async function build(car) {
  const input = path.join(sourceDir, `car-${car.id}.glb`);
  const src = await io.read(input);
  await Promise.all([MeshoptSimplifier.ready, MeshoptEncoder.ready]);
  await src.transform(weld());
  const sourceTriangles = src.getRoot().listMeshes()[0].listPrimitives()[0].getIndices().getCount() / 3;
  await src.transform(simplify({ simplifier: MeshoptSimplifier, ratio: Math.min(1, TRIANGLE_BUDGET / sourceTriangles), error: 0.006 }));
  const primitive = src.getRoot().listMeshes()[0].listPrimitives()[0];
  const material = primitive.getMaterial();
  const base = material.getBaseColorTexture();
  const texel = await rasterOf(base);
  const P = primitive.getAttribute("POSITION");
  const N = primitive.getAttribute("NORMAL");
  const T = primitive.getAttribute("TEXCOORD_0");
  const index = primitive.getIndices().getArray();
  const tris = [];
  for (let t = 0; t < index.length; t += 3) {
    const ids = [index[t], index[t + 1], index[t + 2]];
    const uv = ids.map((i) => T.getElement(i, []));
    tris.push({ p: ids.map((i) => P.getElement(i, [])), n: ids.map((i) => N.getElement(i, [])), uv, c: triColour(texel, uv) });
  }

  // Length along Z, then +Z forward (tail lamps at -Z).
  const extent = (axis) => {
    const values = tris.flatMap((tri) => tri.p.map((p) => p[axis]));
    return [Math.min(...values), Math.max(...values)];
  };
  const [x0, x1] = extent(0);
  const [z0, z1] = extent(2);
  let turn = (p) => p;
  if (x1 - x0 > z1 - z0) turn = ([x, y, z]) => [-z, y, x];
  const red = tris.filter((tri) => isRed(tri.c)).map((tri) => turn(tri.p[0])[2]);
  const along = tris.map((tri) => turn(tri.p[0])[2]);
  const middle = (Math.min(...along) + Math.max(...along)) / 2;
  const redBehind = red.length ? red.reduce((sum, z) => sum + z, 0) / red.length < middle : true;
  const flip = (car.flip ?? false) !== !redBehind;
  const orient = flip ? (p) => { const [x, y, z] = turn(p); return [-x, y, -z]; } : turn;
  for (const tri of tris) {
    tri.p = tri.p.map(orient);
    tri.n = tri.n.map(orient);
  }

  // Scale to the real length and stand on the ground, centred across.
  const all = tris.flatMap((tri) => tri.p);
  const bounds = (axis) => [Math.min(...all.map((p) => p[axis])), Math.max(...all.map((p) => p[axis]))];
  const [bx0, bx1] = bounds(0);
  const [by0] = bounds(1);
  const [bz0, bz1] = bounds(2);
  const scale = car.length / (bz1 - bz0);
  const place = ([x, y, z]) => [(x - (bx0 + bx1) / 2) * scale, (y - by0) * scale, (z - (bz0 + bz1) / 2) * scale];
  for (const tri of tris) tri.p = tri.p.map(place);
  const points = tris.flatMap((tri) => tri.p);
  const halfWidth = Math.max(...points.map((p) => Math.abs(p[0])));

  // Tyres: dark texels near the ground on the outer sides, binned along the car. A wheel's bins span most of its
  // diameter vertically; sills and bumpers are thin.
  const BIN = 0.05;
  const columns = new Map();
  for (const tri of tris) {
    if (!isDark(tri.c)) continue;
    for (const [x, y, z] of tri.p) {
      if (y > car.wheel * 2.3 || Math.abs(x) < halfWidth * 0.55) continue;
      const key = Math.round(z / BIN);
      const column = columns.get(key) ?? { lo: Infinity, hi: -Infinity };
      column.lo = Math.min(column.lo, y);
      column.hi = Math.max(column.hi, y);
      columns.set(key, column);
    }
  }
  const tall = [...columns.entries()].filter(([, c]) => c.hi - c.lo > car.wheel * 1.1 && c.lo < car.wheel * 0.5).map(([key]) => key * BIN).sort((a, b) => a - b);
  const groups = [];
  for (const z of tall) {
    const last = groups.at(-1);
    if (last && z - last.at(-1) <= BIN * 2.5) last.push(z);
    else groups.push([z]);
  }
  // Fit each tyre's circle to the bottom of its dark silhouette: the contact patch gives the axle, and the height
  // of the outline either side gives the radius (h = R - sqrt(R² - d²), so R = (h² + d²) / 2h).
  const median = (values) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const wheels = groups.filter((g) => g.length >= 4).map((g) => {
    const centre = (g[0] + g.at(-1)) / 2;
    const near = [...columns.entries()].map(([key, c]) => ({ z: key * BIN, lo: c.lo, hi: c.hi })).filter((c) => Math.abs(c.z - centre) < car.wheel * 2.2);
    const floor = Math.min(...near.map((c) => c.lo));
    const contact = near.filter((c) => c.lo < floor + 0.025);
    const z = contact.reduce((sum, c) => sum + c.z, 0) / contact.length;
    const estimates = near
      .map((c) => ({ d: Math.abs(c.z - z), h: c.lo - floor }))
      .filter(({ d, h }) => h > 0.03 && h < car.wheel * 0.6 && d < car.wheel * 1.4)
      .map(({ d, h }) => (h * h + d * d) / (2 * h));
    const radius = estimates.length >= 3 ? median(estimates) : car.wheel;
    return { z, span: g.at(-1) - g[0] + BIN, radius, cols: near };
  });
  if (wheels.length < 2) throw new Error(`${car.id}: found ${wheels.length} wheel groups`);
  const front = wheels.at(-1);
  const rear = wheels[0];
  const warnings = [];
  if (wheels.length > 2) warnings.push(`${wheels.length} wheel groups (${wheels.map((w) => r2(w.z)).join(", ")})`);
  for (const wheel of [front, rear]) if (wheel.span > car.wheel * 2.9) warnings.push(`wheel at ${r2(wheel.z)} spans ${r2(wheel.span)} m`);
  // Stand the car on its tyres, not on anything hanging lower (tow bars, mud flaps).
  const tyreBottom = Math.min(...[front, rear].flatMap((wheel) => wheel.cols.map((c) => c.lo)));
  for (const tri of tris) tri.p = tri.p.map(([x, y, z]) => [x, y - tyreBottom, z]);
  const radiusOf = (wheel) => Math.min(car.wheel * 1.45, Math.max(car.wheel * 0.75, wheel.radius));
  const R = (radiusOf(front) + radiusOf(rear)) / 2;

  // Cut out each wheel: triangles inside its cylinder on the outer part of each side.
  const inner = halfWidth - Math.max(0.28, R * 0.85);
  const wheelOf = (tri) => {
    const c = [0, 1, 2].map((k) => (tri.p[0][k] + tri.p[1][k] + tri.p[2][k]) / 3);
    if (Math.abs(c[0]) < inner) return null;
    for (const wheel of [front, rear]) {
      if (tri.p.every((p) => Math.hypot(p[1] - R, p[2] - wheel.z) <= R * 1.08 && Math.abs(p[0]) >= inner - 0.02)) {
        return { wheel, left: c[0] > 0 };
      }
    }
    return null;
  };
  const parts = { paint: [], trim: [], taillamp: [], wheel: [] };
  let wheelTris = 0;
  const shift = (front.z + rear.z) / 2;
  const hubXs = [];
  const exported = new Set();
  for (const tri of tris) {
    tri.p = tri.p.map(([x, y, z]) => [x, y, z - shift]);
    const hit = wheelOf({ p: tri.p.map(([x, y, z]) => [x, y, z + shift]) });
    if (hit) {
      wheelTris += 1;
      if (hit.wheel === front && hit.left) {
        parts.wheel.push(tri);
        exported.add(tri);
        hubXs.push(...tri.p.map((p) => p[0]));
      }
      continue;
    }
    if (isRed(tri.c) && tri.p[0][2] < -(car.length / 2 - shift) * 0.55) parts.taillamp.push(tri);
    else if (isPaint(tri.c)) parts.paint.push(tri);
    else parts.trim.push(tri);
  }
  if (!parts.wheel.length) throw new Error(`${car.id}: no wheel triangles`);
  const hub = (Math.min(...hubXs) + Math.max(...hubXs)) / 2;
  const axle = front.z - shift;
  parts.wheel = parts.wheel.map((tri) => ({ ...tri, p: tri.p.map(([x, y, z]) => [x - hub, y - R, z - axle]) }));
  const wheelbase = front.z - rear.z;
  const height = Math.max(...tris.flatMap((tri) => tri.p.map((p) => p[1])));

  const document = new Document();
  const buffer = document.createBuffer();
  const scene = document.createScene(car.id);
  const copyTexture = (texture, name) => texture && document.createTexture(name).setImage(texture.getImage()).setMimeType(texture.getMimeType());
  const colourMap = copyTexture(base, "base colour");
  const normalMap = copyTexture(material.getNormalTexture(), "normal");
  const ormMap = copyTexture(material.getMetallicRoughnessTexture(), "metallic roughness");
  const makeMaterial = (name, options = {}) => {
    const m = document.createMaterial(name).setBaseColorTexture(colourMap).setMetallicFactor(options.metallic ?? 1).setRoughnessFactor(options.roughness ?? 1);
    if (normalMap) m.setNormalTexture(normalMap);
    if (ormMap && !options.flat) m.setMetallicRoughnessTexture(ormMap);
    return m;
  };
  const addMesh = (name, list, mat) => {
    const position = [];
    const normal = [];
    const uv = [];
    for (const tri of list) {
      for (let k = 0; k < 3; k += 1) {
        position.push(...tri.p[k]);
        const n = tri.n[k];
        const l = Math.hypot(...n) || 1;
        normal.push(n[0] / l, n[1] / l, n[2] / l);
        uv.push(...tri.uv[k]);
      }
    }
    const accessor = (array, type) => document.createAccessor().setBuffer(buffer).setType(type).setArray(array);
    const prim = document.createPrimitive().setMaterial(mat)
      .setAttribute("POSITION", accessor(new Float32Array(position), "VEC3"))
      .setAttribute("NORMAL", accessor(new Float32Array(normal), "VEC3"))
      .setAttribute("TEXCOORD_0", accessor(new Float32Array(uv), "VEC2"));
    scene.addChild(document.createNode(name).setMesh(document.createMesh(name).addPrimitive(prim)));
  };
  addMesh("paint", parts.paint, makeMaterial("paint", { flat: true, metallic: 0.5, roughness: 0.3 }));
  addMesh("trim", parts.trim, makeMaterial("trim"));
  if (parts.taillamp.length) addMesh("taillamp", parts.taillamp, makeMaterial("taillamp"));
  addMesh("wheel", parts.wheel, makeMaterial("wheel"));
  await document.transform(
    weld(),
    textureCompress({ encoder: sharp, targetFormat: "webp", slots: /^baseColorTexture$/, resize: [512, 512], quality: 82 }),
    textureCompress({ encoder: sharp, targetFormat: "webp", slots: /^(normalTexture|metallicRoughnessTexture)$/, resize: [256, 256], quality: 75 }),
    meshopt({ encoder: MeshoptEncoder, level: "medium" }),
  );
  const file = path.join(outDir, `${car.id}-v1.glb`);
  await io.write(file, document);
  const { size } = await stat(file);

  // Cabin is hidden behind opaque glass, so seats only need plausible positions and enough headroom.
  const seatY = Math.max(0, Math.min(0.1, height - 1.45));
  const frontRow = car.seats <= 2 ? 0.05 : wheelbase / 2 - 1.2;
  const seats = [{ x: -0.37, y: seatY, z: frontRow }, { x: 0.37, y: seatY, z: frontRow }];
  for (let left = car.seats - 2, row = 1; left > 0; row += 1) {
    const count = Math.min(3, left);
    left -= count;
    const xs = count === 3 ? [-0.5, 0, 0.5] : count === 2 ? [-0.37, 0.37] : [0];
    for (const x of xs) seats.push({ x, y: seatY, z: frontRow - 0.88 * row });
  }
  const layout = {
    url: `/assets/vehicles/${car.id}-v1.glb`,
    source: `Meshy text-to-3D car-${car.id}`,
    length: r2(car.length),
    width: r2(Math.min(halfWidth * 2, car.width * 1.04)),
    height: r2(height),
    wheelbase: r2(wheelbase),
    wheelRadius: r2(R),
    track: r2(Math.abs(hub)),
    seats: seats.map((s) => ({ x: r2(s.x), y: r2(s.y), z: r2(s.z) })),
    steering: { x: -0.37, y: r2(seatY + 0.75), z: r2(frontRow + 0.45) },
    paintTexture: true,
  };
  await check(car, tris, { ...parts, wheel: [...exported] }, { R, front: front.z - shift, rear: rear.z - shift, hub });
  const counts = Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, v.length]));
  console.log(car.id, `${(size / 1024).toFixed(0)} KB`, `scale ${r2(scale)}`, `flip ${flip}`, `wheels R ${r2(R)} wb ${r2(wheelbase)} track ${r2(Math.abs(hub))}`, `cut ${wheelTris}`, JSON.stringify(counts), `w ${r2(halfWidth * 2)}/${car.width} h ${r2(height)}/${car.height}`, warnings.join("; "));
  return [car.id, layout, warnings];
}

/** Side and top orthographic views: paint grey, trim dark, wheels and lamps highlighted, axles marked. */
async function check(car, tris, parts, marks) {
  const W = 640;
  const H = 260;
  const ppm = (W - 40) / car.length;
  const image = Buffer.alloc(W * H * 2 * 3, 255);
  const depth = new Float32Array(W * H * 2).fill(-Infinity);
  const colourOf = new Map();
  for (const [name, colour] of [["paint", [205, 205, 205]], ["trim", [70, 70, 80]], ["taillamp", [230, 30, 30]], ["wheel", [30, 160, 230]]]) {
    for (const tri of parts[name]) colourOf.set(tri, colour);
  }
  const cut = [250, 160, 0];
  const draw = (tri, project, offsetY, colour) => {
    const q = tri.p.map(project);
    const minX = Math.max(0, Math.floor(Math.min(...q.map((p) => p[0]))));
    const maxX = Math.min(W - 1, Math.ceil(Math.max(...q.map((p) => p[0]))));
    const minY = Math.max(0, Math.floor(Math.min(...q.map((p) => p[1]))));
    const maxY = Math.min(H - 1, Math.ceil(Math.max(...q.map((p) => p[1]))));
    const [a, b, c] = q;
    const area = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
    if (Math.abs(area) < 1e-9) return;
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const w0 = ((b[0] - x) * (c[1] - y) - (c[0] - x) * (b[1] - y)) / area;
        const w1 = ((c[0] - x) * (a[1] - y) - (a[0] - x) * (c[1] - y)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const d = w0 * a[2] + w1 * b[2] + w2 * c[2];
        const i = (y + offsetY) * W + x;
        if (d <= depth[i]) continue;
        depth[i] = d;
        image.set(colour, i * 3);
      }
    }
  };
  const side = ([x, y, z]) => [20 + (car.length / 2 - z) * ppm, H - 20 - y * ppm, x];
  const top = ([x, y, z]) => [20 + (car.length / 2 - z) * ppm, H / 2 - x * ppm, y];
  for (const tri of tris) {
    const colour = colourOf.get(tri) ?? cut;
    draw(tri, side, 0, colour);
    draw(tri, top, H, colour);
  }
  for (const z of [marks.front, marks.rear]) {
    const [px, py] = side([0, marks.R, z]);
    for (let d = -6; d <= 6; d += 1) {
      for (const [x, y] of [[px + d, py], [px, py + d]]) if (x >= 0 && x < W && y >= 0 && y < H) image.set([0, 200, 0], (Math.round(y) * W + Math.round(x)) * 3);
    }
  }
  await mkdir(checkDir, { recursive: true });
  await sharp(image, { raw: { width: W, height: H * 2, channels: 3 } }).png().toFile(path.join(checkDir, `${car.id}.png`));
}

await mkdir(outDir, { recursive: true });
const results = [];
for (const car of REAL_CARS) {
  if (only.length && !only.includes(car.id)) continue;
  if (!existsSync(path.join(sourceDir, `car-${car.id}.glb`))) {
    console.log(`${car.id}: no source model yet`);
    continue;
  }
  try {
    results.push(await build(car));
  } catch (error) {
    console.log(`${car.id}: FAILED ${error.message}`);
  }
}
if (!only.length) {
  const body = results.map(([id, layout]) => `  ${JSON.stringify(id)}: ${JSON.stringify(layout)},`).join("\n");
  const ts = `// Generated by scripts/assets/build-meshy-cars.mjs from the built models; do not edit by hand.\nimport type { VehicleAsset } from "./vehicles.js";\n\nexport const REAL_VEHICLE_ASSETS: Record<string, VehicleAsset> = {\n${body}\n};\n`;
  await writeFile(path.join(root, "packages/shared/src/vehicle-assets-real.ts"), ts);
}
