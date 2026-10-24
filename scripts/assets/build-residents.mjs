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
import { ARM, dominant, FOOT, garments, HAND, LEG, read, weightOf, writePrimitive } from "./lib/garments.mjs";

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
    if (other.getMesh() && other !== node && !other.getName().startsWith("Hair_") && other.getName() !== "Outfit" && other.getName() !== "Skirt") {
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
