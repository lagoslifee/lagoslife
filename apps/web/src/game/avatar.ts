import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import type { AssetContainer } from "@babylonjs/core/assetContainer";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Axis } from "@babylonjs/core/Maths/math.axis";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Quaternion } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import {
  defaultAppearance,
  MOVEMENT,
  skinTones,
  type CharacterAppearance,
  type MotionState,
} from "@lagos-living/shared";
import { GarmentPlugin, HAIR_COLOUR, OUTFITS, skinTint, type Accessory, type Body, type Hairstyle } from "./appearance";
import { dressHead, HEAD_UNIT, headAnchor, type HeadStyle } from "./avatar-style";

/**
 * Ground speed (m/s) at which each in-place clip's feet keep pace with the ground, from the foot travel
 * printed by scripts/assets/measure-gait.mjs (span over the contact share of the cycle).
 */
export const CLIP_STRIDE_SPEED = { walk: 1.0, jog: 3.9, sprint: 6.8 };

const CLIPS = ["idle", "walk", "jog", "sprint", "sit", "dance", "talk", "drive"] as const;
type ClipKey = (typeof CLIPS)[number] | "wave";

/** Hairstyles that ship as meshes in the resident GLBs; the rest are built in code (avatar-style.ts). */
const MESH_HAIR = new Set<string>(["low-fade", "parted", "buns", "long"]);

const BODY_FILES: Record<Body, string> = {
  male: "/assets/characters/resident-male-v2.glb",
  female: "/assets/characters/resident-female-v2.glb",
};

const FEMALE_HAIR: Hairstyle[] = ["buns", "long", "braids", "twists", "afro", "low-fade", "locs"];
const MALE_HAIR: Hairstyle[] = ["low-fade", "parted", "twists", "afro", "locs", "low-fade"];
const FEMALE_OUTFITS = ["ankara-dress", "office-skirt", "athleisure", "ankara-day", "island-casual", "office-smart", "ankara-dress"] as const;
const MALE_OUTFITS = ["island-casual", "office-smart", "ankara-day", "athleisure", "senator-kaftan"] as const;

/** A stable, varied look for residents the game populates (walkers, danfo crews, drivers), from a small integer seed. */
export function appearanceFor(seed: number): CharacterAppearance {
  const pick = <T,>(options: readonly T[], salt: number) => options[(Math.imul((seed + 1) * 7919 + salt, 2654435761) >>> 13) % options.length]!;
  const body: Body = pick(["male", "female"] as const, 0x7e1);
  const accessories: Accessory[] = body === "female" ? ["headwrap", "glasses", "none"] : ["beard", "cap", "glasses", "beard"];
  return {
    body,
    skinTone: pick(skinTones, 0x51),
    hairstyle: pick(body === "female" ? FEMALE_HAIR : MALE_HAIR, 0x2f1),
    outfit: pick(body === "female" ? FEMALE_OUTFITS : MALE_OUTFITS, 0x9a3),
    accessory: seed % 3 === 0 ? pick(accessories, 0x4c7) : "none",
  };
}

/** Lagos Living Ride drivers wear the yellow-and-black company uniform and cap; the face and body vary by ride. */
export function taxiDriverLook(rideKey: string): CharacterAppearance {
  let seed = 0;
  for (let index = 0; index < rideKey.length; index += 1) seed = (Math.imul(seed, 31) + rideKey.charCodeAt(index)) >>> 0;
  return { ...appearanceFor(seed % 10_000), outfit: "taxi-uniform", accessory: "cap" };
}

/** Dubai taxi drivers: mostly South Asian and Gulf men in a pressed shirt, some Emiratis in a kandura. */
export function dubaiDriverLook(rideKey: string): CharacterAppearance {
  let seed = 0;
  for (let index = 0; index < rideKey.length; index += 1) seed = (Math.imul(seed, 31) + rideKey.charCodeAt(index)) >>> 0;
  const pick = <T,>(options: readonly T[], salt: number) => options[(Math.imul(seed + salt, 2654435761) >>> 13) % options.length]!;
  return {
    body: "male",
    skinTone: pick(["golden", "warm", "light", "rich", "golden"] as const, 0x31),
    hairstyle: pick(["parted", "low-fade"] as const, 0x77),
    outfit: seed % 4 === 0 ? "kandura" : "office-smart",
    accessory: pick(["beard", "none", "beard", "glasses"] as const, 0x5d),
  };
}

export class AvatarFactory {
  private constructor(private readonly containers: Record<Body, AssetContainer>, readonly scene: Scene) {}

  static async load(scene: Scene) {
    const [male, female] = await Promise.all([LoadAssetContainerAsync(BODY_FILES.male, scene), LoadAssetContainerAsync(BODY_FILES.female, scene)]);
    return new AvatarFactory({ male, female }, scene);
  }

  create(name: string, appearance: CharacterAppearance = defaultAppearance) {
    const root = new TransformNode(`avatar ${name}`, this.scene);
    return new Avatar(this, name, root, appearance);
  }

  /** One body instance under `root`, with its own skeleton, clips and materials. */
  instantiate(name: string, root: TransformNode, appearance: CharacterAppearance) {
    const entries = this.containers[appearance.body].instantiateModelsToScene((source) => `${name}:${source}`, true, { doNotInstantiate: true });
    const holder = new TransformNode(`${name} ${appearance.body}`, this.scene);
    holder.parent = root;
    for (const node of entries.rootNodes) node.parent = holder;
    const meshes = holder.getChildMeshes(false) as AbstractMesh[];
    const part = (suffix: string) => meshes.find((mesh) => mesh.name.endsWith(`:${suffix}`) || mesh.name === suffix) ?? null;
    const skeleton = entries.skeletons[0];
    const joint = (suffix: string) => skeleton?.bones.find((bone) => bone.name === suffix || bone.name.endsWith(`:${suffix}`));
    const body = part("Body");
    const brows = part("Brows");
    const outfit = part("Outfit");
    const skirt = part("Skirt");
    const garments: GarmentPlugin[] = [];
    for (const mesh of [outfit, skirt]) if (mesh?.material instanceof PBRMaterial) garments.push(new GarmentPlugin(mesh.material, appearance));
    const hair = new Map<string, AbstractMesh>();
    for (const mesh of meshes) {
      const match = mesh.name.match(/Hair_([a-z-]+)$/);
      if (match) hair.set(match[1]!, mesh);
      mesh.isPickable = false;
      mesh.alwaysSelectAsActiveMesh = false;
    }
    const head = joint("Head");
    const left = joint("clavicle_l");
    const right = joint("clavicle_r");
    const anchor = head && left && right && body ? headAnchor(this.scene, name, body, { head, leftShoulder: left, rightShoulder: right }, HEAD_UNIT[appearance.body]) : null;
    const groups = {} as Record<ClipKey, AnimationGroup | undefined>;
    for (const key of CLIPS) groups[key] = entries.animationGroups.find((group) => group.name === `${name}:${key}` || group.name.endsWith(key));
    const node = (suffix: string) => joint(suffix)?.getTransformNode() ?? null;
    const limbs: Limbs = {
      leftUp: node("thigh_l"),
      leftLow: node("calf_l"),
      rightUp: node("thigh_r"),
      rightLow: node("calf_r"),
      leftArm: node("upperarm_l"),
      rightArm: node("upperarm_r"),
      rightFore: node("lowerarm_r"),
      leftFore: node("lowerarm_l"),
      rightHand: node("hand_r"),
    };
    const bones = new Map<string, TransformNode>();
    for (const [bone] of SLIM) {
      const found = node(bone);
      if (found) bones.set(bone, found);
    }
    return { holder, meshes, body, brows, skirt, garments, hair, anchor, groups, all: entries.animationGroups, limbs, bones };
  }
}

type Limbs = Record<"leftUp" | "leftLow" | "rightUp" | "rightLow" | "leftArm" | "rightArm" | "rightFore" | "leftFore" | "rightHand", TransformNode | null>;
export type Workout = "treadmill" | "bench" | "dumbbells" | "repair";

/**
 * The resident models are sculpted athletic. At build 0 each bone's thickness (its local Y and Z; X runs along the
 * bone) is scaled by the factor here, and each child divides out its parent's factor so only that segment thins.
 * Build 1 is the sculpted model. The clips only animate rotation and translation, so the scale holds.
 */
const SLIM: Array<[bone: string, factor: number, parent: string | null]> = [
  ["spine_02", 0.9, null],
  ["spine_03", 0.8, "spine_02"],
  ["neck_01", 1, "spine_03"],
  ["clavicle_l", 0.78, "spine_03"],
  ["clavicle_r", 0.78, "spine_03"],
  ["upperarm_l", 0.72, "clavicle_l"],
  ["upperarm_r", 0.72, "clavicle_r"],
  ["lowerarm_l", 0.8, "upperarm_l"],
  ["lowerarm_r", 0.8, "upperarm_r"],
  ["hand_l", 1, "lowerarm_l"],
  ["hand_r", 1, "lowerarm_r"],
  ["thigh_l", 0.84, null],
  ["thigh_r", 0.84, null],
  ["calf_l", 0.88, "thigh_l"],
  ["calf_r", 0.88, "thigh_r"],
  ["foot_l", 1, "calf_l"],
  ["foot_r", 1, "calf_r"],
];
type Instance = ReturnType<AvatarFactory["instantiate"]>;

const flex = new Quaternion();
/** Rotates a joint about one of its local axes, on top of the pose the clips set this frame. */
function bend(joint: TransformNode | null, angle: number, axis = Axis.X) {
  if (!joint?.rotationQuaternion) return;
  Quaternion.RotationAxisToRef(axis, angle, flex);
  joint.rotationQuaternion.multiplyInPlace(flex);
}

export class Avatar {
  private weights: Record<ClipKey, number> = { idle: 1, walk: 0, jog: 0, sprint: 0, sit: 0, wave: 0, dance: 0, talk: 0, drive: 0 };
  private started = false;
  private instance: Instance;
  private current: CharacterAppearance;
  private visible = true;
  private props: TransformNode[] = [];
  private held: TransformNode | null = null;
  private heldLift = 0;
  private sipUntil = 0;
  private waveTime = 0;
  /** Receives the meshes of each body instance, e.g. to register shadow casters again after a body change. */
  private meshListener: ((meshes: AbstractMesh[]) => void) | null = null;

  private build = 0;

  constructor(
    private readonly factory: AvatarFactory,
    private readonly name: string,
    readonly root: TransformNode,
    appearance: CharacterAppearance,
  ) {
    this.current = appearance;
    this.instance = factory.instantiate(name, root, appearance);
    this.dress();
    this.applyBuild();
  }

  /** 0 is an ordinary build, 1 the fully trained physique the models are sculpted with. */
  setBuild(build: number) {
    this.build = Math.max(0, Math.min(1, build));
    this.applyBuild();
  }

  private applyBuild() {
    const at = (factor: number) => factor + (1 - factor) * this.build;
    const factors = new Map(SLIM.map(([bone, factor]) => [bone, at(factor)]));
    for (const [bone, , parent] of SLIM) {
      const node = this.instance.bones.get(bone);
      if (!node) continue;
      const thickness = factors.get(bone)! / (parent ? factors.get(parent)! : 1);
      node.scaling.set(1, thickness, thickness);
    }
  }

  get appearance() {
    return this.current;
  }

  get meshes() {
    return this.instance.meshes;
  }

  set onMeshes(listener: ((meshes: AbstractMesh[]) => void) | null) {
    this.meshListener = listener;
    listener?.(this.instance.meshes);
  }

  setAppearance(appearance: CharacterAppearance) {
    const rebuild = appearance.body !== this.current.body;
    this.current = appearance;
    if (rebuild) {
      for (const prop of this.props) prop.parent = this.root;
      this.disposeInstance();
      this.instance = this.factory.instantiate(this.name, this.root, appearance);
      for (const prop of this.props) prop.parent = this.instance.holder;
      this.applyBuild();
      this.started = false;
      this.meshListener?.(this.instance.meshes);
    }
    this.dress();
    this.setVisible(this.visible);
  }

  /** Applies skin tone, garments, hair and accessories to the current body instance. */
  private dress() {
    const appearance = this.current;
    const { body, brows, skirt, garments, hair, anchor } = this.instance;
    if (body?.material instanceof PBRMaterial) body.material.albedoColor = skinTint(appearance);
    for (const plugin of garments) plugin.set(appearance);
    skirt?.setEnabled(OUTFITS[appearance.outfit].skirt !== null);
    const bulky = appearance.hairstyle === "afro" || appearance.hairstyle === "twists" || appearance.hairstyle === "buns";
    const showHair = appearance.accessory === "headwrap" ? false : !(appearance.accessory === "cap" && bulky);
    const hairColour = Color3.FromHexString(HAIR_COLOUR).toLinearSpace().scale(1 / 0.27);
    if (brows?.material instanceof PBRMaterial) brows.material.albedoColor = hairColour;
    for (const [style, mesh] of hair) {
      const on = (style === appearance.hairstyle && showHair && MESH_HAIR.has(style)) || (style === "beard" && appearance.accessory === "beard");
      mesh.setEnabled(on);
      if (on && mesh.material instanceof PBRMaterial) mesh.material.albedoColor = hairColour;
    }
    if (anchor) {
      const styles: HeadStyle[] = [];
      if (showHair && !MESH_HAIR.has(appearance.hairstyle)) styles.push(appearance.hairstyle);
      if (appearance.accessory === "cap" && appearance.outfit === "police-uniform") styles.push("police-cap");
      else if (appearance.accessory !== "beard" && appearance.accessory !== "none") styles.push(appearance.accessory);
      dressHead(anchor.getScene(), anchor, appearance, styles);
    }
  }

  private start() {
    if (this.started) return;
    this.started = true;
    for (const group of this.instance.all) group.stop();
    for (const [key, group] of Object.entries(this.instance.groups) as Array<[ClipKey, AnimationGroup | undefined]>) {
      if (!group) continue;
      group.start(true, 1);
      group.setWeightForAllAnimatables(this.weights[key] ?? 0);
    }
  }

  /** Blends locomotion by ground speed so stride matches movement; emotes override. */
  update(speed: number, motion: MotionState, dt: number) {
    this.start();
    const target: Record<ClipKey, number> = { idle: 0, walk: 0, jog: 0, sprint: 0, sit: 0, wave: 0, dance: 0, talk: 0, drive: 0 };
    if (motion === "sit" || motion === "dance" || motion === "drive") {
      target[motion] = 1;
    } else if (motion === "wave") {
      target.idle = 1;
    } else if (speed < 0.08) {
      target.idle = 1;
    } else if (speed <= MOVEMENT.walkSpeed) {
      const t = Math.min(1, speed / 0.6);
      target.idle = 1 - t;
      target.walk = t;
    } else if (speed <= MOVEMENT.jogSpeed) {
      const t = (speed - MOVEMENT.walkSpeed) / (MOVEMENT.jogSpeed - MOVEMENT.walkSpeed);
      target.walk = 1 - t;
      target.jog = t;
    } else {
      const t = Math.min(1, (speed - MOVEMENT.jogSpeed) / (MOVEMENT.sprintSpeed - MOVEMENT.jogSpeed));
      target.jog = 1 - t;
      target.sprint = t;
    }
    const blend = 1 - Math.exp(-dt * 14);
    for (const key of Object.keys(target) as ClipKey[]) {
      this.weights[key] += (target[key] - this.weights[key]) * blend;
      const group = this.instance.groups[key];
      if (!group) continue;
      group.setWeightForAllAnimatables(this.weights[key]);
      if (key === "walk" || key === "jog" || key === "sprint") {
        group.speedRatio = Math.max(0.35, Math.min(2.4, Math.max(speed, 0.3) / CLIP_STRIDE_SPEED[key]));
      }
    }
    if (motion === "wave") this.wave(dt);
    else this.waveTime = 0;
    if (this.held) this.holdPose(dt, motion);
  }

  /**
   * Gym movements over the clip update() just set (call after it): curls bend both forearms; the seated press pushes
   * both arms overhead and back. Repair reaches into the machine and works a spanner. The treadmill needs nothing extra
   * beyond a jog at a standstill.
   */
  exercise(kind: Workout, time: number) {
    const limbs = this.instance.limbs;
    const phase = 0.5 - 0.5 * Math.cos(time * 3.2);
    if (kind === "dumbbells") {
      bend(limbs.rightFore, 0.2 + 1.7 * phase, Axis.X);
      bend(limbs.leftFore, 0.2 + 1.7 * phase, Axis.X);
    } else if (kind === "repair") {
      const turn = Math.sin(time * 5);
      bend(limbs.rightArm, -0.75 + 0.12 * turn);
      bend(limbs.leftArm, -0.6);
      bend(limbs.rightFore, 0.7 + 0.45 * turn, Axis.X);
      bend(limbs.leftFore, 0.8, Axis.X);
    } else if (kind === "bench") {
      for (const [arm, fore, side] of [[limbs.rightArm, limbs.rightFore, 1], [limbs.leftArm, limbs.leftFore, -1]] as const) {
        bend(arm, side * (-1.2 - 1.1 * phase), Axis.Z);
        bend(fore, side * (-1.6 + 1.3 * phase), Axis.Z);
      }
    }
  }

  /** The animation library has no wave, so the right arm is raised and the forearm swings on top of idle. */
  private wave(dt: number) {
    this.waveTime += dt;
    const lift = Math.min(1, this.waveTime * 4);
    bend(this.instance.limbs.rightArm, -1.9 * lift, Axis.Z);
    bend(this.instance.limbs.rightFore, (-0.9 + Math.sin(this.waveTime * 9) * 0.45) * lift, Axis.Z);
  }

  /**
   * Pedalling over the seated clip: thighs and knees follow a crank at `phase` radians, legs half a turn
   * apart, arms reaching forward to the handlebars. Call after update() each frame while riding a bicycle.
   */
  pedal(phase: number) {
    const limbs = this.instance.limbs;
    for (const [up, low, offset] of [[limbs.leftUp, limbs.leftLow, 0], [limbs.rightUp, limbs.rightLow, Math.PI]] as const) {
      const crank = phase + offset;
      // Thigh lifts with the pedal at the top; the knee opens on the downstroke.
      bend(up, 0.5 + Math.sin(crank) * 0.32);
      bend(low, -0.35 + Math.cos(crank) * 0.38);
    }
    bend(limbs.leftArm, -0.55);
    bend(limbs.rightArm, -0.55);
  }

  /** Puts a drink or other small item in the right hand; null empties it (the caller disposes the node). */
  hold(node: TransformNode | null) {
    this.held = node;
    this.heldLift = 0;
    if (node) node.parent = null;
  }

  /** Lifts the held item to the mouth for a moment. */
  sip(seconds = 1.6) {
    this.sipUntil = performance.now() + seconds * 1_000;
  }

  /** Forearm up holding the item, raised to the mouth while sipping; the item follows the hand. */
  private holdPose(dt: number, motion: MotionState) {
    const target = performance.now() < this.sipUntil ? 1 : 0;
    this.heldLift += (target - this.heldLift) * Math.min(1, dt * 7);
    const limbs = this.instance.limbs;
    if (motion !== "dance") {
      bend(limbs.rightArm, 0.9 * this.heldLift);
      bend(limbs.rightFore, 1.4 + 0.4 * this.heldLift);
    }
    const hand = limbs.rightHand;
    const node = this.held!;
    node.setEnabled(this.visible);
    if (!hand) {
      const yaw = this.root.rotation.y;
      node.position.set(this.root.position.x + Math.sin(yaw) * 0.3 + Math.cos(yaw) * 0.2, this.root.position.y + 1.05 + this.heldLift * 0.4, this.root.position.z + Math.cos(yaw) * 0.3 - Math.sin(yaw) * 0.2);
      return;
    }
    hand.computeWorldMatrix(true);
    const at = hand.getAbsolutePosition();
    const yaw = this.root.rotation.y;
    const head = this.current.body === "female" ? 1.42 : 1.5;
    const mouth = [this.root.position.x + Math.sin(yaw) * 0.14, this.root.position.y + head - 0.07, this.root.position.z + Math.cos(yaw) * 0.14];
    const f = this.heldLift * 0.5;
    node.position.set(at.x + (mouth[0]! - at.x) * f, at.y - 0.04 + (mouth[1]! - at.y + 0.04) * f, at.z + (mouth[2]! - at.z) * f);
    node.rotation.set(0, yaw, -this.heldLift * 0.6);
  }

  /** Carries a prop (vest, tray, rifle) with the body: it shows and hides with the avatar and survives body changes. */
  attachProp(node: TransformNode) {
    this.props.push(node);
    node.parent = this.instance.holder;
  }

  setVisible(visible: boolean) {
    this.visible = visible;
    this.instance.holder.setEnabled(visible);
  }

  private disposeInstance() {
    for (const group of this.instance.all) group.dispose();
    this.instance.anchor?.dispose();
    this.instance.holder.dispose(false, true);
  }

  dispose() {
    this.disposeInstance();
    this.root.dispose(false, true);
  }
}
