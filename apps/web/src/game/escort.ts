import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { CharacterAppearance, Vec2 } from "@lagos-living/shared";
import type { Avatar, AvatarFactory } from "./avatar";
import type { VehicleFactory, VehicleView } from "./vehicles";

export type EscortLeader = { x: number; z: number; yaw: number; driving: boolean; outdoors: boolean };

type Crumb = { x: number; z: number; yaw: number };
type Guard = { avatar: Avatar; x: number; z: number; yaw: number; shown: boolean };

/** How far behind the leader's car the Hilux drives, measured along the leader's own path. */
const FOLLOW_METRES = 11;
const TRUCK_COLOUR = "#141617";
/** Beyond this the escort has lost the leader (teleport, unstuck, long load) and reappears behind them. */
const LOST_METRES = 160;

const SKINS: CharacterAppearance["skinTone"][] = ["deep", "rich", "warm", "rich"];

function guardLook(index: number): CharacterAppearance {
  return { body: "male", skinTone: SKINS[index % SKINS.length]!, hairstyle: "low-fade", outfit: "office-smart", accessory: index % 2 ? "glasses" : "none" };
}

/**
 * Hired guards: a black Hilux that follows the leader's route while they drive, and guards who step out and walk in
 * formation behind them on foot. One guard can be sent ahead to open a gate.
 */
export class Escort {
  private crumbs: Crumb[] = [];
  private truck: VehicleView;
  private guards: Guard[] = [];
  private wasDriving: boolean | null = null;
  private gate: { point: Vec2 } | null = null;

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
    this.setCount(count);
  }

  get count() {
    return this.guards.length;
  }

  setCount(count: number) {
    while (this.guards.length > count) this.guards.pop()!.avatar.dispose();
    while (this.guards.length < count) {
      const index = this.guards.length;
      const avatar = this.avatars.create(`guard ${this.id} ${index}`, guardLook(index));
      avatar.onMeshes = (meshes) => this.addCaster(meshes);
      avatar.setVisible(false);
      this.guards.push({ avatar, x: 0, z: 0, yaw: 0, shown: false });
    }
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
      this.truck.root.setEnabled(false);
      for (const guard of this.guards) this.showGuard(guard, false);
      this.wasDriving = null;
      return;
    }
    const lost = Math.hypot(this.truck.x - leader.x, this.truck.z - leader.z) > LOST_METRES;
    if (this.wasDriving === null || lost) this.placeTruckBehind(leader);
    this.truck.root.setEnabled(true);

    const last = this.crumbs.at(-1);
    if (!last || Math.hypot(last.x - leader.x, last.z - leader.z) > 0.5) {
      this.crumbs.push({ x: leader.x, z: leader.z, yaw: leader.yaw });
      if (this.crumbs.length > 300) this.crumbs.shift();
    }

    if (leader.driving) {
      const target = this.along(FOLLOW_METRES);
      if (target && Math.hypot(target.x - this.truck.x, target.z - this.truck.z) > 0.02) {
        this.truck.setPose(target.x, this.ground(target.x, target.z), target.z, target.yaw);
      }
      this.truck.track(dt);
      for (const [index, guard] of this.guards.entries()) {
        if (index === 0 && this.gate) this.walkGuard(guard, index, this.gate.point, null, dt, true);
        else this.showGuard(guard, false);
      }
      this.wasDriving = true;
      return;
    }

    this.truck.track(dt);
    this.wasDriving = false;
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
    this.truck.dispose();
  }
}
