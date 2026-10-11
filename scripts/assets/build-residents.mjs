#!/usr/bin/env node
// Builds the male and female resident GLBs from Quaternius CC0 sources (assets-source/quaternius/, not committed):
//  - body, eyes and brows from Universal Base Characters
//  - every hairstyle from the kit, fitted to both bodies through the Head bind pose
//  - skinned garments generated from each body's own surface (shirt, long sleeves, trousers, shoes, skirt)
//  - locomotion and emote clips from Universal Animation Library, copied by joint name
// Usage: node scripts/assets/build-residents.mjs
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, prune, quantize, resample, textureCompress } from "@gltf-transform/functions";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { along, bindMatrices, direction, invert, multiply, point, scaling, sub, translation } from "./lib/skin-math.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const kit = path.join(root, "assets-source/quaternius/universal-base-characters");
const bodies = path.join(kit, "Base Characters/Godot - UE");
const hairDir = path.join(kit, "Hairstyles/Rigged to Head Bone/glTF (Godot -Unreal)");
const animationFile = path.join(root, "assets-source/quaternius/universal-animation-library/Unreal-Godot/UAL1_Standard.glb");
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

const BODIES = {
  male: { file: "Superhero_Male_FullBody.gltf" },
  female: { file: "Superhero_Female_FullBody.gltf" },
};

/** Hair meshes in the kit and the body each was modelled on. */
const HAIR = [
  { file: "Hair_Buzzed.gltf", style: "low-fade", on: "male" },
  { file: "Hair_BuzzedFemale.gltf", style: "low-fade", on: "female" },
  { file: "Hair_SimpleParted.gltf", style: "parted", on: "male" },
  { file: "Hair_Buns.gltf", style: "buns", on: "female" },
  { file: "Hair_Long.gltf", style: "long", on: "female" },
  { file: "Hair_Beard.gltf", style: "beard", on: "male" },
];

const CLIPS = {
  Idle_Loop: "idle",
  Walk_Loop: "walk",
  Jog_Fwd_Loop: "jog",
  Sprint_Loop: "sprint",
  Sitting_Idle_Loop: "sit",
  Dance_Loop: "dance",
  Driving_Loop: "drive",
  Idle_Talking_Loop: "talk",
  Interact: "interact",
  Jump_Start: "jump_start",
  Jump_Loop: "jump_loop",
  Jump_Land: "jump_land",
  Fixing_Kneeling: "fix",
  PickUp_Table: "pickup",
};

/** Garment ids written to COLOR_0.r as id / 10; the client shades and hides each by id. */
const GARMENT = { top: 1, sleeve: 2, trousers: 3, shoes: 4, skirt: 5 };

const ARM = /^(upperarm|lowerarm|hand|index|middle|ring|pinky|thumb)_/;
const HAND = /^(hand|index|middle|ring|pinky|thumb)_/;
const LEG = /^(thigh|calf)_/;
const FOOT = /^(foot|ball)_/;

function read(primitive) {
  const attribute = (name) => primitive.getAttribute(name);
  const count = attribute("POSITION").getCount();
  const get = (name, size) => {
    const accessor = attribute(name);
    const out = [];
    for (let i = 0; i < count; i += 1) out.push(Array.from(accessor.getElement(i, new Array(size))));
    return out;
  };
  const indices = primitive.getIndices() ? Array.from(primitive.getIndices().getArray()) : [...Array(count).keys()];
  return {
    count,
    position: get("POSITION", 3),
    normal: get("NORMAL", 3),
    uv: get("TEXCOORD_0", 2),
    joints: get("JOINTS_0", 4),
    weights: get("WEIGHTS_0", 4),
    indices,
  };
}

function writePrimitive(document, buffer, data, material) {
  const accessor = (array, type) => document.createAccessor().setBuffer(buffer).setType(type).setArray(array);
  const primitive = document
    .createPrimitive()
    .setAttribute("POSITION", accessor(new Float32Array(data.position.flat()), "VEC3"))
    .setAttribute("NORMAL", accessor(new Float32Array(data.normal.flat()), "VEC3"))
    .setAttribute("TEXCOORD_0", accessor(new Float32Array(data.uv.flat()), "VEC2"))
    .setAttribute("JOINTS_0", accessor(new Uint8Array(data.joints.flat()), "VEC4"))
    .setAttribute("WEIGHTS_0", accessor(new Float32Array(data.weights.flat()), "VEC4"))
    .setIndices(accessor(new Uint32Array(data.indices), "SCALAR"))
    .setMaterial(material);
  if (data.color) primitive.setAttribute("COLOR_0", accessor(new Float32Array(data.color.flat()), "VEC4"));
  return primitive;
}

function dominant(data, i, names) {
  let best = 0;
  let joint = 0;
  data.weights[i].forEach((weight, k) => {
    if (weight > best) {
      best = weight;
      joint = data.joints[i][k];
    }
  });
  return names[joint];
}

function weightOf(data, i, index) {
  let total = 0;
  data.joints[i].forEach((joint, k) => {
    if (joint === index) total += data.weights[i][k];
  });
  return total;
}

/**
 * Copies the body triangles of one garment, pushed out along the normal by `offset(p)`. `keep(i)` gates by joint;
 * `field(p)` is a signed distance to the garment's cut lines (≥ 0 inside). Triangles crossing a cut keep their
 * inside part: outside vertices slide along their edges to the cut, so hems and necklines are smooth lines.
 */
function shell(data, keep, field, offset, garment, out) {
  const value = data.position.map((q) => field(q));
  const triangles = [];
  for (let t = 0; t < data.indices.length; t += 3) {
    const tri = [data.indices[t], data.indices[t + 1], data.indices[t + 2]];
    if (tri.every(keep) && tri.some((i) => value[i] >= 0)) triangles.push(tri);
  }
  const moved = new Map();
  for (const tri of triangles)
    for (const i of tri) {
      if (value[i] >= 0) continue;
      for (const j of tri) {
        if (value[j] < 0) continue;
        const t = value[i] / (value[i] - value[j]);
        const entry = moved.get(i) ?? { sum: [0, 0, 0], uv: [0, 0], n: 0, from: j };
        data.position[i].forEach((v, axis) => (entry.sum[axis] += v + (data.position[j][axis] - v) * t));
        data.uv[i].forEach((v, axis) => (entry.uv[axis] += v + (data.uv[j][axis] - v) * t));
        entry.n += 1;
        moved.set(i, entry);
      }
    }
  const remap = new Map();
  const vertex = (i) => {
    if (remap.has(i)) return remap.get(i);
    const index = out.position.length;
    const shift = moved.get(i);
    const position = shift ? shift.sum.map((v) => v / shift.n) : data.position[i];
    const uv = shift ? shift.uv.map((v) => v / shift.n) : data.uv[i];
    const lift = offset(position);
    out.position.push(position.map((v, axis) => v + data.normal[i][axis] * lift));
    out.normal.push(data.normal[i]);
    out.uv.push(uv);
    const skinFrom = shift ? shift.from : i;
    out.joints.push(data.joints[skinFrom]);
    out.weights.push(data.weights[skinFrom]);
    out.color.push([garment(position) / 10, 0, 0, 1]);
    remap.set(i, index);
    return index;
  };
  for (const tri of triangles) out.indices.push(...tri.map(vertex));
}

/**
 * Body radius around the hips/legs at height y, in `bins` directions from the body's centre line, from the
 * vertices of the lower body within ±band of y.
 */
function profile(data, names, y, bins, band = 0.025) {
  const radii = new Array(bins).fill(0);
  let cx = 0;
  let cz = 0;
  let n = 0;
  const near = [];
  for (let i = 0; i < data.count; i += 1) {
    const [x, py, z] = data.position[i];
    const joint = dominant(data, i, names);
    if (Math.abs(py - y) > band || ARM.test(joint) || joint === "Head") continue;
    near.push([x, z]);
    cx += x;
    cz += z;
    n += 1;
  }
  cx /= n;
  cz /= n;
  for (const [x, z] of near) {
    const angle = Math.atan2(z - cz, x - cx);
    const bin = Math.floor(((angle + Math.PI) / (Math.PI * 2)) * bins) % bins;
    radii[bin] = Math.max(radii[bin], Math.hypot(x - cx, z - cz));
  }
  for (let pass = 0; pass < bins; pass += 1)
    for (let b = 0; b < bins; b += 1) if (!radii[b]) radii[b] = Math.max(radii[(b + bins - 1) % bins], radii[(b + 1) % bins]);
  const smooth = radii.map((_, b) => Math.max(radii[b], (radii[(b + bins - 1) % bins] + radii[(b + 1) % bins]) / 2));
  return { cx, cz, radii: smooth };
}

/** A flared skirt from the hips to just below the knee, skinned to the pelvis and both thighs. */
function skirt(data, names, jointIndex, bind, out) {
  const pelvis = bind.get("pelvis").slice(12, 15);
  const calf = bind.get("calf_l").slice(12, 15);
  const top = pelvis[1] + 0.06;
  const hem = calf[1] - 0.06;
  const bins = 40;
  const rows = 8;
  const hip = profile(data, names, top, bins);
  const knee = profile(data, names, calf[1] + 0.04, bins);
  const ring = [];
  for (let r = 0; r <= rows; r += 1) {
    const f = r / rows;
    const y = top + (hem - top) * f;
    const body = profile(data, names, Math.max(y, calf[1] + 0.04), bins);
    const row = [];
    for (let b = 0; b < bins; b += 1) {
      const angle = (b / bins) * Math.PI * 2 - Math.PI;
      const blended = hip.radii[b] + (knee.radii[b] + 0.05 - hip.radii[b]) * f;
      const radius = Math.max(body.radii[b] + 0.018, blended) + 0.012 + f * f * 0.04;
      const cx = hip.cx + (knee.cx - hip.cx) * f;
      const cz = hip.cz + (knee.cz - hip.cz) * f;
      row.push({ position: [cx + Math.cos(angle) * radius, y, cz + Math.sin(angle) * radius], normal: [Math.cos(angle), 0.15, Math.sin(angle)], u: b / bins, f });
    }
    ring.push(row);
  }
  const pelvisIndex = jointIndex.get("pelvis");
  const left = jointIndex.get("thigh_l");
  const right = jointIndex.get("thigh_r");
  const base = out.position.length;
  for (const row of ring)
    for (const v of row) {
      // Over each thigh the cloth follows that leg almost fully, so knees cannot push through when walking.
      const side = Math.min(1, Math.max(0, (v.position[0] - hip.cx) / 0.1 + 0.5));
      const legShare = 0.92 * Math.min(1, v.f / 0.3) ** 1.5;
      out.position.push(v.position);
      const n = Math.hypot(...v.normal);
      out.normal.push(v.normal.map((value) => value / n));
      out.uv.push([v.u * 3, v.f * 1.2]);
      out.joints.push([pelvisIndex, left, right, 0]);
      out.weights.push([1 - legShare, legShare * side, legShare * (1 - side), 0]);
      out.color.push([GARMENT.skirt / 10, 0, 0, 1]);
    }
  const at = (r, b) => base + r * bins + (b % bins);
  for (let r = 0; r < rows; r += 1)
    for (let b = 0; b < bins; b += 1) {
      const [a, c, d, e] = [at(r, b), at(r, b + 1), at(r + 1, b), at(r + 1, b + 1)];
      out.indices.push(a, d, c, c, d, e);
      out.indices.push(a, c, d, c, e, d);
    }
}

/**
 * A closed shoe lofted along the foot: each slice is a rounded rectangle around that slice of the foot, with a
 * flat sole on the ground, so toes and ankle bones disappear into a shoe shape. Skinned to foot and ball.
 */
function shoe(data, names, jointIndex, bind, side, top, out) {
  const ball = bind.get(`ball_${side}`).slice(12, 15);
  const points = [];
  for (let i = 0; i < data.count; i += 1) {
    const joint = dominant(data, i, names);
    const [x, y] = data.position[i];
    if ((joint === `foot_${side}` || joint === `ball_${side}` || joint === `calf_${side}`) && y < top && Math.sign(x) === (side === "l" ? 1 : -1)) points.push(data.position[i]);
  }
  const zs = points.map((q) => q[2]);
  const zMin = Math.min(...zs) - 0.012;
  const zMax = Math.max(...zs) + 0.018;
  const slices = 12;
  const around = 16;
  const sole = Math.min(...points.map((q) => q[1])) - 0.008;
  const section = [];
  for (let s = 0; s <= slices; s += 1) {
    const z = zMin + ((zMax - zMin) * s) / slices;
    const band = points.filter((q) => Math.abs(q[2] - z) < (zMax - zMin) / slices);
    const xs = band.length ? band.map((q) => q[0]) : [0];
    const ys = band.length ? band.map((q) => q[1]) : [sole + 0.02];
    const end = Math.min(s, slices - s) / slices;
    const round = Math.min(1, end * 5) ** 0.5;
    const half = Math.max(0.015, ((Math.max(...xs) - Math.min(...xs)) / 2 + 0.013) * (0.55 + 0.45 * round));
    const height = Math.max(0.03, (Math.max(...ys) + 0.012 - sole) * (0.6 + 0.4 * round));
    section.push({ z, cx: (Math.max(...xs) + Math.min(...xs)) / 2, half, height });
  }
  const footIndex = jointIndex.get(`foot_${side}`);
  const ballIndex = jointIndex.get(`ball_${side}`);
  const base = out.position.length;
  const weightAt = (z) => {
    const toe = Math.min(1, Math.max(0, (z - ball[2]) / 0.03 + 0.5));
    return { joints: [footIndex, ballIndex, 0, 0], weights: [1 - toe, toe, 0, 0] };
  };
  const vertex = (position, normal, uv) => {
    const { joints, weights } = weightAt(position[2]);
    out.position.push(position);
    out.normal.push(normal);
    out.uv.push(uv);
    out.joints.push(joints);
    out.weights.push(weights);
    out.color.push([GARMENT.shoes / 10, 0, 0, 1]);
    return out.position.length - 1;
  };
  section.forEach(({ z, cx, half, height }, s) => {
    for (let a = 0; a < around; a += 1) {
      const angle = (a / around) * Math.PI * 2;
      const c = Math.cos(angle);
      const sn = Math.sin(angle);
      const px = Math.sign(c) * Math.abs(c) ** 0.55;
      const py = Math.sign(sn) * Math.abs(sn) ** 0.55;
      const y = sole + height * (0.5 + 0.5 * py);
      vertex([cx + half * px, Math.max(sole, y), z], [c, sn, 0], [a / around, s / slices]);
    }
  });
  const at = (s, a) => base + s * around + (a % around);
  for (let s = 0; s < slices; s += 1)
    for (let a = 0; a < around; a += 1) {
      const [p0, p1, p2, p3] = [at(s, a), at(s, a + 1), at(s + 1, a), at(s + 1, a + 1)];
      out.indices.push(p0, p1, p2, p1, p3, p2);
    }
  for (const [s, facing] of [[0, -1], [slices, 1]]) {
    const { z, cx, height } = section[s];
    const centre = vertex([cx, sole + height / 2, z + facing * 0.004], [0, 0, facing], [0.5, s / slices]);
    for (let a = 0; a < around; a += 1) {
      if (facing > 0) out.indices.push(centre, at(s, a), at(s, a + 1));
      else out.indices.push(centre, at(s, a + 1), at(s, a));
    }
  }
}

function garments(document, buffer, bodyNode, bind, material) {
  const skin = bodyNode.getSkin();
  const names = skin.listJoints().map((joint) => joint.getName());
  const jointIndex = new Map(names.map((name, index) => [name, index]));
  const data = read(bodyNode.getMesh().listPrimitives()[0]);
  const at = (name) => bind.get(name).slice(12, 15);
  const pelvis = at("pelvis");
  const neck = at("neck_01");
  const upper = at("upperarm_l");
  const lower = at("lowerarm_l");
  const hand = at("hand_l");
  const foot = at("foot_l");
  const shortSleeve = upper[0] + (lower[0] - upper[0]) * 0.5;
  const longSleeve = hand[0] - 0.035;
  const hemTop = pelvis[1] - 0.015;
  const waistBand = pelvis[1] + 0.09;
  const ankle = foot[1] + 0.035;
  const shoeTop = foot[1] + 0.05;
  // Neck opening: a round hole around the neck, about 5 cm below the Adam's apple at the front.
  const neckline = ([x, y, z]) => {
    const front = Math.max(0, Math.min(1, (z - neck[2]) / 0.1));
    const opening = neck[1] - 0.02 - front * 0.05;
    const around = Math.hypot(x, (z - neck[2]) * 0.9) - 0.085;
    return Math.max(around, opening - y);
  };
  const out = { position: [], normal: [], uv: [], joints: [], weights: [], color: [], indices: [] };
  const joint = (i) => dominant(data, i, names);
  const p = (i) => data.position[i];

  const upperBody = (i) => {
    const j = joint(i);
    return !HAND.test(j) && !LEG.test(j) && !FOOT.test(j) && p(i)[1] > hemTop - 0.08;
  };
  const sleeve = (q) => Math.abs(q[0]) >= shortSleeve;
  shell(
    data,
    upperBody,
    (q) => Math.min(neckline(q), q[1] - hemTop, longSleeve - Math.abs(q[0]), neck[1] + 0.05 - q[1]),
    (q) => (sleeve(q) ? 0.01 : 0.014),
    (q) => (sleeve(q) ? GARMENT.sleeve : GARMENT.top),
    out,
  );
  shell(
    data,
    (i) => {
      const j = joint(i);
      return !ARM.test(j) && j !== "Head" && !j.startsWith("clavicle") && p(i)[1] < waistBand + 0.05 && p(i)[1] > ankle - 0.05;
    },
    (q) => Math.min(waistBand - q[1], q[1] - ankle),
    () => 0.009,
    () => GARMENT.trousers,
    out,
  );
  for (const side of ["l", "r"]) shoe(data, names, jointIndex, bind, side, shoeTop, out);
  const skirtOut = { position: [], normal: [], uv: [], joints: [], weights: [], color: [], indices: [] };
  skirt(data, names, jointIndex, bind, skirtOut);
  for (const [name, part] of [["Outfit", out], ["Skirt", skirtOut]]) {
    const mesh = document.createMesh(name).addPrimitive(writePrimitive(document, buffer, part, material));
    bodyNode.getParentNode().addChild(document.createNode(name).setMesh(mesh).setSkin(skin));
  }
  return { sleeveCut: shortSleeve, triangles: (out.indices.length + skirtOut.indices.length) / 3 };
}

/** Head size and cranium of a body in head units (origin at the Head joint, 1 = Head joint to crown). */
function measureHead(bodyNode, bind) {
  const names = bodyNode.getSkin().listJoints().map((joint) => joint.getName());
  const data = read(bodyNode.getMesh().listPrimitives()[0]);
  const head = bind.get("Head").slice(12, 15);
  const headIndex = names.indexOf("Head");
  let top = -Infinity;
  const points = [];
  for (let i = 0; i < data.count; i += 1) {
    if (weightOf(data, i, headIndex) < 0.95) continue;
    top = Math.max(top, data.position[i][1]);
    points.push(data.position[i]);
  }
  const unit = top - head[1];
  const local = points.map((q) => sub(q, head).map((value) => value / unit));
  const eyes = bodyNode
    .getParentNode()
    .listChildren()
    .find((other) => other.getMesh()?.listPrimitives()[0].getMaterial()?.getName().includes("Eye"));
  const eyePositions = eyes ? read(eyes.getMesh().listPrimitives()[0]).position : [];
  const eye = eyePositions.length
    ? sub(eyePositions.reduce((sum, q) => [sum[0] + q[0], sum[1] + q[1], sum[2] + q[2]], [0, 0, 0]).map((value) => value / eyePositions.length), head).map((value) => value / unit)
    : null;
  const eyeApart = eyePositions.length ? (Math.max(...eyePositions.map((q) => q[0])) - Math.min(...eyePositions.map((q) => q[0]))) / 2 / unit : null;
  const crown = local.filter((q) => q[1] > 0.55);
  const zs = local.map((q) => q[2]);
  const xs = local.map((q) => q[0]);
  const centreZ = crown.reduce((sum, q) => sum + q[2], 0) / crown.length;
  return {
    unit,
    front: Math.max(...zs),
    back: Math.min(...zs),
    halfWidth: (Math.max(...xs) - Math.min(...xs)) / 2,
    crownZ: centreZ,
    eye,
    eyeApart,
  };
}

/** Mean sRGB colour of the face skin in the body texture, sampled at the UVs of head-only vertices. */
async function skinColour(bodyNode) {
  const primitive = bodyNode.getMesh().listPrimitives()[0];
  const texture = primitive.getMaterial().getBaseColorTexture();
  const { data: pixels, info } = await sharp(Buffer.from(texture.getImage())).raw().toBuffer({ resolveWithObject: true });
  const names = bodyNode.getSkin().listJoints().map((joint) => joint.getName());
  const data = read(primitive);
  const headIndex = names.indexOf("Head");
  const sum = [0, 0, 0];
  let n = 0;
  for (let i = 0; i < data.count; i += 1) {
    if (weightOf(data, i, headIndex) < 0.95) continue;
    const [u, v] = data.uv[i];
    const x = Math.min(info.width - 1, Math.max(0, Math.floor((u - Math.floor(u)) * info.width)));
    const y = Math.min(info.height - 1, Math.max(0, Math.floor((v - Math.floor(v)) * info.height)));
    const offset = (y * info.width + x) * info.channels;
    for (let c = 0; c < 3; c += 1) sum[c] += pixels[offset + c];
    n += 1;
  }
  return sum.map((value) => Math.round(value / n));
}

async function hairPrimitive(document, buffer, body, bind, heads, materials) {
  const result = [];
  for (const hair of HAIR) {
    const source = await io.read(path.join(hairDir, hair.file));
    const sourceNode = source.getRoot().listNodes().find((node) => node.getMesh() && node.getSkin());
    const sourceBind = bindMatrices(sourceNode.getSkin());
    const sourceNames = sourceNode.getSkin().listJoints().map((joint) => joint.getName());
    const targetNames = body.node.getSkin().listJoints().map((joint) => joint.getName());
    const data = read(sourceNode.getMesh().listPrimitives()[0]);
    if (hair.on !== body.name) {
      const ratio = heads[body.name].unit / heads[hair.on].unit;
      const fit = multiply(bind.get("Head"), multiply(scaling(ratio), invert(sourceBind.get("Head"))));
      data.position = data.position.map((q) => point(fit, q));
      data.normal = data.normal.map((q) => direction(fit, q));
    }
    data.joints = data.joints.map((set) => set.map((index) => targetNames.indexOf(sourceNames[index])));
    const sourceMaterial = sourceNode.getMesh().listPrimitives()[0].getMaterial();
    const key = sourceMaterial.getBaseColorTexture()?.getURI() ?? sourceMaterial.getName();
    if (!materials.has(key)) {
      const material = document.createMaterial(`Hair ${materials.size + 1}`).setRoughnessFactor(0.75).setMetallicFactor(0);
      const texture = sourceMaterial.getBaseColorTexture();
      if (texture) material.setBaseColorTexture(document.createTexture(texture.getName()).setImage(texture.getImage()).setMimeType(texture.getMimeType()));
      const normal = sourceMaterial.getNormalTexture();
      if (normal) material.setNormalTexture(document.createTexture(normal.getName()).setImage(normal.getImage()).setMimeType(normal.getMimeType()));
      material.setAlphaMode(sourceMaterial.getAlphaMode()).setAlphaCutoff(sourceMaterial.getAlphaCutoff()).setDoubleSided(sourceMaterial.getDoubleSided());
      materials.set(key, material);
    }
    const name = `Hair_${hair.style}`;
    if (hair.on !== body.name && HAIR.some((other) => other.style === hair.style && other.on === body.name)) continue;
    const mesh = document.createMesh(name).addPrimitive(writePrimitive(document, buffer, data, materials.get(key)));
    const node = document.createNode(name).setMesh(mesh).setSkin(body.node.getSkin());
    body.node.getParentNode().addChild(node);
    result.push(`${name}${hair.on === body.name ? "" : " (fitted)"}`);
  }
  return result;
}

function copyClips(document, buffer, animations, bodyNode, bind, animationBind) {
  const joints = new Map(bodyNode.getSkin().listJoints().map((joint) => [joint.getName(), joint]));
  const hipScale = bind.get("pelvis")[13] / animationBind.get("pelvis")[13];
  const copied = [];
  for (const animation of animations.getRoot().listAnimations()) {
    const name = CLIPS[animation.getName()];
    if (!name) continue;
    const clip = document.createAnimation(name);
    for (const channel of animation.listChannels()) {
      const target = channel.getTargetNode()?.getName();
      const kind = channel.getTargetPath();
      const node = joints.get(target) ?? (target === "root" ? joints.get("root") : undefined);
      if (!node || kind === "scale" || kind === "weights") continue;
      if (kind === "translation" && target !== "pelvis") continue;
      const sampler = channel.getSampler();
      const input = new Float32Array(sampler.getInput().getArray());
      const output = new Float32Array(sampler.getOutput().getArray());
      if (kind === "translation") for (let i = 0; i < output.length; i += 1) output[i] *= hipScale;
      const newSampler = document
        .createAnimationSampler()
        .setInput(document.createAccessor().setBuffer(buffer).setType("SCALAR").setArray(input))
        .setOutput(document.createAccessor().setBuffer(buffer).setType(kind === "rotation" ? "VEC4" : "VEC3").setArray(output))
        .setInterpolation(sampler.getInterpolation());
      clip.addSampler(newSampler).addChannel(document.createAnimationChannel().setTargetNode(node).setTargetPath(kind).setSampler(newSampler));
    }
    copied.push(name);
  }
  return copied;
}

const animations = await io.read(animationFile);
const animationBind = bindMatrices(animations.getRoot().listSkins()[0]);

const loaded = {};
for (const [name, spec] of Object.entries(BODIES)) {
  const document = await io.read(path.join(bodies, spec.file));
  const node = document
    .getRoot()
    .listNodes()
    .filter((candidate) => candidate.getMesh() && candidate.getSkin())
    .sort((a, b) => b.getMesh().listPrimitives()[0].getAttribute("POSITION").getCount() - a.getMesh().listPrimitives()[0].getAttribute("POSITION").getCount())[0];
  loaded[name] = { name, document, node, bind: bindMatrices(node.getSkin()) };
}
const heads = Object.fromEntries(Object.values(loaded).map((body) => [body.name, measureHead(body.node, body.bind)]));
const skins = Object.fromEntries(await Promise.all(Object.values(loaded).map(async (body) => [body.name, await skinColour(body.node)])));

/** Greyscale plain-weave texture: garments are coloured in the shader, this only adds thread detail. */
async function weaveTexture(size = 128) {
  const pixels = Buffer.alloc(size * size * 3);
  let seed = 7;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let y = 0; y < size; y += 1)
    for (let x = 0; x < size; x += 1) {
      const warp = Math.sin((x / size) * Math.PI * 64) * 0.5 + 0.5;
      const weft = Math.sin((y / size) * Math.PI * 64) * 0.5 + 0.5;
      const over = (Math.floor(x / 4) + Math.floor(y / 4)) % 2 ? warp : weft;
      const value = Math.round(255 * (0.86 + over * 0.1 + (random() - 0.5) * 0.06));
      pixels.fill(Math.min(255, value), (y * size + x) * 3, (y * size + x) * 3 + 3);
    }
  return new Uint8Array(await sharp(pixels, { raw: { width: size, height: size, channels: 3 } }).png().toBuffer());
}
const weave = await weaveTexture();

const report = {};
for (const body of Object.values(loaded)) {
  const { document, node, bind } = body;
  const graph = document.getRoot();
  const buffer = graph.listBuffers()[0];
  for (const mesh of graph.listMeshes())
    for (const primitive of mesh.listPrimitives())
      for (const semantic of ["COLOR_0", "COLOR_1", "TEXCOORD_1", "TEXCOORD_2", "TEXCOORD_3"]) primitive.setAttribute(semantic, null);
  node.setName("Body");
  node.getMesh().setName("Body");
  const bodyMaterial = node.getMesh().listPrimitives()[0].getMaterial();
  bodyMaterial.setName("Skin");
  const fabric = document
    .createMaterial("Fabric")
    .setBaseColorFactor([1, 1, 1, 1])
    .setRoughnessFactor(0.88)
    .setMetallicFactor(0)
    .setBaseColorTexture(document.createTexture("Weave").setImage(weave).setMimeType("image/png"));
  const outfit = garments(document, buffer, node, bind, fabric);
  const hair = await hairPrimitive(document, buffer, body, bind, heads, new Map());
  const clips = copyClips(document, buffer, animations, node, bind, animationBind);
  for (const other of graph.listNodes()) {
    if (other.getMesh() && other !== node && !other.getName().startsWith("Hair_") && other.getName() !== "Outfit") {
      const material = other.getMesh().listPrimitives()[0].getMaterial()?.getName() ?? "";
      other.setName(material.includes("Eye") ? "Eyes" : "Brows");
    }
  }
  await document.transform(
    dedup(),
    resample(),
    prune(),
    textureCompress({ encoder: sharp, targetFormat: "webp", resize: [1024, 1024], quality: 80, slots: /baseColor/ }),
    textureCompress({ encoder: sharp, targetFormat: "webp", resize: [512, 512], quality: 80, slots: /^(?!baseColor)/ }),
    quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12, quantizeColor: 8 }),
  );
  const output = path.join(root, `apps/web/public/assets/characters/resident-${body.name}-v2.glb`);
  await mkdir(path.dirname(output), { recursive: true });
  await io.write(output, document);
  const size = (await stat(output)).size;
  report[body.name] = { size: `${(size / 1e6).toFixed(2)} MB`, outfitTriangles: outfit.triangles, hair, clips, head: heads[body.name], skin: skins[body.name] };
}
console.log(JSON.stringify(report, null, 1));
