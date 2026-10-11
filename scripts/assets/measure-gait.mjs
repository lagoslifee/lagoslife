#!/usr/bin/env node
// Measures the ground speed implied by each locomotion clip: during foot
// contact, the planted foot moves backwards relative to the hips at the
// speed the character should travel to avoid sliding.
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const file = process.argv[2] ?? path.join(root, "apps/web/public/assets/characters/resident-male-v2.glb");
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const document = await io.read(file);
const graph = document.getRoot();

function sample(sampler, time) {
  const input = sampler.getInput().getArray();
  const output = sampler.getOutput().getArray();
  const size = sampler.getOutput().getElementSize();
  let index = 0;
  while (index < input.length - 2 && input[index + 1] < time) index += 1;
  const t0 = input[index];
  const t1 = input[Math.min(index + 1, input.length - 1)];
  const f = t1 > t0 ? Math.min(1, Math.max(0, (time - t0) / (t1 - t0))) : 0;
  const a = Array.from(output.slice(index * size, index * size + size));
  const b = Array.from(output.slice((index + 1) * size, (index + 1) * size + size));
  if (b.length < size) return a;
  if (size === 4) {
    let dot = a.reduce((sum, value, i) => sum + value * b[i], 0);
    const sign = dot < 0 ? -1 : 1;
    const q = a.map((value, i) => value * (1 - f) + b[i] * sign * f);
    const length = Math.hypot(...q);
    return q.map((value) => value / length);
  }
  return a.map((value, i) => value * (1 - f) + b[i] * f);
}

function compose(t, r, s) {
  const [x, y, z, w] = r;
  const m = [
    (1 - 2 * (y * y + z * z)) * s[0], 2 * (x * y + z * w) * s[0], 2 * (x * z - y * w) * s[0], 0,
    2 * (x * y - z * w) * s[1], (1 - 2 * (x * x + z * z)) * s[1], 2 * (y * z + x * w) * s[1], 0,
    2 * (x * z + y * w) * s[2], 2 * (y * z - x * w) * s[2], (1 - 2 * (x * x + y * y)) * s[2], 0,
    t[0], t[1], t[2], 1,
  ];
  return m;
}
function multiply(a, b) {
  const out = new Array(16).fill(0);
  for (let c = 0; c < 4; c += 1) for (let r = 0; r < 4; r += 1) {
    for (let k = 0; k < 4; k += 1) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  }
  return out;
}

const parents = new Map();
for (const node of graph.listNodes()) for (const child of node.listChildren()) parents.set(child, node);
const byName = (name) => graph.listNodes().find((node) => node.getName() === name);

for (const animation of graph.listAnimations()) {
  const channels = new Map();
  let duration = 0;
  for (const channel of animation.listChannels()) {
    const key = `${channel.getTargetNode().getName()}:${channel.getTargetPath()}`;
    channels.set(key, channel.getSampler());
    duration = Math.max(duration, channel.getSampler().getInput().getMax([])[0]);
  }
  const world = (node, time) => {
    const local = (path, fallback) => {
      const sampler = channels.get(`${node.getName()}:${path}`);
      return sampler ? sample(sampler, time) : fallback;
    };
    const matrix = compose(local("translation", node.getTranslation()), local("rotation", node.getRotation()), local("scale", node.getScale()));
    const parent = parents.get(node);
    return parent ? multiply(world(parent, time), matrix) : matrix;
  };
  const hips = byName("Hips") ?? byName("pelvis");
  const feet = (byName("LeftFoot") ? ["LeftFoot", "RightFoot"] : ["foot_l", "foot_r"]).map(byName).filter(Boolean);
  const steps = 120;
  const rel = feet.map(() => []);
  const hipPath = [];
  for (let i = 0; i <= steps; i += 1) {
    const time = (duration * i) / steps;
    const h = world(hips, time);
    hipPath.push([h[12], h[13], h[14]]);
    feet.forEach((foot, index) => {
      const f = world(foot, time);
      rel[index].push([f[12] - h[12], f[13], f[14] - h[14]]);
    });
  }
  const rootTravel = Math.hypot(hipPath.at(-1)[0] - hipPath[0][0], hipPath.at(-1)[2] - hipPath[0][2]);
  // Contact phase: frames where the foot is within 2 cm of its lowest height.
  const speeds = rel.map((pathPoints) => {
    const minY = Math.min(...pathPoints.map((p) => p[1]));
    const contact = [];
    for (let i = 1; i < pathPoints.length; i += 1) {
      if (pathPoints[i][1] < minY + 0.03 && pathPoints[i - 1][1] < minY + 0.03) {
        const dt = duration / steps;
        contact.push(Math.hypot(pathPoints[i][0] - pathPoints[i - 1][0], pathPoints[i][2] - pathPoints[i - 1][2]) / dt);
      }
    }
    contact.sort((a, b) => a - b);
    return contact.length ? contact[Math.floor(contact.length / 2)] : 0;
  });
  const spans = rel.map((pathPoints) => Math.max(...pathPoints.map((p) => p[2])) - Math.min(...pathPoints.map((p) => p[2])));
  console.log(
    `${animation.getName().padEnd(28)} duration ${duration.toFixed(2)}s  root travel ${rootTravel.toFixed(2)}m  contact speed L ${speeds[0]?.toFixed(2)} R ${speeds[1]?.toFixed(2)} m/s  foot span ${spans.map((s) => s.toFixed(2)).join("/")} m`,
  );
}
