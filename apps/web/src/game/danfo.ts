import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import type { AssetContainer } from "@babylonjs/core/assetContainer";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { routeLength, sampleRoute, TRANSIT, type BusState } from "@lagos-living/shared";
import { appearanceFor, type Avatar, type AvatarFactory } from "./avatar";
import { MeshBuilderBatch } from "./geometry";
import type { Materials } from "./materials";
import { SignAtlas } from "./sign-atlas";

const seedOf = (id: string) => [...id].reduce((hash, char) => (Math.imul(hash, 31) + char.charCodeAt(0)) | 0, 7);

/** Model-space long axis is X; this rotation turns the bonnet toward +Z (route heading). */
export const DANFO_MODEL_YAW = -Math.PI / 2;
const SCALE = 2.3;
export const DANFO_HALF = { length: 2.25, width: 1.05 };

export class DanfoFactory {
  private constructor(private readonly container: AssetContainer, private readonly scene: Scene) {}

  static async load(scene: Scene) {
    const container = await LoadAssetContainerAsync("/assets/vehicles/danfo-shell-v1.glb", scene);
    return new DanfoFactory(container, scene);
  }

  create(id: string, materials: Materials, atlas: SignAtlas, avatars: AvatarFactory | null) {
    const root = new TransformNode(`danfo ${id}`, this.scene);
    const body = new TransformNode(`danfo body ${id}`, this.scene);
    body.parent = root;
    const entries = this.container.instantiateModelsToScene((name) => `${id}:${name}`, false, { doNotInstantiate: false });
    for (const node of entries.rootNodes) {
      node.parent = body;
    }
    body.scaling.setAll(SCALE);
    body.rotation.y = DANFO_MODEL_YAW;
    body.position.y = 0.54 * SCALE;

    const extras = new MeshBuilderBatch(`danfo ${id} board`);
    const uv = atlas.get(`${TRANSIT.routeNumber} ${TRANSIT.routeName.toUpperCase()}`, "danfo", `₦${TRANSIT.fare} · Owa o!`);
    const width = 2.6;
    const height = width / SignAtlas.aspect;
    for (const side of [1, -1]) {
      const x = side * 0.06;
      const yaw = side > 0 ? Math.PI / 2 : -Math.PI / 2;
      const rx = -Math.cos(yaw);
      const rz = Math.sin(yaw);
      const y = 2.72;
      extras.quad(
        [x - rx * width / 2, y - height / 2, -rz * width / 2],
        [x + rx * width / 2, y - height / 2, rz * width / 2],
        [x + rx * width / 2, y + height / 2, rz * width / 2],
        [x - rx * width / 2, y + height / 2, -rz * width / 2],
        [Math.sin(yaw), 0, Math.cos(yaw)],
        [[uv.u0, uv.v0], [uv.u1, uv.v0], [uv.u1, uv.v1], [uv.u0, uv.v1]],
      );
    }
    const board = extras.build(this.scene, atlas.material)!;
    board.unfreezeWorldMatrix();
    board.parent = root;
    const rack = new MeshBuilderBatch(`danfo ${id} rack`);
    rack.box(0, 2.72, 0, 0.1, height + 0.08, width + 0.1);
    rack.box(0, 2.5, 0.9, 0.05, 0.3, 0.05);
    rack.box(0, 2.5, -0.9, 0.05, 0.3, 0.05);
    const rackMesh = rack.build(this.scene, materials.rubber)!;
    rackMesh.unfreezeWorldMatrix();
    rackMesh.parent = root;

    const door = new MeshBuilderBatch(`danfo ${id} door gap`);
    door.box(0, 0, 0, 0.04, 1.55, 1.15);
    const doorMesh = door.build(this.scene, materials.rubber)!;
    doorMesh.unfreezeWorldMatrix();
    doorMesh.parent = root;
    doorMesh.position.set(DANFO_HALF.width + 0.01, 1.2, 0.35);
    doorMesh.setEnabled(false);

    let driver: Avatar | null = null;
    let conductor: Avatar | null = null;
    if (avatars) {
      driver = avatars.create(`${id}-driver`, appearanceFor(seedOf(id)));
      driver.root.parent = root;
      driver.root.position.set(-0.45, 0.35, 1.05);
      conductor = avatars.create(`${id}-conductor`, appearanceFor(seedOf(id) + 7));
      conductor.root.parent = root;
    }
    const meshes = root.getChildMeshes(false) as AbstractMesh[];
    for (const mesh of meshes) mesh.isPickable = false;
    return new DanfoView(id, root, doorMesh, meshes, driver, conductor);
  }
}

export class DanfoView {
  s = 0;
  speed = 0;
  yaw = 0;
  state: BusState | null = null;
  private initialised = false;
  private smoothYaw = 0;
  private serverS = 0;
  private serverSpeed = 0;
  private receivedAt = 0;

  constructor(
    readonly id: string,
    readonly root: TransformNode,
    private readonly door: Mesh,
    readonly meshes: AbstractMesh[],
    private readonly driver: Avatar | null,
    private readonly conductor: Avatar | null,
  ) {}

  apply(state: BusState, now: number) {
    this.state = state;
    this.serverS = state.s;
    this.serverSpeed = state.speed;
    this.receivedAt = now;
    if (!this.initialised) {
      this.s = state.s;
      this.smoothYaw = state.yaw;
      this.initialised = true;
    }
  }

  /** Advances along the route by speed, then eases toward the server's extrapolated distance. */
  update(dt: number, now: number) {
    if (!this.state) return;
    const length = routeLength();
    const predicted = this.serverS + this.serverSpeed * Math.min(0.5, (now - this.receivedAt) / 1000);
    let error = predicted - this.s;
    if (error > length / 2) error -= length;
    if (error < -length / 2) error += length;
    if (Math.abs(error) > 25) {
      this.s = predicted;
    } else {
      this.s += this.serverSpeed * dt + error * Math.min(1, dt * 2.5);
    }
    this.s = ((this.s % length) + length) % length;
    this.speed = this.serverSpeed;
    const ahead = sampleRoute(this.s + 2.2);
    const behind = sampleRoute(this.s - 2.2);
    const pose = sampleRoute(this.s);
    const targetYaw = Math.atan2(ahead.x - behind.x, ahead.z - behind.z);
    let delta = targetYaw - this.smoothYaw;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    this.smoothYaw += delta * Math.min(1, dt * 6);
    this.yaw = this.smoothYaw;
    this.root.position.set(pose.x, 0.04, pose.z);
    this.root.rotation.y = this.smoothYaw;
    const open = this.state.doorOpen;
    this.door.setEnabled(open);
    this.driver?.update(0, "sit", dt);
    if (this.conductor) {
      if (open) {
        this.conductor.root.position.set(DANFO_HALF.width + 0.45, 0, 0.35);
        this.conductor.root.rotation.y = Math.PI / 2;
        this.conductor.update(0, "wave", dt);
        this.conductor.setVisible(true);
      } else {
        this.conductor.setVisible(false);
      }
    }
  }

  /** World-space door position on the kerb (right) side. */
  doorPoint(): [number, number] {
    const rx = Math.cos(this.yaw);
    const rz = -Math.sin(this.yaw);
    return [this.root.position.x + rx * 1.4, this.root.position.z + rz * 1.4];
  }

  /** Pushes a circle out of the bus body (oriented rectangle). */
  pushOut(x: number, z: number, radius: number): [number, number] {
    const dx = x - this.root.position.x;
    const dz = z - this.root.position.z;
    const fx = Math.sin(this.yaw);
    const fz = Math.cos(this.yaw);
    const along = dx * fx + dz * fz;
    const across = dx * fz - dz * fx;
    const hl = DANFO_HALF.length + radius;
    const hw = DANFO_HALF.width + radius;
    if (Math.abs(along) >= hl || Math.abs(across) >= hw) return [x, z];
    const pushAlong = hl - Math.abs(along);
    const pushAcross = hw - Math.abs(across);
    let a = along;
    let c = across;
    if (pushAcross < pushAlong) c = Math.sign(across || 1) * hw;
    else a = Math.sign(along || 1) * hl;
    return [this.root.position.x + a * fx + c * fz, this.root.position.z + a * fz - c * fx];
  }

  dispose() {
    this.driver?.dispose();
    this.conductor?.dispose();
    this.root.dispose(false, true);
  }
}
