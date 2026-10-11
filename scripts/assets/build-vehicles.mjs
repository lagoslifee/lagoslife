/**
 * Builds the drivable car fleet from Kenney's Car Kit (CC0, assets-source/kenney/car-kit).
 *
 * Each source is one palette-textured shell. Every model in the kit uses the same palette layout, so triangles
 * are split by palette cell into paint (recolourable), glass, trim, plates and lamps. The shell is scaled to
 * metres with its wheelbase centred, and a cabin (floor, door cards, headliner, dashboard, console and seats)
 * is fitted inside, measured from the model's own glass so transparent windows show a real interior. One wheel
 * is exported per model, centred on its axle.
 *
 * Outputs apps/web/public/assets/vehicles/<id>-v1.glb (+Z forward, +X left as in glTF, Y up) and the measured
 * layout (size, wheels, seats, steering) in packages/shared/src/vehicle-assets.ts.
 */
import { Document, NodeIO } from "@gltf-transform/core";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const kit = path.join(root, "assets-source/kenney/car-kit/Models/GLB format");
const outDir = path.join(root, "apps/web/public/assets/vehicles");

/**
 * `privacyGlass` adds tinted windows to solid rear sides: body-local panels whose outer face is at `x` at
 * height `at` and leans in by `slope` per unit of height.
 * `sy` scales height and the wheels, `sz` length and `sx` width. Kenney's shells are short and tall, so most
 * are stretched a little in length; the arches stay round enough for the wheels, which are scaled by `sy`.
 */
const FLEET = [
  { id: "eko-hatch", source: "hatchback-sports", sy: 1.45, sz: 1.45, sx: 1.3, seats: 4 },
  { id: "tokunbo-saloon", source: "sedan", sy: 1.35, sz: 1.75, sx: 1.25, seats: 5 },
  {
    id: "island-suv", source: "suv", sy: 1.5, sz: 1.5, sx: 1.25, seats: 5, hardtop: true,
    privacyGlass: { x: 0.55, at: 0.6, slope: 0.1875, y: [0.65, 0.91], z: [[-0.9, -0.14]] },
  },
  { id: "admiralty-executive", source: "sedan-sports", sy: 1.5, sz: 1.75, sx: 1.4, seats: 4 },
  {
    id: "banana-island-lx", source: "suv-luxury", sy: 1.5, sz: 1.75, sx: 1.3, seats: 7,
    privacyGlass: { x: 0.55, at: 0.67, slope: 0.2, y: [0.72, 1.06], z: [[-0.62, -0.17], [-1.17, -0.74]] },
  },
  { id: "lagoon-pickup", source: "truck", sy: 1.45, sz: 1.75, sx: 1.3, seats: 2 },
  {
    id: "ojota-minibus", source: "van", sy: 1.6, sz: 1.85, sx: 1.3, seats: 8,
    privacyGlass: { x: 0.55, at: 0.6, slope: 0.2, y: [0.64, 0.97], z: [[-0.55, 0.03], [-1.22, -0.65]] },
  },
];
const only = process.argv[2];

const io = new NodeIO();
const add = (a, b) => a.map((value, axis) => value + b[axis]);

/** Mesh nodes in source world space (the kit nests spares and spoilers under the body). */
function worldTranslation(node) {
  let t = [0, 0, 0];
  for (let current = node; current; current = current.getParentNode()) t = add(t, current.getTranslation());
  return t;
}

function triangles(node, offset) {
  const primitive = node.getMesh().listPrimitives()[0];
  const position = primitive.getAttribute("POSITION");
  const normal = primitive.getAttribute("NORMAL");
  const uv = primitive.getAttribute("TEXCOORD_0");
  const indices = primitive.getIndices().getArray();
  const out = [];
  for (let t = 0; t < indices.length; t += 3) {
    out.push([0, 1, 2].map((k) => {
      const i = indices[t + k];
      return { p: add(position.getElement(i, []), offset), n: normal.getElement(i, []), uv: uv.getElement(i, []) };
    }));
  }
  return out;
}

const centroid = (tri, key) => [0, 1, 2].map((axis) => (tri[0][key][axis] + tri[1][key][axis] + tri[2][key][axis]) / 3);

/** Palette cells are 64 px wide and 128 px tall in the 512² kit colormap. */
function classify(tri, spec, texel, ends) {
  const [u, v] = centroid(tri, "uv");
  const cell = `${Math.floor(u * 8)},${Math.floor(v * 4)}`;
  const c = centroid(tri, "p");
  if (cell === "0,3") return "glass";
  if (cell === "1,3") return "headlamp";
  if (cell === "2,3") return "taillamp";
  if (cell === "6,2" && Math.abs(c[0]) < 0.2 && c[1] < 0.55 && (c[2] > ends[1] - 0.12 || c[2] < ends[0] + 0.12)) return "plate";
  if (Math.floor(v * 4) === 1) return "paint";
  if (spec.hardtop) {
    // The SUV's grey hardtop above the waist (not the mirrors) takes the body colour.
    const [r, g, b] = texel(u, v);
    if (Math.max(r, g, b) > 90 && b > r + 8 && c[1] > 0.86 && Math.abs(c[0]) < 0.57) return "paint";
  }
  return "trim";
}

/** Cabin furniture as flat-shaded boxes with vertex colours, in metres (x here is glTF +X = left). */
class Boxes {
  position = [];
  normal = [];
  colour = [];

  box(x, y, z, w, h, d, tint, tilt = 0) {
    const c = [1, 3, 5].map((i) => (parseInt(tint.slice(i, i + 2), 16) / 255) ** 2.2).concat(1);
    const cos = Math.cos(tilt);
    const sin = Math.sin(tilt);
    const base = y - h / 2;
    const p = (dx, dy, dz) => {
      const ry = dy + h / 2;
      return [x + dx, base + ry * cos + dz * sin, z - ry * sin + dz * cos];
    };
    const r = (n) => [n[0], n[1] * cos + n[2] * sin, -n[1] * sin + n[2] * cos];
    const [hw, hh, hd] = [w / 2, h / 2, d / 2];
    const face = (corners, n) => {
      for (const i of [0, 1, 2, 0, 2, 3]) {
        this.position.push(...corners[i]);
        this.normal.push(...r(n));
        this.colour.push(...c);
      }
    };
    face([p(-hw, -hh, hd), p(hw, -hh, hd), p(hw, hh, hd), p(-hw, hh, hd)], [0, 0, 1]);
    face([p(hw, -hh, -hd), p(-hw, -hh, -hd), p(-hw, hh, -hd), p(hw, hh, -hd)], [0, 0, -1]);
    face([p(hw, -hh, hd), p(hw, -hh, -hd), p(hw, hh, -hd), p(hw, hh, hd)], [1, 0, 0]);
    face([p(-hw, -hh, -hd), p(-hw, -hh, hd), p(-hw, hh, hd), p(-hw, hh, -hd)], [-1, 0, 0]);
    face([p(-hw, hh, hd), p(hw, hh, hd), p(hw, hh, -hd), p(-hw, hh, -hd)], [0, 1, 0]);
    face([p(-hw, -hh, -hd), p(hw, -hh, -hd), p(hw, -hh, hd), p(-hw, -hh, hd)], [0, -1, 0]);
  }
}

const LINER = "#2e2c2a";
const HEADLINER = "#9a948a";
const SEAT = "#806b55";
const BOLSTER = "#3b342e";
const DASH = "#1f1f21";
/** A seated resident's hips sit this far above their root; head top is about this far above the cushion. */
const HIP_ABOVE_ROOT = 0.48;
const SEATED_HEIGHT = 0.93;

/**
 * Measures the cabin from the scaled glass and body, then furnishes it. Returns seat and steering positions in
 * game space (x right), so they match what the player sees.
 */
function fitCabin(spec, glass, body, bodyY) {
  const side = glass.filter((t) => Math.abs(t.n[0]) > 0.6);
  const front = glass.filter((t) => t.n[2] > 0.3);
  const rear = glass.filter((t) => t.n[2] < -0.3);
  const ys = (list) => list.flatMap((t) => t.p.map((p) => p[1]));
  const zs = (list) => list.flatMap((t) => t.p.map((p) => p[2]));
  const belt = Math.min(...ys(side.length ? side : glass));
  const glassTop = Math.max(...ys(glass));
  const roof = Math.max(...body.map((p) => p[1]));
  const head = Math.min(roof - 0.06, glassTop + 0.04);
  const innerX = Math.min(...side.flatMap((t) => t.p.map((p) => Math.abs(p[0])))) - 0.03;
  const screenPoints = front.flatMap((t) => t.p);
  const screenLow = Math.min(...screenPoints.map((p) => p[1]));
  const screenHigh = Math.max(...screenPoints.map((p) => p[1]));
  const screenBase = Math.max(...screenPoints.filter((p) => p[1] < screenLow + 0.05).map((p) => p[2]));
  const screenTop = Math.min(...screenPoints.filter((p) => p[1] > screenHigh - 0.05).map((p) => p[2]));
  const rearGlassZ = rear.length ? Math.min(...zs(rear)) : Math.min(...zs(side)) - 0.3;
  const rearPoints = rear.flatMap((t) => t.p);
  const rearHigh = rear.length ? Math.max(...rearPoints.map((p) => p[1])) : head;
  const rearLow = rear.length ? Math.min(...rearPoints.map((p) => p[1])) : belt;
  const rearTopZ = rear.length ? Math.max(...rearPoints.filter((p) => p[1] > rearHigh - 0.05).map((p) => p[2])) : rearGlassZ;
  const floor = (bodyY + 0.1) * spec.sy;
  const cushion = Math.min(floor + 0.36, head - SEATED_HEIGHT);
  const rows = 1 + Math.ceil((spec.seats - 2) / 3);
  const hipsFront = screenBase - 0.78;
  const rowGap = 0.88;
  const rearWall = Math.min(rearGlassZ + 0.12, hipsFront - rowGap * (rows - 1) - 0.4);
  const out = new Boxes();
  const b = out.box.bind(out);
  const span = screenBase - rearWall;
  const mid = (screenBase + rearWall) / 2;
  b(0, floor - 0.02, mid, innerX * 2, 0.04, span, LINER);
  for (const s of [-1, 1]) {
    b(s * innerX, (floor + belt) / 2, mid, 0.03, belt - floor, span, LINER);
    b(s * (innerX - 0.04), belt - 0.18, hipsFront + 0.1, 0.07, 0.05, 0.5, BOLSTER);
    const glassBack = Math.min(...zs(side.filter((t) => Math.sign(t.p[0][0]) === s)));
    // Rear quarters above the waist, stopping where the roof meets the rear glass.
    const quarterEnd = Math.max(rearWall, rearTopZ);
    if (glassBack - quarterEnd > 0.15) b(s * (innerX - 0.06), (belt + head - 0.1) / 2, (glassBack + quarterEnd) / 2 + 0.05, 0.03, head - 0.1 - belt, glassBack - quarterEnd - 0.1, LINER);
  }
  const wallTop = Math.min(belt, rearLow) - 0.02;
  b(0, (floor + wallTop) / 2, rearWall, innerX * 2, wallTop - floor, 0.03, LINER);
  const headBack = Math.max(rearWall, rearTopZ + 0.12);
  b(0, head + 0.01, (headBack + screenTop - 0.05) / 2, innerX * 2 - 0.2, 0.03, screenTop - 0.05 - headBack, HEADLINER);
  // Dashboard: top slab under the windscreen, fascia, driver's instrument hood, centre stack and firewall.
  const dashTop = belt - 0.04;
  b(0, dashTop, screenBase - 0.13, innerX * 2, 0.07, 0.26, DASH);
  b(0, dashTop - 0.18, screenBase - 0.22, innerX * 2, 0.3, 0.06, DASH);
  const driverX = innerX * 0.52;
  b(driverX, dashTop + 0.06, screenBase - 0.22, 0.36, 0.07, 0.16, DASH);
  b(0, dashTop - 0.24, screenBase - 0.28, 0.26, 0.38, 0.12, "#29292b");
  b(0, (floor + dashTop) / 2, screenBase, innerX * 2, dashTop - floor, 0.03, LINER);

  const seats = [];
  const seat = (x, z) => {
    b(x, cushion - 0.06, z, 0.48, 0.12, 0.5, SEAT);
    b(x, (floor + cushion - 0.12) / 2, z, 0.42, cushion - 0.12 - floor, 0.42, BOLSTER);
    for (const edge of [-1, 1]) b(x + edge * 0.21, cushion, z, 0.06, 0.06, 0.48, BOLSTER);
    const back = Math.min(0.62, head - cushion - 0.25);
    b(x, cushion + back / 2, z - 0.27, 0.48, back, 0.11, SEAT, 0.2);
    b(x, cushion + back + 0.1, z - 0.27 - Math.sin(0.2) * back, 0.27, 0.17, 0.1, SEAT, 0.2);
  };
  const bench = (z, count) => {
    const width = Math.min(innerX * 2 - 0.08, count * 0.46);
    b(0, cushion - 0.06, z, width, 0.12, 0.5, SEAT);
    b(0, (floor + cushion - 0.12) / 2, z, width - 0.04, cushion - 0.12 - floor, 0.44, BOLSTER);
    const back = Math.min(0.58, head - cushion - 0.25);
    b(0, cushion + back / 2, z - 0.27, width, back, 0.11, SEAT, 0.16);
    const xs = count === 3 ? [-width / 3, 0, width / 3] : count === 2 ? [-width / 4, width / 4] : [0];
    for (const x of xs) b(x, cushion + back + 0.08, z - 0.27 - Math.sin(0.16) * back, 0.25, 0.15, 0.09, SEAT, 0.16);
    return xs;
  };
  const root = cushion - HIP_ABOVE_ROOT;
  // glTF +X is the car's left; the game's seat x is to the right, so the driver (left) is at -x there.
  for (const x of [driverX, -driverX]) {
    seat(x, hipsFront);
    seats.push({ x: -x, y: root, z: hipsFront });
  }
  b(0, (floor + cushion - 0.05) / 2, hipsFront + 0.15, 0.2, cushion - 0.05 - floor, 0.9, "#252526");
  b(0, cushion + 0.02, hipsFront + 0.38, 0.04, 0.12, 0.04, "#151515");
  let left = spec.seats - 2;
  for (let row = 1; row < rows; row += 1) {
    const count = Math.min(3, left);
    left -= count;
    const z = hipsFront - rowGap * row;
    for (const x of bench(z, count)) seats.push({ x: -x, y: root, z });
  }
  const steering = { x: -driverX, y: cushion + 0.27, z: hipsFront + 0.45 };
  return { boxes: out, seats, steering, cabin: { floor, belt, head, innerX, screenBase, rearWall } };
}

async function build(spec) {
  const src = await io.read(path.join(kit, `${spec.source}.glb`));
  const texture = src.getRoot().listTextures()[0];
  const image = Buffer.from(texture.getImage());
  const { data: texels, info } = await sharp(image).raw().toBuffer({ resolveWithObject: true });
  const texel = (u, v) => {
    const x = Math.min(info.width - 1, Math.max(0, Math.floor(u * info.width)));
    const y = Math.min(info.height - 1, Math.max(0, Math.floor(v * info.height)));
    const o = (y * info.width + x) * info.channels;
    return [texels[o], texels[o + 1], texels[o + 2]];
  };
  const nodes = src.getRoot().listNodes().filter((node) => node.getMesh());
  const wheels = nodes.filter((node) => /^wheel-(front|back)-(left|right)$/.test(node.getName()));
  const frontLeft = wheels.find((node) => node.getName() === "wheel-front-left");
  const axles = [...new Set(wheels.map((node) => node.getTranslation()[2]))];
  const zShift = -(Math.max(...axles) + Math.min(...axles)) / 2;
  const map = ([x, y, z]) => [x * spec.sx, y * spec.sy, (z + zShift) * spec.sz];
  const mapNormal = ([x, y, z]) => {
    const n = [x / spec.sx, y / spec.sy, z / spec.sz];
    const l = Math.hypot(...n) || 1;
    return n.map((value) => value / l);
  };
  const bodyNode = nodes.find((node) => node.getName() === "body");
  const [, bodyY, bodyZ] = bodyNode.getTranslation();

  const shell = nodes.filter((node) => !wheels.includes(node)).flatMap((node) => {
    const tris = triangles(node, worldTranslation(node));
    return node.getName() === "wheel-back" ? tris.map((tri) => Object.assign(tri, { spare: true })) : tris;
  });
  const zsAll = shell.flatMap((tri) => tri.map((corner) => corner.p[2]));
  const ends = [Math.min(...zsAll), Math.max(...zsAll)];
  const parts = { paint: [], glass: [], trim: [], plate: [], headlamp: [], taillamp: [] };
  for (const tri of shell) parts[tri.spare ? "trim" : classify(tri, spec, texel, ends)].push(tri);

  if (spec.privacyGlass) {
    const { x, at, slope, y: [y0, y1], z: spans } = spec.privacyGlass;
    const uv = [176.5 / 512, 340.5 / 512];
    for (const s of [-1, 1]) {
      const point = (y, z) => [(x - (y - at) * slope + 0.004) * s, y + bodyY, z + bodyZ];
      for (const [z0, z1] of spans) {
        const [a, b, c, d] = [point(y0, z0), point(y0, z1), point(y1, z1), point(y1, z0)];
        const corner = (p) => ({ p, n: [s, slope, 0], uv });
        for (const tri of s > 0 ? [[a, c, b], [a, d, c]] : [[a, b, c], [a, c, d]]) parts.trim.push(tri.map(corner));
      }
    }
  }

  const scaled = (tris) => tris.map((tri) => ({ p: tri.map((c) => map(c.p)), n: mapNormal(centroidNormal(tri)) }));
  const centroidNormal = (tri) => {
    const [a, b, c] = tri.map((corner) => corner.p);
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    return [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  };
  const bodyPoints = shell.flatMap((tri) => tri.map((corner) => map(corner.p)));
  const fit = fitCabin(spec, scaled(parts.glass), bodyPoints, bodyY);

  const document = new Document();
  const buffer = document.createBuffer();
  const scene = document.createScene(spec.id);
  const accessor = (array, type) => document.createAccessor().setBuffer(buffer).setType(type).setArray(array);
  const palette = document.createTexture("palette").setImage(image).setMimeType("image/png");
  const material = (name, options = {}) => {
    const m = document.createMaterial(name).setRoughnessFactor(options.roughness ?? 0.6).setMetallicFactor(0);
    if (options.textured) m.setBaseColorTexture(palette);
    if (options.colour) m.setBaseColorFactor(options.colour);
    return m;
  };
  const addMesh = (name, attributes, mat) => {
    const primitive = document.createPrimitive().setMaterial(mat);
    for (const [key, [array, type]] of Object.entries(attributes)) primitive.setAttribute(key, accessor(new Float32Array(array), type));
    primitive.setIndices(accessor(new Uint32Array(attributes.POSITION[0].length / 3).map((_, i) => i), "SCALAR"));
    scene.addChild(document.createNode(name).setMesh(document.createMesh(name).addPrimitive(primitive)));
  };
  const addShell = (name, tris, mat, pointMap = map) => {
    const position = [];
    const normal = [];
    const uv = [];
    for (const tri of tris) {
      for (const corner of tri) {
        position.push(...pointMap(corner.p));
        normal.push(...mapNormal(corner.n));
        uv.push(...corner.uv);
      }
    }
    addMesh(name, { POSITION: [position, "VEC3"], NORMAL: [normal, "VEC3"], TEXCOORD_0: [uv, "VEC2"] }, mat);
    return tris.length;
  };

  const counts = {
    paint: addShell("paint", parts.paint, material("paint", { colour: [0.5, 0.5, 0.5, 1], roughness: 0.3 })),
    glass: addShell("glass", parts.glass, material("glass", { colour: [0.1, 0.14, 0.16, 1], roughness: 0.05 })),
    trim: addShell("trim", parts.trim, material("trim", { textured: true })),
    plate: addShell("plate", parts.plate, material("plate", { colour: [0.9, 0.9, 0.86, 1] })),
    headlamp: addShell("headlamp", parts.headlamp, material("headlamp", { colour: [1, 0.85, 0.3, 1] })),
    taillamp: addShell("taillamp", parts.taillamp, material("taillamp", { colour: [0.8, 0.1, 0.08, 1] })),
  };
  // One wheel centred on its axle (the kit's hub sits 0.125 outboard of the node), round at the `sy` scale.
  const hub = frontLeft.getTranslation()[0] + 0.125;
  counts.wheel = addShell("wheel", triangles(frontLeft, [-0.125, 0, 0]), material("wheel", { textured: true }), ([x, y, z]) => [x * spec.sx, y * spec.sy, z * spec.sy]);
  const { boxes } = fit;
  addMesh("interior", { POSITION: [boxes.position, "VEC3"], NORMAL: [boxes.normal, "VEC3"], COLOR_0: [boxes.colour, "VEC4"] }, material("interior", { roughness: 0.9 }));
  counts.interior = boxes.position.length / 9;

  const file = path.join(outDir, `${spec.id}-v1.glb`);
  await io.write(file, document);
  const { size } = await stat(file);
  const xs = bodyPoints.map((p) => Math.abs(p[0]));
  const zs = bodyPoints.map((p) => p[2]);
  const r2 = (value) => Math.round(value * 100) / 100;
  const layout = {
    url: `/assets/vehicles/${spec.id}-v1.glb`,
    source: `Kenney Car Kit ${spec.source}.glb`,
    length: r2(2 * Math.max(-Math.min(...zs), Math.max(...zs))),
    width: r2(2 * Math.max(...xs)),
    height: r2(Math.max(...bodyPoints.map((p) => p[1]))),
    wheelbase: r2((Math.max(...axles) - Math.min(...axles)) * spec.sz),
    wheelRadius: r2(0.3 * spec.sy),
    track: r2(hub * spec.sx),
    seats: fit.seats.map((s) => ({ x: r2(s.x), y: r2(s.y), z: r2(s.z) })),
    steering: { x: r2(fit.steering.x), y: r2(fit.steering.y), z: r2(fit.steering.z) },
  };
  console.log(spec.id, `${(size / 1024).toFixed(0)} KB`, JSON.stringify(counts), JSON.stringify(Object.fromEntries(Object.entries(fit.cabin).map(([k, v]) => [k, r2(v)]))));
  return [spec.id, layout];
}

await mkdir(outDir, { recursive: true });
const layouts = [];
for (const spec of FLEET) if (!only || only === spec.id) layouts.push(await build(spec));
if (!only) {
  const body = layouts.map(([id, layout]) => `  ${JSON.stringify(id)}: ${JSON.stringify(layout)},`).join("\n");
  const ts = `// Generated by scripts/assets/build-vehicles.mjs from the built models; do not edit by hand.\nimport type { VehicleAsset } from "./vehicles";\n\nexport const VEHICLE_ASSETS: Record<string, VehicleAsset> = {\n${body}\n};\n`;
  await writeFile(path.join(root, "packages/shared/src/vehicle-assets.ts"), ts);
}
