import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import type { AssetContainer } from "@babylonjs/core/assetContainer";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { MOVEMENT, type MotionState } from "@lagos-living/shared";

/**
 * Ground speed (m/s) at which each in-place clip's planted foot stays still,
 * measured from the rig with scripts/assets/measure-gait.mjs.
 */
export const CLIP_STRIDE_SPEED = { walk: 0.73, jog: 4.35, sprint: 6.1 };

const CLIPS = {
  idle: "Idle",
  walk: "Casual_Walk",
  jog: "Run_02",
  sprint: "RunFast",
  sit: "Chair_Sit_Idle_M",
  wave: "Big_Wave_Hello",
  dance: "Boom_Dance",
} as const;

type ClipKey = keyof typeof CLIPS;

const TINTS = ["#ffffff", "#e9d7c8", "#c9d8e8", "#d9e6cf", "#f0d6d6", "#d8d2ea"];

export class AvatarFactory {
  private constructor(private readonly container: AssetContainer, private readonly scene: Scene) {}

  static async load(scene: Scene) {
    const container = await LoadAssetContainerAsync("/assets/characters/resident-v1.glb", scene);
    return new AvatarFactory(container, scene);
  }

  create(name: string, tintIndex = 0) {
    const entries = this.container.instantiateModelsToScene((source) => `${name}:${source}`, tintIndex > 0, { doNotInstantiate: true });
    const root = new TransformNode(`avatar ${name}`, this.scene);
    for (const node of entries.rootNodes) node.parent = root;
    const meshes = root.getChildMeshes(false) as AbstractMesh[];
    if (tintIndex > 0) {
      const tint = Color3.FromHexString(TINTS[tintIndex % TINTS.length]!);
      for (const mesh of meshes) {
        if (mesh.material instanceof PBRMaterial) mesh.material.albedoColor = tint;
      }
    }
    for (const mesh of meshes) {
      mesh.isPickable = false;
      mesh.alwaysSelectAsActiveMesh = false;
    }
    const groups = {} as Record<ClipKey, AnimationGroup | undefined>;
    for (const [key, clip] of Object.entries(CLIPS) as Array<[ClipKey, string]>) {
      groups[key] = entries.animationGroups.find((group) => group.name.endsWith(clip));
    }
    return new Avatar(root, meshes, groups, entries.animationGroups);
  }
}

export class Avatar {
  private weights: Record<ClipKey, number> = { idle: 1, walk: 0, jog: 0, sprint: 0, sit: 0, wave: 0, dance: 0 };
  private started = false;

  constructor(
    readonly root: TransformNode,
    readonly meshes: AbstractMesh[],
    private readonly groups: Record<ClipKey, AnimationGroup | undefined>,
    private readonly all: AnimationGroup[],
  ) {
    for (const group of all) group.stop();
  }

  private start() {
    if (this.started) return;
    this.started = true;
    for (const [key, group] of Object.entries(this.groups) as Array<[ClipKey, AnimationGroup | undefined]>) {
      if (!group) continue;
      group.start(true, 1);
      group.setWeightForAllAnimatables(key === "idle" ? 1 : 0);
    }
  }

  /** Blends locomotion by ground speed so stride matches movement; emotes override. */
  update(speed: number, motion: MotionState, dt: number) {
    this.start();
    const target: Record<ClipKey, number> = { idle: 0, walk: 0, jog: 0, sprint: 0, sit: 0, wave: 0, dance: 0 };
    if (motion === "sit" || motion === "wave" || motion === "dance") {
      target[motion] = 1;
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
      const group = this.groups[key];
      if (!group) continue;
      this.weights[key] += (target[key] - this.weights[key]) * blend;
      group.setWeightForAllAnimatables(this.weights[key]);
      if (key === "walk" || key === "jog" || key === "sprint") {
        group.speedRatio = Math.max(0.35, Math.min(2.4, Math.max(speed, 0.3) / CLIP_STRIDE_SPEED[key]));
      }
    }
  }

  setVisible(visible: boolean) {
    for (const mesh of this.meshes) mesh.isVisible = visible;
  }

  dispose() {
    for (const group of this.all) group.dispose();
    this.root.dispose(false, true);
  }
}
