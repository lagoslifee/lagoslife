import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import type { AssetContainer } from "@babylonjs/core/assetContainer";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Node } from "@babylonjs/core/node";
import { Axis } from "@babylonjs/core/Maths/math.axis";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Quaternion } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import type { Observer } from "@babylonjs/core/Misc/observable";
import {
  defaultAppearance,
  MOVEMENT,
  skinTones,
  type CharacterAppearance,
  type MotionState,
  type Vec2,
  GYM,
} from "@lagos-living/shared";
import { GarmentPlugin, hairHex, OUTFITS, skinTint, type Accessory, type Body, type Hairstyle, type Kit } from "./appearance";
import { dressHead, HEAD_UNIT, headAnchor, type HeadStyle } from "./avatar-style";
import { shareBodyRig } from "./shared-rig";

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

/** Naija World Ride drivers wear the yellow-and-black company uniform and cap; the face and body vary by ride. */
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
    shareBodyRig(male);
    shareBodyRig(female);
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
    // Outfit and skirt share one fabric material, which takes a single garment plugin.
    const fabrics = new Set<PBRMaterial>();
    for (const mesh of [outfit, skirt]) if (mesh?.material instanceof PBRMaterial) fabrics.add(mesh.material);
    for (const material of fabrics) garments.push(new GarmentPlugin(material, appearance));
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
      leftHand: node("hand_l"),
      spine: node("spine_02"),
      chest: node("spine_03"),
      neck: node("neck_01"),
    };
    // The bind pose: standing straight with the arms out, to lay limbs flat from rather than from a clip's stance.
    const rest = new Map<TransformNode, Quaternion>();
    for (const limb of Object.values(limbs)) {
      const bone = skeleton?.bones.find((entry) => entry.getTransformNode() === limb);
      if (!limb || !bone) continue;
      const rotation = new Quaternion();
      bone.getRestMatrix().decompose(undefined, rotation);
      rest.set(limb, rotation);
    }
    const bones = new Map<string, TransformNode>();
    for (const [bone] of SLIM) {
      const found = node(bone);
      if (found) bones.set(bone, found);
    }
    return { holder, meshes, body, brows, skirt, garments, hair, anchor, groups, all: entries.animationGroups, skeletons: entries.skeletons, limbs, bones, rest };
  }
}

type Limbs = Record<"leftUp" | "leftLow" | "rightUp" | "rightLow" | "leftArm" | "rightArm" | "rightFore" | "leftFore" | "rightHand" | "leftHand" | "spine" | "chest" | "neck", TransformNode | null>;
export type Workout = "treadmill" | "bench" | "squat" | "dumbbells" | "repair";

/** Joint angles (radians) for the lifts. */
const L = {
  benchReach: 1.55, benchDrop: 0.55, benchWide: -0.25, benchFlare: -0.75, benchElbow: 1.7, benchHip: 0.25, benchKnee: 1.45,
  squatHip: -1.35, squatKnee: 1.9, squatLean: 0.5, squatArm: -1.0, squatArmBack: -0.7, squatFore: -1.3,
};
export const LIFT_TUNING = L;

const easeInOut = (t: number) => t * t * (3 - 2 * t);
const REP = GYM.repSeconds;

/**
 * How far into the rep the lift is, 0..1: the bar's depth on the bench and squat (0 at lockout, 1 on the chest or
 * at the bottom), the curl's height for dumbbells. Two seconds down, one and a half up, half a second's pause.
 */
export function liftDepth(kind: Workout, time: number) {
  const u = (((time % REP) + REP) % REP) / REP;
  if (kind === "dumbbells") return u < 0.375 ? easeInOut(u / 0.375) : u < 0.875 ? 1 - easeInOut((u - 0.375) / 0.5) : 0;
  if (kind === "bench" || kind === "squat") return u < 0.5 ? easeInOut(u / 0.5) : u < 0.875 ? 1 - easeInOut((u - 0.5) / 0.375) : 0;
  return 0;
}

/** True while the lifter is pushing against the weight (where a heavy rep shakes). */
function liftDriving(kind: Workout, time: number) {
  const u = (((time % REP) + REP) % REP) / REP;
  return kind === "dumbbells" ? u < 0.375 : kind === "bench" || kind === "squat" ? u >= 0.5 && u < 0.875 : false;
}

/**
 * The resident models are sculpted athletic. At build 0 each bone's thickness (its local X and Z; Y runs along the
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
/** Extra slimming on the female body, on top of SLIM, for a softer frame through the arms and shoulders. */
const FEMALE_SLIM: Record<string, number> = {
  spine_03: 0.94,
  clavicle_l: 0.9,
  clavicle_r: 0.9,
  upperarm_l: 0.84,
  upperarm_r: 0.84,
  lowerarm_l: 0.88,
  lowerarm_r: 0.88,
  calf_l: 0.94,
  calf_r: 0.94,
};
const FEMALE_BUILD_MAX = 0.4;
type Instance = ReturnType<AvatarFactory["instantiate"]>;

/** Joint angles (radians) for the sleeping and lounging poses. */
const P = { sleepArm: 0.5, sleepIn: 1.35, sleepFore: 1.7, sleepHead: 0.5, sleepLegs: 0, sleepKnee: 0.08, readIn: 1.2, readUp: 0.62, readFore: 1.4, readHead: 0.35, readLieIn: 1.0, readLieUp: 1.35, readLieFore: 1.2, readLieHead: 0.45, loungeBack: -0.35, loungeArm: -1.2, loungeArmBack: -0.3, loungeFore: 0.9, loungeLegs: 0.4 };
/** Sitting on the ground (radians), over the chair-sit clip; exported so the pose can be tuned. */
export const GROUND_SIT = { leftKnee: -1.25, rightKnee: -0.8, thighUp: 0, lean: -0.3, armDown: 1.1, armBack: -0.55 };
const G = GROUND_SIT;
/** Carrying and handing over a held item (radians, metres). */
const HOLD = { offerArm: 0.75, offerFore: 0.7, trayAbove: 0.04 };
/** Swimming pose numbers (radians, metres, cycles); exported so the pose preview can tune them live. */
export const SWIM_TUNING = {
  strokeRate: 3.2,
  headUp: 0.1,
  hipsFromFeet: 0.95,
  depth: 0.14,
  armDown: 1.35,
  armOut: 0.9,
  recoverReach: 1.0,
  pullBend: 0.5,
  recoverBend: 1.4,
  kickRate: 9,
  kick: 0.14,
  kickKnee: 0.2,
  roll: 0.3,
  look: 0.35,
  breath: 0.9,
  treadDepth: 1.42,
  treadArm: 1.1,
  treadForward: 0.7,
  treadHip: 0.6,
  treadKnee: 0.9,
  floatDepth: 0.1,
  floatArm: 0.35,
};
const S = SWIM_TUNING;

export const POSE_TUNING = P;
/** The hip joints sit this far above the surface you sit on (the sit bones and flesh below them). */
const HIP_ABOVE_CUSHION = 0.1;
const flex = new Quaternion();
/** Rotates a joint about one of its local axes, on top of the pose the clips set this frame. */
/**
 * Recomputes `node`'s world matrix from the top of its hierarchy down. Forcing only the node itself multiplies by
 * its parents' matrices as cached at the last render, which trail this frame's pose (and the root's move) by a frame.
 */
function fresh(node: TransformNode) {
  const chain: TransformNode[] = [];
  for (let at: Node | null = node; at; at = at.parent) if (at instanceof TransformNode) chain.push(at);
  for (let index = chain.length - 1; index >= 0; index -= 1) chain[index]!.computeWorldMatrix(true);
}

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
  private kit: Kit | null = null;
  private visible = true;
  private props: TransformNode[] = [];
  private held: TransformNode | null = null;
  private heldLift = 0;
  private sipUntil = 0;
  private heldGrip: "hand" | "tray" = "hand";
  private offerUntil = 0;
  private offerLift = 0;
  private waveTime = 0;
  /** Receives the meshes of each body instance, e.g. to register shadow casters again after a body change. */
  private meshListener: ((meshes: AbstractMesh[]) => void) | null = null;

  private build = 0;
  private follow: Observer<Scene> | null = null;

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
    this.follow = root.getScene().onBeforeRenderObservable.add(() => this.syncDetached());
  }

  /**
   * The head anchor hangs off a bone and a held item has no parent, so neither inherits the body's enabled state;
   * without this a hidden avatar leaves its cap, glasses or drink floating where it last stood.
   */
  private syncDetached() {
    const shown = this.instance.holder.isEnabled(true);
    const anchor = this.instance.anchor;
    if (anchor && anchor.isEnabled(false) !== shown) anchor.setEnabled(shown);
    if (this.held && this.held.isEnabled(false) !== shown) this.held.setEnabled(shown);
  }

  /** 0 is an ordinary build, 1 the fully trained physique the models are sculpted with. */
  setBuild(build: number) {
    this.build = Math.max(0, Math.min(1, build));
    this.applyBuild();
  }

  private applyBuild() {
    const female = this.current.body === "female";
    // Training tones a woman's figure; it never reaches the sculpted bodybuilder arms and shoulders.
    const build = female ? this.build * FEMALE_BUILD_MAX : this.build;
    const at = (factor: number) => factor + (1 - factor) * build;
    const factors = new Map(SLIM.map(([bone, factor]) => [bone, at(factor) * (female ? FEMALE_SLIM[bone] ?? 1 : 1)]));
    for (const [bone, , parent] of SLIM) {
      const node = this.instance.bones.get(bone);
      if (!node) continue;
      const thickness = factors.get(bone)! / (parent ? factors.get(parent)! : 1);
      node.scaling.set(thickness, 1, thickness);
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

  /** Puts on (or takes off, with null) a team kit over the outfit for a match. */
  setKit(kit: Kit | null) {
    if (kit?.shirt === this.kit?.shirt && kit?.shorts === this.kit?.shorts) return;
    this.kit = kit;
    this.dress();
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
    for (const plugin of garments) plugin.set(appearance, this.kit);
    skirt?.setEnabled(!this.kit && OUTFITS[appearance.outfit].skirt !== null);
    const bulky = appearance.hairstyle === "afro" || appearance.hairstyle === "twists" || appearance.hairstyle === "buns";
    const showHair = appearance.accessory === "headwrap" ? false : !(appearance.accessory === "cap" && bulky);
    const hairColour = Color3.FromHexString(hairHex(appearance)).toLinearSpace().scale(1 / 0.27);
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
   * Gym movements over the clip update() just set (call after it), one rep every `GYM.repSeconds`: the bench press
   * (over idle, the caller lays the root on its back) lowers the bar to the chest and presses it up; the squat (over
   * idle, the caller drops the root by `liftDepth`) sits back with the bar on the upper back; curls bring both
   * dumbbells up to the shoulders. `strain` (0..1, how close the weight is to your limit) slows the press and makes it
   * shake. Repair reaches into the machine and works a spanner; the treadmill needs nothing beyond the jog clip.
   */
  exercise(kind: Workout, time: number, strain = 0) {
    const limbs = this.instance.limbs;
    const depth = liftDepth(kind, time);
    const shake = liftDriving(kind, time) ? Math.sin(time * 47) * 0.035 * strain : 0;
    if (kind === "dumbbells") {
      for (const [arm, fore] of [[limbs.rightArm, limbs.rightFore], [limbs.leftArm, limbs.leftFore]] as const) {
        bend(arm, 0.12 + 0.15 * depth);
        bend(fore, 0.25 + 1.95 * depth + shake, Axis.X);
      }
      bend(limbs.spine, -0.04 * depth);
    } else if (kind === "repair") {
      const turn = Math.sin(time * 5);
      bend(limbs.rightArm, 0.85 + 0.12 * turn);
      bend(limbs.leftArm, 0.75);
      bend(limbs.rightFore, 0.5 + 0.45 * turn, Axis.X);
      bend(limbs.leftFore, 0.6, Axis.X);
    } else if (kind === "bench") {
      // Arms straight up over the chest at the top; elbows out and bent with the bar on the chest at the bottom.
      for (const [arm, fore, side] of [[limbs.rightArm, limbs.rightFore, 1], [limbs.leftArm, limbs.leftFore, -1]] as const) {
        bend(arm, L.benchReach - L.benchDrop * depth + shake);
        bend(arm, side * (L.benchWide + L.benchFlare * depth), Axis.Z);
        bend(fore, L.benchElbow * depth, Axis.X);
      }
      bend(limbs.leftUp, L.benchHip);
      bend(limbs.rightUp, L.benchHip);
      bend(limbs.leftLow, L.benchKnee);
      bend(limbs.rightLow, L.benchKnee);
    } else if (kind === "squat") {
      bend(limbs.leftUp, L.squatHip * depth);
      bend(limbs.rightUp, L.squatHip * depth);
      bend(limbs.leftLow, L.squatKnee * depth);
      bend(limbs.rightLow, L.squatKnee * depth);
      bend(limbs.spine, L.squatLean * depth + shake);
      bend(limbs.neck, -L.squatLean * 0.7 * depth);
      // Hands wide on the bar across the upper back.
      for (const [arm, fore, side] of [[limbs.rightArm, limbs.rightFore, 1], [limbs.leftArm, limbs.leftFore, -1]] as const) {
        bend(arm, side * L.squatArm, Axis.Z);
        bend(arm, L.squatArmBack);
        bend(fore, side * L.squatFore, Axis.Z);
      }
    }
  }

  /** Where each palm closes this frame (a little past the wrist, along the forearm), for the bar or dumbbells they hold. */
  grips() {
    const { leftHand, rightHand, leftFore, rightFore } = this.instance.limbs;
    if (!leftHand || !rightHand || !leftFore || !rightFore) return null;
    const palm = (wrist: TransformNode, elbow: TransformNode) => {
      fresh(wrist);
      const at = wrist.getAbsolutePosition().clone();
      const along = at.subtract(elbow.getAbsolutePosition());
      return at.addInPlace(along.normalize().scaleInPlace(0.075));
    };
    return { left: palm(leftHand, leftFore), right: palm(rightHand, rightFore) };
  }

  /**
   * Moves the seated body so the hips rest on the seat: just above a cushion at `cushionY` and, given `hip`, centred
   * over that point, whatever the sit clip (made for a chair, with the feet on the floor ahead of the hips) did with
   * them. Call after update() and any pose on top.
   */
  seatHips(cushionY: number, hip?: Vec2) {
    const { leftUp, rightUp } = this.instance.limbs;
    if (!leftUp || !rightUp) return;
    this.root.computeWorldMatrix(true);
    leftUp.computeWorldMatrix(true);
    rightUp.computeWorldMatrix(true);
    const left = leftUp.getAbsolutePosition();
    const right = rightUp.getAbsolutePosition();
    const dy = cushionY + HIP_ABOVE_CUSHION - (left.y + right.y) / 2;
    const dx = hip ? hip[0] - (left.x + right.x) / 2 : 0;
    const dz = hip ? hip[1] - (left.z + right.z) / 2 : 0;
    this.root.position.addInPlaceFromFloats(dx, dy, dz);
    // The held item was placed at the hand before the body moved onto the seat.
    this.held?.position.addInPlaceFromFloats(dx, dy, dz);
    this.root.computeWorldMatrix(true);
  }

  /** Roughly where the eyes are this frame, and which way is up the body (toward the crown), for things held to be looked at. */
  headPoint() {
    const { neck, chest } = this.instance.limbs;
    if (!neck || !chest) return null;
    neck.computeWorldMatrix(true);
    chest.computeWorldMatrix(true);
    const at = neck.getAbsolutePosition().clone();
    const up = at.subtract(chest.getAbsolutePosition()).normalize();
    const face = this.root.getDirection(Axis.Z).normalize();
    return { eyes: at.add(up.scale(0.11)).addInPlace(face.scale(0.09)), up };
  }

  /**
   * Reading, over the sit clip or (lying, the caller lays the root flat) the idle one: both hands hold an open book
   * up in front of the face, the head tipped toward it.
   */
  read(time: number, lying = false) {
    const limbs = this.instance.limbs;
    const sway = Math.sin(time * 0.8) * 0.02;
    for (const limb of [limbs.leftArm, limbs.rightArm, limbs.leftFore, limbs.rightFore]) this.relax(limb);
    if (lying) for (const limb of [limbs.leftUp, limbs.rightUp, limbs.leftLow, limbs.rightLow]) this.relax(limb);
    if (lying) {
      bend(limbs.leftLow, P.sleepKnee);
      bend(limbs.rightLow, P.sleepKnee);
    }
    for (const [arm, fore, side] of [[limbs.rightArm, limbs.rightFore, 1], [limbs.leftArm, limbs.leftFore, -1]] as const) {
      if (lying) {
        bend(arm, side * P.readLieIn, Axis.Z);
        bend(arm, P.readLieUp + sway);
        bend(fore, P.readLieFore);
      } else {
        bend(arm, side * P.readIn, Axis.Z);
        bend(arm, P.readUp + sway);
        bend(fore, P.readFore);
      }
    }
    bend(limbs.neck, lying ? P.readLieHead : P.readHead);
  }

  /** The shoulder joints and neck this frame, for a bar resting across the upper back in the squat. */
  shoulders() {
    const { leftArm, rightArm, neck } = this.instance.limbs;
    if (!leftArm || !rightArm || !neck) return null;
    for (const bone of [leftArm, rightArm, neck]) fresh(bone);
    return { left: leftArm.getAbsolutePosition().clone(), right: rightArm.getAbsolutePosition().clone(), neck: neck.getAbsolutePosition().clone() };
  }

  /**
   * Asleep on the back, over the idle clip (the caller lays the root flat): hands folded on the belly, head rolled to
   * one side, and slow breathing.
   */
  sleep(time: number) {
    const limbs = this.instance.limbs;
    const breath = Math.sin(time * 1.3);
    // Legs straight and together and arms from the bind pose, not the idle clip's stance.
    for (const limb of [limbs.leftUp, limbs.rightUp, limbs.leftLow, limbs.rightLow, limbs.leftArm, limbs.rightArm, limbs.leftFore, limbs.rightFore]) this.relax(limb);
    bend(limbs.leftUp, P.sleepLegs, Axis.Z);
    bend(limbs.rightUp, -P.sleepLegs, Axis.Z);
    bend(limbs.leftLow, P.sleepKnee);
    bend(limbs.rightLow, P.sleepKnee);
    bend(limbs.rightArm, P.sleepArm);
    bend(limbs.leftArm, P.sleepArm);
    bend(limbs.rightArm, P.sleepIn, Axis.Z);
    bend(limbs.leftArm, -P.sleepIn, Axis.Z);
    bend(limbs.rightFore, P.sleepFore);
    bend(limbs.leftFore, P.sleepFore);
    bend(limbs.neck, P.sleepHead, Axis.Y);
    bend(limbs.chest, breath * 0.025);
  }

  /**
   * In the water, over the idle clip; `surface` is the water level and the root stands at the swimmer's point.
   * "crawl" lays the body face down along the way it faces with the hips at the point and swims front crawl: arms
   * turning over in turn, a flutter kick and a breath to the side every stroke. "tread" keeps the head up in deep
   * water, sculling; "float" lies back on the surface, arms out, for pools too shallow to tread in.
   */
  swim(time: number, mode: "crawl" | "tread" | "float", surface: number) {
    const limbs = this.instance.limbs;
    for (const limb of [limbs.leftUp, limbs.rightUp, limbs.leftLow, limbs.rightLow, limbs.leftArm, limbs.rightArm, limbs.leftFore, limbs.rightFore]) this.relax(limb);
    const yaw = this.root.rotation.y;
    const [fx, fz] = [Math.sin(yaw), Math.cos(yaw)];
    if (mode === "crawl") {
      const stroke = time * S.strokeRate;
      this.root.rotation.x = Math.PI / 2 - S.headUp;
      this.root.position.x -= fx * S.hipsFromFeet;
      this.root.position.z -= fz * S.hipsFromFeet;
      this.root.position.y = surface - S.depth;
      for (const [arm, fore, side, phase] of [[limbs.rightArm, limbs.rightFore, 1, 0], [limbs.leftArm, limbs.leftFore, -1, Math.PI]] as const) {
        const angle = (stroke + phase) % (Math.PI * 2);
        // Pull: the arm sweeps from overhead down under the body to the hip; recovery: elbow high, out over the water.
        const pulling = angle < Math.PI;
        const lift = pulling ? 0 : Math.sin(angle - Math.PI);
        bend(arm, side * (S.armDown - S.armOut * lift), Axis.Z);
        bend(arm, pulling ? Math.PI - angle : -(angle - Math.PI) * S.recoverReach);
        bend(fore, pulling ? S.pullBend * Math.sin(angle) : S.recoverBend * lift);
      }
      const kick = Math.sin(time * S.kickRate);
      bend(limbs.leftUp, S.kick * kick);
      bend(limbs.rightUp, -S.kick * kick);
      bend(limbs.leftLow, S.kickKnee * (0.6 + 0.4 * kick));
      bend(limbs.rightLow, S.kickKnee * (0.6 - 0.4 * kick));
      bend(limbs.spine, Math.sin(stroke) * S.roll, Axis.Y);
      bend(limbs.neck, -S.look);
      const breathe = Math.max(0, Math.sin(stroke - 0.6)) ** 6;
      bend(limbs.neck, breathe * S.breath, Axis.Y);
    } else if (mode === "tread") {
      const scull = Math.sin(time * 2.6);
      this.root.rotation.x = 0;
      this.root.position.y = surface - S.treadDepth;
      for (const [arm, fore, side] of [[limbs.rightArm, limbs.rightFore, 1], [limbs.leftArm, limbs.leftFore, -1]] as const) {
        bend(arm, side * S.treadArm, Axis.Z);
        bend(arm, S.treadForward + scull * 0.25);
        bend(fore, 0.5 + 0.2 * scull);
      }
      const pedal = Math.sin(time * 2.2);
      bend(limbs.leftUp, -S.treadHip + 0.3 * pedal);
      bend(limbs.rightUp, -S.treadHip - 0.3 * pedal);
      bend(limbs.leftLow, S.treadKnee - 0.35 * pedal);
      bend(limbs.rightLow, S.treadKnee + 0.35 * pedal);
    } else {
      const drift = Math.sin(time * 0.9);
      // On the back with the head still the way they were swimming, so stopping does not spin them round.
      this.root.rotation.y = yaw + Math.PI;
      this.root.rotation.x = -Math.PI / 2;
      this.root.position.x -= fx * S.hipsFromFeet;
      this.root.position.z -= fz * S.hipsFromFeet;
      this.root.position.y = surface - S.floatDepth;
      bend(limbs.rightArm, S.floatArm + drift * 0.08, Axis.Z);
      bend(limbs.leftArm, -S.floatArm - drift * 0.08, Axis.Z);
      bend(limbs.leftUp, 0.12, Axis.Z);
      bend(limbs.rightUp, -0.12, Axis.Z);
      bend(limbs.neck, -0.25);
    }
  }

  /** Puts a joint back in its bind pose, dropping whatever the clips did to it this frame. */
  private relax(joint: TransformNode | null) {
    const rest = joint && this.instance.rest.get(joint);
    if (rest && joint.rotationQuaternion) joint.rotationQuaternion.copyFrom(rest);
  }

  /**
   * Sitting on the ground with nothing to sit on, over the chair clip: knees opened out so the legs lie forward on
   * the ground, leaning back on both hands planted behind, hips dropped to `groundY`. Without it the chair pose
   * hangs in mid-air.
   */
  sitGround(groundY: number, time: number) {
    const limbs = this.instance.limbs;
    const sway = Math.sin(time * 0.5) * 0.02;
    bend(limbs.leftLow, G.leftKnee);
    bend(limbs.rightLow, G.rightKnee);
    bend(limbs.leftUp, G.thighUp);
    bend(limbs.rightUp, G.thighUp * 0.6);
    bend(limbs.spine, G.lean + sway);
    bend(limbs.neck, -G.lean * 0.7);
    for (const [arm, fore, side] of [[limbs.rightArm, limbs.rightFore, 1], [limbs.leftArm, limbs.leftFore, -1]] as const) {
      this.relax(arm);
      this.relax(fore);
      bend(arm, side * G.armDown, Axis.Z);
      bend(arm, G.armBack);
    }
    this.seatHips(groundY);
  }

  /** Chilling on a sofa, over the sit clip: leaning back, one arm along the backrest, legs stretched out a little. */
  lounge(time: number) {
    const limbs = this.instance.limbs;
    const sway = Math.sin(time * 0.6) * 0.03;
    bend(limbs.spine, P.loungeBack + sway);
    bend(limbs.neck, -P.loungeBack * 0.6);
    bend(limbs.rightArm, P.loungeArm, Axis.Z);
    bend(limbs.rightArm, P.loungeArmBack);
    bend(limbs.rightFore, P.loungeFore, Axis.Z);
    bend(limbs.leftLow, P.loungeLegs);
    bend(limbs.rightLow, P.loungeLegs * 0.6);
    bend(limbs.leftUp, -P.loungeLegs * 0.4);
  }

  /** Both arms thrown up and pumping after a goal, over the sit or idle clip. */
  cheer(time: number) {
    const limbs = this.instance.limbs;
    const pump = Math.sin(time * 11);
    for (const [arm, fore, side] of [[limbs.rightArm, limbs.rightFore, 1], [limbs.leftArm, limbs.leftFore, -1]] as const) {
      bend(arm, side * (-2.45 - 0.2 * pump), Axis.Z);
      bend(fore, side * (-0.35 + 0.35 * pump), Axis.Z);
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
  hold(node: TransformNode | null, grip: "hand" | "tray" = "hand") {
    this.held = node;
    this.heldLift = 0;
    this.heldGrip = grip;
    this.offerLift = 0;
    if (node) node.parent = null;
  }

  /** Lifts the held item to the mouth for a moment. */
  sip(seconds = 1.6) {
    this.sipUntil = performance.now() + seconds * 1_000;
  }

  /** Reaches the held item out in front, as a waiter does handing an order over. */
  offer(seconds = 1.4) {
    this.offerUntil = performance.now() + seconds * 1_000;
  }

  /** Forearm up holding the item, raised to the mouth while sipping; the item follows the hand. */
  private holdPose(dt: number, motion: MotionState) {
    const now = performance.now();
    this.heldLift += ((now < this.sipUntil ? 1 : 0) - this.heldLift) * Math.min(1, dt * 7);
    this.offerLift += ((now < this.offerUntil ? 1 : 0) - this.offerLift) * Math.min(1, dt * 5);
    const limbs = this.instance.limbs;
    if (motion !== "dance") {
      bend(limbs.rightArm, 0.9 * this.heldLift + HOLD.offerArm * this.offerLift);
      bend(limbs.rightFore, 1.4 + 0.4 * this.heldLift - HOLD.offerFore * this.offerLift);
    }
    const hand = limbs.rightHand;
    const node = this.held!;
    if (!hand) {
      const yaw = this.root.rotation.y;
      node.position.set(this.root.position.x + Math.sin(yaw) * 0.3 + Math.cos(yaw) * 0.2, this.root.position.y + 1.05 + this.heldLift * 0.4, this.root.position.z + Math.cos(yaw) * 0.3 - Math.sin(yaw) * 0.2);
      return;
    }
    fresh(hand);
    const at = hand.getAbsolutePosition();
    const yaw = this.root.rotation.y;
    if (this.heldGrip === "tray") {
      // Flat on the palm: the tray sits just above the hand and never tilts, however the arm swings.
      node.position.set(at.x, at.y + HOLD.trayAbove, at.z);
      node.rotation.set(0, yaw, 0);
      return;
    }
    const head = this.current.body === "female" ? 1.42 : 1.5;
    const mouth = [this.root.position.x + Math.sin(yaw) * 0.14, this.root.position.y + head - 0.07, this.root.position.z + Math.cos(yaw) * 0.14];
    const f = this.heldLift * 0.5;
    node.position.set(at.x + (mouth[0]! - at.x) * f, at.y - 0.04 + (mouth[1]! - at.y + 0.04) * f, at.z + (mouth[2]! - at.z) * f);
    node.rotation.set(0, yaw, -this.heldLift * 0.6);
  }

  get female() {
    return this.current.body === "female";
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
    // Meshes don't take their skeleton (and its bone texture) with them, so every avatar that left the area leaked one.
    for (const skeleton of this.instance.skeletons) skeleton.dispose();
  }

  dispose() {
    this.follow?.remove();
    this.follow = null;
    this.disposeInstance();
    this.root.dispose(false, true);
  }
}
