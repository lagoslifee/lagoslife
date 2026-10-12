import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Scene } from "@babylonjs/core/scene";
import { INTERIOR_EXIT, type CharacterAppearance, type FoodParcel, type RoadNavigator, type Vec2 } from "@lagos-living/shared";
import type { Avatar, AvatarFactory } from "./avatar";
import type { VehicleFactory, VehicleView } from "./vehicles";

const BIKE_MODEL = "yaba-city-bike";
const RIDE_SPEED = 5;
const WALK_SPEED = 1.4;
/** Couriers further than this from the player are not built. */
const VISIBLE_RANGE = 160;
const HAND_REACH = 2.4;

type Mode = "street" | "indoors";
type Phase = "riding" | "walking" | "waiting" | "leaving" | "riding-off";
type Courier = {
  parcel: FoodParcel;
  mode: Mode;
  rider: Avatar;
  bag: TransformNode | null;
  bike: VehicleView | null;
  path: Vec2[];
  along: number[];
  startAt: number;
  arriveAt: number;
  phase: Phase;
  parked: Vec2;
  parkedYaw: number;
  stand: Vec2;
  /** Where an indoor courier comes in from and leaves by. */
  door: Vec2;
  offAt: number;
};

export type Here = { x: number; z: number; location: string };

/**
 * Delivery riders for the player's food and pharmacy orders. Outdoors the rider cycles to the kerb nearest the drop
 * point (where the player ordered from, or their front door), walks over with the bag and waits; indoors at home the
 * rider is at the front door. Taking the bag is a server call; the courier then walks back and rides away.
 */
export class Couriers {
  private parcels: FoodParcel[] = [];
  private couriers = new Map<string, Courier>();
  private readonly bagMaterial: StandardMaterial;
  private readonly lidMaterial: StandardMaterial;

  constructor(
    private readonly scene: Scene,
    private readonly avatars: () => AvatarFactory | null,
    private readonly vehicles: () => VehicleFactory | null,
    private readonly navigator: () => RoadNavigator | null,
    private readonly ground: (x: number, z: number) => number,
    private readonly addCaster: (meshes: AbstractMesh[]) => void,
  ) {
    this.bagMaterial = new StandardMaterial("courier bag", scene);
    this.bagMaterial.diffuseColor = Color3.FromHexString("#1f9d55");
    this.lidMaterial = new StandardMaterial("courier bag lid", scene);
    this.lidMaterial.diffuseColor = Color3.FromHexString("#f2c230");
  }

  set(parcels: FoodParcel[]) {
    this.parcels = parcels.filter((parcel) => parcel.status === "on_the_way");
  }

  /** The waiting courier the player can take a parcel from, if one is in reach. */
  reachable(here: Here): FoodParcel | null {
    let best: { parcel: FoodParcel; distance: number } | null = null;
    for (const courier of this.couriers.values()) {
      if (courier.phase !== "waiting") continue;
      const at = courier.rider.root.position;
      const distance = Math.hypot(at.x - here.x, at.z - here.z);
      if (distance <= HAND_REACH && (!best || distance < best.distance)) best = { parcel: courier.parcel, distance };
    }
    return best?.parcel ?? null;
  }

  /** The courier gives up the bag and heads off. */
  handOver(parcelId: string) {
    const courier = this.couriers.get(parcelId);
    if (!courier) return;
    courier.bag?.dispose();
    courier.bag = null;
    courier.phase = "leaving";
    this.parcels = this.parcels.filter((parcel) => parcel.id !== parcelId);
  }

  update(dt: number, here: Here, now = Date.now()) {
    const wanted = new Map<string, { parcel: FoodParcel; mode: Mode }>();
    for (const parcel of this.parcels) {
      const mode = this.modeFor(parcel, here, now);
      if (mode) wanted.set(parcel.id, { parcel, mode });
    }
    for (const [id, courier] of this.couriers) {
      const keep = courier.phase === "leaving" || courier.phase === "riding-off" ? this.sameSpace(courier, here) : wanted.get(id)?.mode === courier.mode;
      if (!keep) this.remove(id);
    }
    for (const [id, { parcel, mode }] of wanted) {
      if (!this.couriers.has(id)) {
        const courier = this.build(parcel, mode, here, now);
        if (courier) this.couriers.set(id, courier);
      }
    }
    for (const [id, courier] of this.couriers) {
      if (!this.step(courier, dt, here, now)) this.remove(id);
    }
  }

  dispose() {
    for (const id of [...this.couriers.keys()]) this.remove(id);
    this.bagMaterial.dispose();
    this.lidMaterial.dispose();
  }

  private modeFor(parcel: FoodParcel, here: Here, now: number): Mode | null {
    const arrived = now >= Date.parse(parcel.arrivesAt) - 500;
    if (parcel.propertyId && here.location === `home:${parcel.propertyId}`) return arrived ? "indoors" : null;
    if (here.location !== parcel.dropLocation) return null;
    if (here.location !== "street") return arrived ? "indoors" : null;
    return Math.hypot(here.x - parcel.drop[0], here.z - parcel.drop[1]) <= VISIBLE_RANGE ? "street" : null;
  }

  private sameSpace(courier: Courier, here: Here) {
    return courier.mode === "street" ? here.location === "street" : here.location !== "street";
  }

  private build(parcel: FoodParcel, mode: Mode, here: Here, now: number): Courier | null {
    const factory = this.avatars();
    if (!factory) return null;
    const rider = factory.create(`courier ${parcel.id}`, riderLook(parcel.id));
    const bag = this.buildBag(parcel.id);
    const arriveAt = Date.parse(parcel.arrivesAt);
    if (mode === "indoors") {
      const home = parcel.propertyId && here.location === `home:${parcel.propertyId}`;
      const door: Vec2 = home ? INTERIOR_EXIT : parcel.drop;
      // Just inside the front door and to one side, clear of the way out.
      const stand: Vec2 = home ? [door[0] + 1.1, door[1] + 0.9] : parcel.drop;
      rider.root.position.set(door[0], 0.02, door[1]);
      this.carry(rider, bag);
      return { parcel, mode, rider, bag, bike: null, path: [], along: [0], startAt: now, arriveAt: now, phase: "walking", parked: door, parkedYaw: 0, stand, door, offAt: 0 };
    }
    const navigator = this.navigator();
    const vehicles = this.vehicles();
    if (!navigator || !vehicles) {
      rider.dispose();
      bag.dispose();
      return null;
    }
    if (!vehicles.ready(BIKE_MODEL)) {
      void vehicles.ensure(BIKE_MODEL);
      rider.dispose();
      bag.dispose();
      return null;
    }
    const kerb = navigator.snap(parcel.drop);
    const toDrop: Vec2 = [parcel.drop[0] - kerb.point[0], parcel.drop[1] - kerb.point[1]];
    const gap = Math.hypot(toDrop[0], toDrop[1]) || 1;
    const parked: Vec2 = [kerb.point[0] + (toDrop[0] / gap) * Math.min(2.2, gap * 0.6), kerb.point[1] + (toDrop[1] / gap) * Math.min(2.2, gap * 0.6)];
    const stand: Vec2 = gap > 1.6 ? [parcel.drop[0] - (toDrop[0] / gap) * 1.1, parcel.drop[1] - (toDrop[1] / gap) * 1.1] : parcel.drop;
    const remaining = (arriveAt - now) / 1000;
    let path: Vec2[] = [parked];
    if (remaining > 2) {
      const reach = Math.min(140, Math.max(25, remaining * RIDE_SPEED));
      const candidates: Vec2[] = [-1, 1].map((side) => [kerb.point[0] - Math.sin(kerb.yaw) * reach * side, kerb.point[1] - Math.cos(kerb.yaw) * reach * side]);
      let best: Vec2[] | null = null;
      let bestMetres = Infinity;
      for (const candidate of candidates) {
        const start = navigator.snap(candidate);
        const plan = navigator.plan(start.point, kerb.point);
        if (!plan.reachable || plan.metres < 10) continue;
        if (Math.abs(plan.metres - reach) < Math.abs(bestMetres - reach)) {
          best = plan.points;
          bestMetres = plan.metres;
        }
      }
      if (best) path = [...best.filter((point, index, all) => index === 0 || Math.hypot(point[0] - all[index - 1]![0], point[1] - all[index - 1]![1]) > 0.5), parked];
    }
    const along = [0];
    for (let index = 1; index < path.length; index += 1) along.push(along[index - 1]! + Math.hypot(path[index]![0] - path[index - 1]![0], path[index]![1] - path[index - 1]![1]));
    const bike = vehicles.create(`courier-bike-${parcel.id}`, BIKE_MODEL, "#1f9d55");
    this.addCaster(bike.meshes);
    const last = path.length > 1 ? path[path.length - 2]! : kerb.point;
    const parkedYaw = path.length > 1 ? Math.atan2(parked[0] - last[0], parked[1] - last[1]) : kerb.yaw;
    const riding = path.length > 1 && remaining > 2;
    const courier: Courier = { parcel, mode, rider, bag, bike, path, along, startAt: now, arriveAt, phase: riding ? "riding" : "walking", parked, parkedYaw, stand, door: parked, offAt: 0 };
    this.carry(rider, bag, !riding);
    if (!riding) rider.root.position.set(parked[0], this.ground(parked[0], parked[1]), parked[1]);
    this.addCaster(rider.meshes);
    return courier;
  }

  /** Advances one courier; false once it has gone. */
  private step(courier: Courier, dt: number, here: Here, now: number) {
    const { rider, bike } = courier;
    const root = rider.root;
    const indoors = courier.mode === "indoors";
    const floor = (x: number, z: number) => (indoors ? 0.02 : this.ground(x, z));
    if (courier.phase === "riding" && bike) {
      const total = courier.along[courier.along.length - 1]!;
      const t = Math.max(0, Math.min(1, (now - courier.startAt) / Math.max(1, courier.arriveAt - courier.startAt)));
      const [x, z, yaw] = this.alongPath(courier, total * (t < 0.85 ? (t / 0.85) * 0.93 : 0.93 + (1 - (1 - (t - 0.85) / 0.15) ** 2) * 0.07));
      bike.setPose(x, this.ground(x, z), z, yaw);
      bike.track(dt);
      this.seat(rider, bike, dt);
      if (t >= 1) {
        courier.phase = "walking";
        root.position.set(courier.parked[0] + Math.cos(courier.parkedYaw) * 0.6, this.ground(courier.parked[0], courier.parked[1]), courier.parked[1] - Math.sin(courier.parkedYaw) * 0.6);
        if (courier.bag) this.carry(rider, courier.bag, true);
      }
      return true;
    }
    if (bike && courier.phase !== "riding-off") {
      bike.setPose(courier.parked[0], this.ground(courier.parked[0], courier.parked[1]), courier.parked[1], courier.parkedYaw);
      bike.track(dt);
    }
    if (courier.phase === "riding-off" && bike) {
      const elapsed = (now - courier.offAt) / 1000;
      const total = courier.along[courier.along.length - 1]!;
      const back = Math.max(0, total - elapsed * RIDE_SPEED);
      const [x, z, yaw] = this.alongPath(courier, back);
      bike.setPose(x, this.ground(x, z), z, courier.path.length > 1 ? yaw + Math.PI : courier.parkedYaw);
      bike.track(dt);
      this.seat(rider, bike, dt);
      return elapsed < 8 && (back > 0 || elapsed < 2);
    }
    const target = courier.phase === "leaving" ? (bike ? courier.parked : courier.door) : courier.stand;
    const dx = target[0] - root.position.x;
    const dz = target[1] - root.position.z;
    const distance = Math.hypot(dx, dz);
    if (courier.phase === "walking" || courier.phase === "leaving") {
      if (distance > 0.2) {
        const stride = Math.min(distance, WALK_SPEED * dt);
        root.position.x += (dx / distance) * stride;
        root.position.z += (dz / distance) * stride;
        root.position.y = floor(root.position.x, root.position.z);
        root.rotation.y = Math.atan2(dx, dz);
        rider.update(WALK_SPEED, "walk", dt);
        return true;
      }
      if (courier.phase === "walking") {
        courier.phase = "waiting";
        return true;
      }
      if (!bike) return false;
      courier.phase = "riding-off";
      courier.offAt = now;
      return true;
    }
    const facing = Math.atan2(here.x - root.position.x, here.z - root.position.z);
    if (Math.hypot(here.x - root.position.x, here.z - root.position.z) < 14) root.rotation.y = facing;
    rider.update(0, Math.floor(now / 2400) % 3 === 0 ? "wave" : "idle", dt);
    return true;
  }

  private alongPath(courier: Courier, s: number): [number, number, number] {
    const { path, along } = courier;
    if (path.length < 2) return [courier.parked[0], courier.parked[1], courier.parkedYaw];
    let index = 1;
    while (index < along.length - 1 && along[index]! < s) index += 1;
    const a = path[index - 1]!;
    const b = path[index]!;
    const span = Math.max(0.01, along[index]! - along[index - 1]!);
    const u = Math.max(0, Math.min(1, (s - along[index - 1]!) / span));
    return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, Math.atan2(b[0] - a[0], b[1] - a[1])];
  }

  private seat(rider: Avatar, bike: VehicleView, dt: number) {
    const seat = bike.seat(0);
    rider.root.position.set(seat.x, this.ground(seat.x, seat.z) + bike.seatHeight(), seat.z);
    rider.root.rotation.y = seat.yaw;
    rider.update(0, "sit", dt);
    rider.pedal(bike.crank);
  }

  /** In the rider's hands while walking; on the bike the bag rides on their back. */
  private carry(rider: Avatar, bag: TransformNode, hands = true) {
    bag.parent = rider.root;
    if (hands) bag.position.set(0.02, 1.0, 0.34);
    else bag.position.set(0, 1.25, -0.3);
  }

  private buildBag(id: string) {
    const root = new TransformNode(`courier bag ${id}`, this.scene);
    const box = MeshBuilder.CreateBox(`courier bag box ${id}`, { width: 0.42, height: 0.36, depth: 0.32 }, this.scene);
    box.material = this.bagMaterial;
    box.parent = root;
    const lid = MeshBuilder.CreateBox(`courier bag lid ${id}`, { width: 0.44, height: 0.04, depth: 0.34 }, this.scene);
    lid.material = this.lidMaterial;
    lid.position.y = 0.2;
    lid.parent = root;
    for (const mesh of [box, lid]) mesh.isPickable = false;
    return root;
  }

  private remove(id: string) {
    const courier = this.couriers.get(id);
    if (!courier) return;
    courier.bag?.dispose();
    courier.rider.dispose();
    courier.bike?.dispose();
    this.couriers.delete(id);
  }
}

/** Riders wear a green delivery polo-style top; faces and hair vary by order. */
function riderLook(seed: string): CharacterAppearance {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const tones = ["deep", "rich", "warm"] as const;
  return { body: "male", skinTone: tones[hash % tones.length]!, hairstyle: hash % 2 ? "low-fade" : "twists", outfit: "athleisure", accessory: "none" };
}
