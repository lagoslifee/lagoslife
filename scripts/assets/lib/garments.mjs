// Garments generated from a body's own surface: shirt, sleeves, trousers, shoes and skirt, skinned to its joints.

/** Garment ids written to COLOR_0.r as id / 10; the client shades and hides each by id. */
export const GARMENT = { top: 1, sleeve: 2, trousers: 3, shoes: 4, skirt: 5, sole: 6 };

export const ARM = /^(upperarm|lowerarm|hand|index|middle|ring|pinky|thumb)_/;
export const HAND = /^(hand|index|middle|ring|pinky|thumb)_/;
export const LEG = /^(thigh|calf)_/;
export const FOOT = /^(foot|ball)_/;

export function read(primitive) {
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

export function writePrimitive(document, buffer, data, material) {
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

export function dominant(data, i, names) {
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

export function weightOf(data, i, index) {
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
export function shell(data, keep, field, offset, garment, out) {
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
export function profile(data, names, y, bins, band = 0.025) {
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
export function skirt(data, names, jointIndex, bind, out) {
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
 * A shoe lofted heel to toe around the foot: a low rounded toe box rising to a padded collar at the ankle, on a
 * separate, slightly wider sole slab in its own colour, so it reads as a trainer or a loafer rather than a block.
 * Skinned to foot and ball, so the toe bends at the ball when walking.
 */
export function shoe(data, names, jointIndex, bind, side, top, out) {
  const ball = bind.get(`ball_${side}`).slice(12, 15);
  const points = [];
  for (let i = 0; i < data.count; i += 1) {
    const joint = dominant(data, i, names);
    const [x, y] = data.position[i];
    if ((joint === `foot_${side}` || joint === `ball_${side}` || joint === `calf_${side}`) && y < top && Math.sign(x) === (side === "l" ? 1 : -1)) points.push(data.position[i]);
  }
  const zs = points.map((q) => q[2]);
  const zMin = Math.min(...zs) - 0.014;
  const zMax = Math.max(...zs) + 0.022;
  const slices = 16;
  const around = 18;
  const ground = Math.min(...points.map((q) => q[1])) - 0.006;
  const soleTop = ground + 0.024;
  const widest = Math.max(...points.map((q) => Math.abs(q[0]))) - Math.min(...points.map((q) => Math.abs(q[0])));
  const section = [];
  for (let s = 0; s <= slices; s += 1) {
    const u = s / slices;
    const z = zMin + (zMax - zMin) * u;
    const band = points.filter((q) => Math.abs(q[2] - z) < (zMax - zMin) / slices);
    const xs = band.length ? band.map((q) => q[0]) : [section.at(-1)?.cx ?? 0];
    const ys = band.length ? band.map((q) => q[1]) : [soleTop + 0.03];
    const cx = (Math.max(...xs) + Math.min(...xs)) / 2;
    // Rounded heel and toe, widest across the ball of the foot.
    const heelRound = Math.sqrt(Math.max(0, 1 - ((0.14 - Math.min(u, 0.14)) / 0.14) ** 2));
    const toeRound = Math.sqrt(Math.max(0, 1 - ((Math.max(u, 0.78) - 0.78) / 0.22) ** 2));
    const half = Math.max(0.012, (widest / 2 + 0.014) * (0.78 + 0.22 * Math.sin(Math.PI * Math.min(1, u * 1.15))) * Math.min(heelRound, toeRound) ** 0.6);
    // The upper drops from the ankle collar to a low toe box, but always clears the foot inside.
    const collar = Math.max(...ys) + 0.012 - soleTop;
    const shape = 0.055 + (0.03 - 0.055) * Math.min(1, Math.max(0, (u - 0.3) / 0.55)) ** 0.8;
    const height = Math.max(0.018, Math.max(Math.min(collar, 0.075), shape) * Math.min(heelRound, toeRound) ** 0.35);
    section.push({ z, cx, half, height });
  }
  const footIndex = jointIndex.get(`foot_${side}`);
  const ballIndex = jointIndex.get(`ball_${side}`);
  const weightAt = (z) => {
    const toe = Math.min(1, Math.max(0, (z - ball[2]) / 0.03 + 0.5));
    return { joints: [footIndex, ballIndex, 0, 0], weights: [1 - toe, toe, 0, 0] };
  };
  const vertex = (position, normal, uv, garment) => {
    const { joints, weights } = weightAt(position[2]);
    const length = Math.hypot(...normal) || 1;
    out.position.push(position);
    out.normal.push(normal.map((value) => value / length));
    out.uv.push(uv);
    out.joints.push(joints);
    out.weights.push(weights);
    out.color.push([garment / 10, 0, 0, 1]);
    return out.position.length - 1;
  };
  const loft = (rowsOf, garment) => {
    const base = out.position.length;
    section.forEach((slice, s) => {
      for (let a = 0; a < around; a += 1) {
        const angle = (a / around) * Math.PI * 2;
        const [position, normal] = rowsOf(slice, Math.cos(angle), Math.sin(angle));
        vertex(position, normal, [a / around, s / slices], garment);
      }
    });
    const at = (s, a) => base + s * around + (a % around);
    for (let s = 0; s < slices; s += 1)
      for (let a = 0; a < around; a += 1) {
        const [p0, p1, p2, p3] = [at(s, a), at(s, a + 1), at(s + 1, a), at(s + 1, a + 1)];
        out.indices.push(p0, p1, p2, p1, p3, p2);
      }
    for (const [s, facing] of [[0, -1], [slices, 1]]) {
      const [centre] = rowsOf(section[s], 0, 0);
      const middle = vertex([centre[0], centre[1], section[s].z + facing * 0.003], [0, 0, facing], [0.5, s / slices], garment);
      for (let a = 0; a < around; a += 1) {
        if (facing > 0) out.indices.push(middle, at(s, a), at(s, a + 1));
        else out.indices.push(middle, at(s, a + 1), at(s, a));
      }
    }
  };
  // Upper: flat underneath, domed on top.
  loft(({ z, cx, half, height }, c, sn) => {
    const px = Math.sign(c) * Math.abs(c) ** 0.6;
    const py = sn >= 0 ? sn ** 0.75 : -(Math.abs(sn) ** 0.25);
    return [[cx + half * px, soleTop - 0.004 + (height + 0.004) * (0.5 + 0.5 * py) , z], [c, sn * 0.8, 0]];
  }, GARMENT.shoes);
  // Sole: a boxy slab a few millimetres proud of the upper all round.
  loft(({ z, cx, half }, c, sn) => {
    const px = Math.sign(c) * Math.abs(c) ** 0.3;
    const py = Math.sign(sn) * Math.abs(sn) ** 0.3;
    return [[cx + (half + 0.005) * px, ground + (soleTop - ground) * (0.5 + 0.5 * py), z], [c, sn * 0.5, 0]];
  }, GARMENT.sole);
}

/**
 * Trousers cut straight from the knee down instead of following the calf, and long enough to break over the shoe:
 * each leg vertex below the knee is pushed out to the knee's radius round the knee-to-ankle line.
 */
function straightLegs(data, names, bind, out, from, ankle) {
  const at = (name) => bind.get(name).slice(12, 15);
  const legs = {};
  for (const side of ["l", "r"]) {
    const knee = at(`calf_${side}`);
    const foot = at(`foot_${side}`);
    let radius = 0;
    for (let i = 0; i < data.count; i += 1) {
      const [x, y, z] = data.position[i];
      if (!LEG.test(dominant(data, i, names)) || Math.sign(x) !== Math.sign(knee[0]) || Math.abs(y - knee[1]) > 0.02) continue;
      radius = Math.max(radius, Math.hypot(x - knee[0], z - knee[2]));
    }
    legs[side] = { knee, foot, radius: radius * 0.92 + 0.016 };
  }
  for (let i = from; i < out.position.length; i += 1) {
    const [x, y, z] = out.position[i];
    const leg = legs[x >= 0 === legs.l.knee[0] >= 0 ? "l" : "r"];
    const { knee, foot } = leg;
    if (y > knee[1] + 0.06) continue;
    const t = Math.min(1, Math.max(0, (knee[1] - y) / (knee[1] - foot[1])));
    const ax = knee[0] + (foot[0] - knee[0]) * t;
    const az = knee[2] + (foot[2] - knee[2]) * t;
    const dx = x - ax;
    const dz = z - az;
    const r = Math.hypot(dx, dz) || 1e-4;
    const blend = Math.min(1, Math.max(0, (knee[1] + 0.06 - y) / 0.1));
    const radius = r + (Math.max(r, leg.radius) - r) * blend;
    const hem = 0.035 * Math.min(1, Math.max(0, (ankle + 0.03 - y) / 0.03));
    out.position[i] = [ax + (dx / r) * radius, y - hem, az + (dz / r) * radius];
    const n = out.normal[i];
    const mixed = [n[0] + ((dx / r) - n[0]) * blend * 0.7, n[1] * (1 - blend * 0.7), n[2] + ((dz / r) - n[2]) * blend * 0.7];
    const length = Math.hypot(...mixed) || 1;
    out.normal[i] = mixed.map((value) => value / length);
  }
}

export function garments(document, buffer, bodyNode, bind, material) {
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
  // Shirts end at the hip: a hem at the pelvis joint wraps between the legs and reads as a bodysuit over the trousers.
  const hemTop = pelvis[1] + 0.05;
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

  // Hip triangles weighted to the thighs stay in: the hem cut trims them to a clean line instead of leaving notches.
  const upperBody = (i) => {
    const j = joint(i);
    return !HAND.test(j) && !FOOT.test(j) && !j.startsWith("calf") && p(i)[1] > hemTop - 0.08;
  };
  const sleeve = (q) => Math.abs(q[0]) >= shortSleeve;
  // Cloth hangs off the chest instead of hugging the stomach: ease grows from the chest down to the hem.
  const chest = pelvis[1] + (neck[1] - pelvis[1]) * 0.55;
  const ease = (y) => Math.min(1, Math.max(0, (chest - y) / (chest - hemTop))) ** 1.3;
  shell(
    data,
    upperBody,
    (q) => Math.min(neckline(q), q[1] - hemTop, longSleeve - Math.abs(q[0]), neck[1] + 0.05 - q[1]),
    (q) => (sleeve(q) ? 0.012 : 0.015 + 0.022 * ease(q[1])),
    (q) => (sleeve(q) ? GARMENT.sleeve : GARMENT.top),
    out,
  );
  const trousersFrom = out.position.length;
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
  straightLegs(data, names, bind, out, trousersFrom, ankle);
  for (const side of ["l", "r"]) shoe(data, names, jointIndex, bind, side, shoeTop, out);
  const skirtOut = { position: [], normal: [], uv: [], joints: [], weights: [], color: [], indices: [] };
  skirt(data, names, jointIndex, bind, skirtOut);
  for (const [name, part] of [["Outfit", out], ["Skirt", skirtOut]]) {
    const mesh = document.createMesh(name).addPrimitive(writePrimitive(document, buffer, part, material));
    bodyNode.getParentNode().addChild(document.createNode(name).setMesh(mesh).setSkin(skin));
  }
  return { sleeveCut: shortSleeve, triangles: (out.indices.length + skirtOut.indices.length) / 3 };
}
