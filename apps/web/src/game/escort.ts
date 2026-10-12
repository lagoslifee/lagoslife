import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { Scene } from "@babylonjs/core/scene";
import type { Vec2 } from "@lagos-living/shared";
import type { Avatar, AvatarFactory } from "./avatar";
import { equipSecurity, securityLook } from "./security-kit";
import type { VehicleFactory, VehicleView } from "./vehicles";

export type EscortLeader = { x: number; z: number; yaw: number; driving: boolean; outdoors: boolean };

type Crumb = { x: number; z: number; yaw: number };
type Guard = { avatar: Avatar; x: number; z: number; yaw: number; shown: boolean };

/** How far behind the leader's car the Hilux drives, measured along the leader's own path. */
const FOLLOW_METRES = 11;
/** Closest the Hilux ever gets to the leader's car, so it never drives into it. */
const MIN_GAP = 7.5;
const TRUCK_COLOUR = "#141617";
/** Where the two guards riding on the bed stand, in truck space (x across, z forward), and the bed floor height. */
const BED_RIDERS: Vec2[] = [[-0.42, -1.55], [0.42, -1.85]];
const BED_FLOOR = 0.95;
/** Cab roof height of the Hilux asset (its bounding height includes the mirrors and bed rails). */
const ROOF = 1.74;

type Livery = { frame: StandardMaterial; red: StandardMaterial; blue: StandardMaterial; gold: StandardMaterial; word: StandardMaterial };
let livery: Livery | null = null;

function liveryFor(scene: Scene): Livery {
  if (livery && livery.frame.getScene() === scene) return livery;
  const flat = (name: string, hex: string, glow = 0) => {
    const material = new StandardMaterial(name, scene);
    material.diffuseColor = Color3.FromHexString(hex);
    material.emissiveColor = Color3.FromHexString(hex).scale(glow);
    material.specularColor = new Color3(0.25, 0.25, 0.25);
    return material;
  };
  const texture = new DynamicTexture("escort lettering", { width: 512, height: 128 }, scene, true);
  const context = texture.getContext() as CanvasRenderingContext2D;
  context.clearRect(0, 0, 512, 128);
  context.fillStyle = "#d4af37";
  context.beginPath();
  context.moveTo(40, 20);
  context.lineTo(96, 20);
  context.lineTo(96, 70);
  context.quadraticCurveTo(96, 104, 68, 116);
  context.quadraticCurveTo(40, 104, 40, 70);
  context.closePath();
  context.fill();
  context.fillStyle = "#141617";
  context.font = "bold 52px sans-serif";
  context.textAlign = "center";
  context.fillText("★", 68, 86);
  context.fillStyle = "#f4f4f4";
  context.textAlign = "left";
  context.font = "bold 74px sans-serif";
  context.fillText("SECURITY", 118, 94);
  texture.hasAlpha = true;
  texture.update();
  const word = new StandardMaterial("escort lettering", scene);
  word.diffuseTexture = texture;
  word.useAlphaFromDiffuseTexture = true;
  word.emissiveColor = new Color3(0.45, 0.45, 0.45);
  word.specularColor = Color3.Black();
  livery = { frame: flat("escort frame", "#0b0c0d"), red: flat("escort red", "#ff2323", 1), blue: flat("escort blue", "#2563ff", 1), gold: flat("escort stripe", "#b8902c", 0.08), word };
  return livery;
}

/** Beyond this the escort has lost the leader (teleport, unstuck, long load) and reappears behind them. */
const LOST_METRES = 160;


/**
 * Hired guards in uniform and vests, carrying rifles: a black Hilux that follows the leader's route while they drive, and guards who step out and walk in
 * formation behind them on foot. One guard can be sent ahead to open a gate.
 */
export class Escort {
  private crumbs: Crumb[] = [];
  private truck: VehicleView;
  private guards: Guard[] = [];
  private wasDriving: boolean | null = null;
  private gate: { point: Vec2 } | null = null;
  private chasing: Vec2 | null = null;
  /** The entrance the leader walked in by; guards stand either side of it until the leader walks away. */
  private post: Crumb | null = null;
  private lenses: { mesh: Mesh; red: boolean }[] = [];
  private kit: Mesh[] = [];
  private time = 0;

  constructor(
    private readonly id: string,
    private readonly avatars: AvatarFactory,
    vehicles: VehicleFactory,
    private readonly ground: (x: number, z: number) => number,
    private readonly addCaster: (meshes: AbstractMesh[]) => void,
    count: number,
  ) {
    this.truck = vehicles.create(`escort ${id}`, "toyota-hilux", TRUCK_COLOUR);
    this.truck.root.setEnabled(false);
    addCaster(this.truck.meshes);
    this.dressTruck(avatars.scene);
    this.setCount(count);
  }

  get count() {
    return this.guards.length;
  }

  setCount(count: number) {
    while (this.guards.length > count) this.guards.pop()!.avatar.dispose();
    while (this.guards.length < count) {
      const index = this.guards.length;
      const avatar = this.avatars.create(`guard ${this.id} ${index}`, securityLook(index));
      equipSecurity(this.avatars.scene, avatar, true);
      avatar.onMeshes = (meshes) => this.addCaster(meshes);
      avatar.setVisible(false);
      this.guards.push({ avatar, x: 0, z: 0, yaw: 0, shown: false });
    }
  }

  /** Light bar with red and blue lenses on the cab roof, a push bar, a roll bar for the bed riders, and gold "SECURITY" livery. */
  private dressTruck(scene: Scene) {
    const look = liveryFor(scene);
    const { width, length } = this.truck.model;
    const add = (mesh: Mesh, material: StandardMaterial, x: number, y: number, z: number) => {
      mesh.material = material;
      mesh.parent = this.truck.body;
      mesh.position.set(x, y, z);
      mesh.isPickable = false;
      this.kit.push(mesh);
      return mesh;
    };
    add(MeshBuilder.CreateBox(`${this.id} bar base`, { width: 1.3, height: 0.07, depth: 0.3 }, scene), look.frame, 0, ROOF + 0.04, -0.1);
    for (const [index, x] of [-0.48, -0.16, 0.16, 0.48].entries()) {
      const red = index < 2;
      const lens = add(MeshBuilder.CreateBox(`${this.id} lens ${index}`, { width: 0.3, height: 0.12, depth: 0.24 }, scene), red ? look.red : look.blue, x, ROOF + 0.13, -0.1);
      this.lenses.push({ mesh: lens, red });
    }
    const front = length / 2 + 0.06;
    for (const side of [-1, 1]) add(MeshBuilder.CreateBox(`${this.id} push upright`, { width: 0.07, height: 0.62, depth: 0.07 }, scene), look.frame, side * 0.55, 0.62, front);
    add(MeshBuilder.CreateBox(`${this.id} push bar`, { width: 1.22, height: 0.07, depth: 0.07 }, scene), look.frame, 0, 0.92, front);
    add(MeshBuilder.CreateBox(`${this.id} push low`, { width: 1.22, height: 0.07, depth: 0.07 }, scene), look.frame, 0, 0.5, front);
    for (const side of [-1, 1]) add(MeshBuilder.CreateBox(`${this.id} roll upright`, { width: 0.07, height: 0.75, depth: 0.07 }, scene), look.frame, side * (width / 2 - 0.2), BED_FLOOR + 0.37, -0.95);
    add(MeshBuilder.CreateBox(`${this.id} roll bar`, { width: width - 0.33, height: 0.07, depth: 0.07 }, scene), look.frame, 0, BED_FLOOR + 0.75, -0.95);
    for (const side of [-1, 1]) {
      const stripe = add(MeshBuilder.CreatePlane(`${this.id} stripe`, { width: length * 0.8, height: 0.05 }, scene), look.gold, side * (width / 2 + 0.015), 0.74, 0);
      stripe.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
      const word = add(MeshBuilder.CreatePlane(`${this.id} word`, { width: 1.5, height: 0.38 }, scene), look.word, side * (width / 2 + 0.02), 1.0, -0.15);
      word.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
    }
  }

  /** Fast double-strobe: reds then blues, brighter while the convoy moves. */
  private strobe(dt: number, moving: boolean) {
    this.time += dt;
    const phase = Math.floor(this.time * (moving ? 8 : 3)) % 8;
    const redOn = phase === 0 || phase === 2;
    const blueOn = phase === 4 || phase === 6;
    for (const lens of this.lenses) lens.mesh.visibility = (lens.red ? redOn : blueOn) ? 1 : 0.35;
  }

  /** Bed rider positions in world space, standing behind the roll bar facing forward. */
  private bedSpot(slot: number) {
    const [bx, bz] = BED_RIDERS[slot]!;
    const yaw = this.truck.yaw;
    return { x: this.truck.x + Math.cos(yaw) * bx + Math.sin(yaw) * bz, z: this.truck.z - Math.sin(yaw) * bx + Math.cos(yaw) * bz, yaw };
  }

  /** Sends the guards running at a robber standing at `point`; `null` lets them fall back in. */
  chase(point: Vec2 | null) {
    this.chasing = point;
  }

  /** Sends the first guard to stand at `point` (a gate); `null` calls them back into formation. */
  sendToGate(point: Vec2 | null) {
    this.gate = point ? { point } : null;
  }

  /** True once the guard sent to a gate has reached it. */
  atGate() {
    const guard = this.guards[0];
    return Boolean(this.gate && guard?.shown && Math.hypot(guard.x - this.gate.point[0], guard.z - this.gate.point[1]) < 1.2);
  }

  private placeTruckBehind(leader: EscortLeader) {
    const x = leader.x - Math.sin(leader.yaw) * FOLLOW_METRES;
    const z = leader.z - Math.cos(leader.yaw) * FOLLOW_METRES;
    this.truck.setPose(x, this.ground(x, z), z, leader.yaw);
    this.crumbs = [{ x, z, yaw: leader.yaw }, { x: leader.x, z: leader.z, yaw: leader.yaw }];
  }

  /** Point `metres` back along the leader's recent path, or null if the path is shorter than that. */
  private along(metres: number): Crumb | null {
    let remaining = metres;
    for (let index = this.crumbs.length - 1; index > 0; index -= 1) {
      const a = this.crumbs[index]!;
      const b = this.crumbs[index - 1]!;
      const length = Math.hypot(a.x - b.x, a.z - b.z);
      if (remaining <= length) {
        const f = length ? remaining / length : 0;
        return { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f, yaw: Math.atan2(a.x - b.x, a.z - b.z) };
      }
      remaining -= length;
    }
    return null;
  }

  update(dt: number, leader: EscortLeader) {
    if (!leader.outdoors) {
      if (this.wasDriving !== null) {
        const last = this.crumbs.at(-1);
        this.post = last && Math.hypot(last.x - leader.x, last.z - leader.z) < 30 ? { ...last } : null;
      }
      this.truck.root.setEnabled(false);
      for (const guard of this.guards) this.showGuard(guard, false);
      this.wasDriving = null;
      return;
    }
    const lost = Math.hypot(this.truck.x - leader.x, this.truck.z - leader.z) > LOST_METRES;
    if (this.wasDriving === null && this.post && Math.hypot(this.post.x - leader.x, this.post.z - leader.z) < 25) {
      this.placeTruckBehind({ ...leader, x: this.post.x, z: this.post.z, yaw: this.post.yaw });
      for (const [index, guard] of this.guards.entries()) {
        const [px, pz] = this.postSpot(index);
        guard.x = px;
        guard.z = pz;
        guard.yaw = this.post.yaw + Math.PI;
        this.showGuard(guard, true);
      }
    } else if (this.wasDriving === null || lost) {
      this.post = null;
      this.placeTruckBehind(leader);
    }
    this.truck.root.setEnabled(true);

    const last = this.crumbs.at(-1);
    if (!last || Math.hypot(last.x - leader.x, last.z - leader.z) > 0.5) {
      this.crumbs.push({ x: leader.x, z: leader.z, yaw: leader.yaw });
      if (this.crumbs.length > 300) this.crumbs.shift();
    }

    if (leader.driving) {
      const target = this.along(FOLLOW_METRES);
      // Reversing or a tight U-turn folds the path back on itself; never take a spot closer than MIN_GAP to the leader.
      if (target && Math.hypot(target.x - leader.x, target.z - leader.z) >= MIN_GAP && Math.hypot(target.x - this.truck.x, target.z - this.truck.z) > 0.02) {
        this.truck.setPose(target.x, this.ground(target.x, target.z), target.z, target.yaw);
      }
      const gap = Math.hypot(this.truck.x - leader.x, this.truck.z - leader.z);
      if (gap < MIN_GAP) {
        const [ax, az] = gap > 0.1 ? [(this.truck.x - leader.x) / gap, (this.truck.z - leader.z) / gap] : [-Math.sin(leader.yaw), -Math.cos(leader.yaw)];
        const x = leader.x + ax * MIN_GAP;
        const z = leader.z + az * MIN_GAP;
        this.truck.setPose(x, this.ground(x, z), z, this.truck.yaw);
      }
      this.truck.track(dt);
      this.strobe(dt, Math.abs(this.truck.speed) > 0.5);
      let riders = 0;
      for (const [index, guard] of this.guards.entries()) {
        if (index === 0 && this.gate) this.walkGuard(guard, index, this.gate.point, null, dt, true);
        else if (riders < BED_RIDERS.length) this.rideBed(guard, riders++, dt);
        else this.showGuard(guard, false);
      }
      this.wasDriving = true;
      return;
    }

    this.truck.track(dt);
    this.strobe(dt, false);
    this.wasDriving = false;
    if (this.chasing) {
      const [rx, rz] = this.chasing;
      const facing = Math.atan2(rx - leader.x, rz - leader.z);
      for (const [index, guard] of this.guards.entries()) {
        // Fan out on the leader's side of the robber, 1.6 m short of them, rifles towards them.
        const angle = facing + Math.PI + (index - (this.guards.length - 1) / 2) * 0.6;
        const target: Vec2 = [rx + Math.sin(angle) * 1.6, rz + Math.cos(angle) * 1.6];
        this.walkGuard(guard, index, target, Math.atan2(rx - target[0], rz - target[1]), dt, true);
      }
      return;
    }
    if (this.post && Math.hypot(this.post.x - leader.x, this.post.z - leader.z) > 4) this.post = null;
    if (this.post) {
      for (const [index, guard] of this.guards.entries()) this.walkGuard(guard, index, this.postSpot(index), this.post.yaw + Math.PI, dt, false);
      return;
    }
    const forwardX = Math.sin(leader.yaw);
    const forwardZ = Math.cos(leader.yaw);
    for (const [index, guard] of this.guards.entries()) {
      if (index === 0 && this.gate) {
        this.walkGuard(guard, index, this.gate.point, null, dt, true);
        continue;
      }
      const row = Math.floor(index / 2);
      const side = index % 2 ? 1 : -1;
      const back = 1.5 + row * 1.3;
      const tx = leader.x - forwardX * back + forwardZ * side * 0.8;
      const tz = leader.z - forwardZ * back - forwardX * side * 0.8;
      this.walkGuard(guard, index, [tx, tz], leader.yaw, dt, false);
    }
  }

  /** Guards flank the entrance in pairs, facing out to the street. */
  private postSpot(index: number): Vec2 {
    const post = this.post!;
    const forwardX = Math.sin(post.yaw);
    const forwardZ = Math.cos(post.yaw);
    const side = index % 2 ? 1 : -1;
    const across = 1.6 + Math.floor(index / 2) * 1.1;
    const back = 1.2 + Math.floor(index / 2) * 0.6;
    return [post.x - forwardX * back + forwardZ * side * across, post.z - forwardZ * back - forwardX * side * across];
  }

  /** Standing on the bed, one hand on the roll bar, swaying a little with the truck. */
  private rideBed(guard: Guard, slot: number, dt: number) {
    const spot = this.bedSpot(slot);
    this.showGuard(guard, true);
    [guard.x, guard.z, guard.yaw] = [spot.x, spot.z, spot.yaw];
    guard.avatar.root.position.set(spot.x, this.ground(spot.x, spot.z) + BED_FLOOR, spot.z);
    guard.avatar.root.rotation.y = spot.yaw;
    guard.avatar.update(0, "idle", dt);
  }

  private showGuard(guard: Guard, shown: boolean) {
    if (guard.shown === shown) return;
    guard.shown = shown;
    guard.avatar.setVisible(shown);
  }

  /** Guards climb out of the Hilux by its doors, so they appear beside it rather than inside. */
  private walkGuard(guard: Guard, index: number, [tx, tz]: Vec2, restYaw: number | null, dt: number, hurry: boolean) {
    if (!guard.shown) {
      const seat = this.truck.seat(1 + (index % 4));
      const side = index % 2 ? 1 : -1;
      guard.x = seat.x + Math.cos(seat.yaw) * side;
      guard.z = seat.z - Math.sin(seat.yaw) * side;
    }
    this.showGuard(guard, true);
    const dx = tx - guard.x;
    const dz = tz - guard.z;
    const distance = Math.hypot(dx, dz);
    if (distance > 40) {
      guard.x = tx;
      guard.z = tz;
    }
    const speed = distance < 0.15 ? 0 : Math.min(hurry || distance > 4 ? 6 : 3.6, distance * 3);
    if (speed > 0) {
      const step = Math.min(distance, speed * dt);
      guard.x += (dx / distance) * step;
      guard.z += (dz / distance) * step;
      guard.yaw = Math.atan2(dx, dz);
    } else if (restYaw !== null) {
      guard.yaw = restYaw;
    }
    guard.avatar.root.position.set(guard.x, this.ground(guard.x, guard.z), guard.z);
    guard.avatar.root.rotation.y = guard.yaw;
    guard.avatar.update(speed, speed > 4.5 ? "jog" : speed > 0.2 ? "walk" : "idle", dt);
  }

  dispose() {
    for (const guard of this.guards) guard.avatar.dispose();
    this.guards = [];
    for (const mesh of this.kit) mesh.dispose();
    this.truck.dispose();
  }
}
