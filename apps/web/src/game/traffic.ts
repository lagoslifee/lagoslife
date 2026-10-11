import type { Scene } from "@babylonjs/core/scene";
import { getPlace, getVehicleModel, STOPS, VEHICLE_MODELS, type Vec2 } from "@lagos-living/shared";
import { appearanceFor, type Avatar, type AvatarFactory } from "./avatar";
import type { DanfoView } from "./danfo";
import { densify, hash, pointAt, polylineLength } from "./geometry";
import type { Quality } from "./materials";
import type { WorldRoad } from "./street-index";
import type { VehicleFactory, VehicleView } from "./vehicles";
import type { BuiltWorld } from "./world-builder";

type Car = {
  view: VehicleView;
  road: WorldRoad;
  points: Vec2[];
  length: number;
  s: number;
  direction: 1 | -1;
  speed: number;
  cruise: number;
  lane: number;
  stoppedFor: number;
  yaw: number;
};

type Walker = {
  avatar: Avatar;
  points: Vec2[];
  length: number;
  s: number;
  direction: 1 | -1;
  lateral: number;
  speed: number;
  x: number;
  z: number;
  yaw: number;
};

/**
 * Traffic mix, drawn from the dealership's own models: everyday Toyotas and Hondas most often, with the luxury and
 * supercar end of Lekki Motors showing up further down the list so every model appears at higher quality settings.
 */
const TRAFFIC_MIX = [
  "toyota-corolla", "toyota-camry", "lexus-rx350", "mercedes-g63", "tokunbo-saloon", "toyota-hilux", "range-rover", "honda-accord", "ojota-minibus", "lamborghini-urus",
  "toyota-sienna", "mercedes-gle", "toyota-land-cruiser", "ferrari-f8", "porsche-cayenne", "mercedes-s-class", "eko-hatch", "bmw-x5", "lamborghini-huracan", "toyota-corolla",
  "rolls-royce-cullinan", "bmw-m4", "porsche-911", "bentley-continental-gt", "toyota-camry", "lagoon-pickup", "lexus-rx350", "honda-accord",
].filter((id) => VEHICLE_MODELS.some((model) => model.id === id));

/** Distinct street models per quality: each modelled car costs a download and several megabytes of GPU textures. */
export function trafficModels(quality: Quality) {
  const distinct = [...new Set(TRAFFIC_MIX)];
  return distinct.slice(0, quality === "low" ? 4 : quality === "medium" ? 8 : 12);
}
/** Cabins are only drawn for cars this close to the player. */
const CABIN_RANGE = 30;

/** Client-only ambient traffic and pedestrians; they yield to the player and to danfos. */
export class AmbientLife {
  private cars: Car[] = [];
  private walkers: Walker[] = [];
  private statics: Array<{ avatar: Avatar; x: number; z: number; motion: "idle" | "sit" | "wave" }> = [];
  private roads: WorldRoad[];
  private sidewalkRoads: WorldRoad[];
  honks = 0;
  onHonk: (() => void) | null = null;
  /** Where the first cars are placed before the player's position is known. */
  private home: Vec2 | null = null;

  constructor(
    private readonly scene: Scene,
    private readonly world: BuiltWorld,
    roads: WorldRoad[],
    private readonly avatars: AvatarFactory | null,
    quality: Quality,
    vehicles: VehicleFactory,
  ) {
    this.roads = roads.filter((road) => ["primary", "tertiary", "unclassified", "residential"].includes(road.kind) && polylineLength(road.points) > 120);
    this.sidewalkRoads = roads.filter((road) => ["primary", "tertiary", "unclassified", "residential"].includes(road.kind) && polylineLength(road.points) > 60);
    this.home = getPlace("starter-home").door;
    const carCount = quality === "low" ? 10 : quality === "medium" ? 20 : 28;
    const walkerCount = avatars ? (quality === "low" ? 5 : quality === "medium" ? 10 : 16) : 0;
    const mix = trafficModels(quality);
    for (let index = 0; index < carCount; index += 1) {
      const modelId = mix[index % mix.length]!;
      const colours = getVehicleModel(modelId).colours;
      const view = vehicles.create(`traffic-${index}`, modelId, colours[Math.floor(hash(index * 13 + 5) * colours.length)]!);
      view.setDetail(false);
      const car: Car = { view, road: this.roads[0]!, points: [], length: 0, s: 0, direction: 1, speed: 0, cruise: 8, lane: 1.9, stoppedFor: 0, yaw: 0 };
      this.spawnCar(car, index * 7.31, null);
      this.cars.push(car);
    }
    for (let index = 0; index < walkerCount; index += 1) {
      const avatar = avatars!.create(`walker-${index}`, appearanceFor(index));
      const walker: Walker = { avatar, points: [], length: 0, s: 0, direction: 1, lateral: 0, speed: 1.3, x: 0, z: 0, yaw: 0 };
      this.spawnWalker(walker, index * 3.7, null);
      this.walkers.push(walker);
    }
    if (avatars) {
      const spots: Array<{ place: string; motion: "idle" | "sit" | "wave"; offset: number }> = [
        { place: "mama-titi-buka", motion: "idle", offset: 1.6 },
        { place: "mama-titi-buka", motion: "idle", offset: -1.4 },
        { place: "swift-parcel-hub", motion: "wave", offset: 1.8 },
        { place: "corner-kiosk", motion: "idle", offset: 1.5 },
        { place: "home-and-style", motion: "idle", offset: 1.6 },
      ];
      spots.forEach((spot, index) => {
        const place = getPlace(spot.place);
        const yaw = place.facing;
        const rx = Math.cos(yaw);
        const rz = -Math.sin(yaw);
        const x = place.door[0] + rx * spot.offset + Math.sin(yaw) * 0.6;
        const z = place.door[1] + rz * spot.offset + Math.cos(yaw) * 0.6;
        const avatar = avatars.create(`static-${index}`, appearanceFor(100 + index));
        avatar.root.position.set(x, world.groundHeight(x, z), z);
        avatar.root.rotation.y = yaw;
        this.statics.push({ avatar, x, z, motion: spot.motion });
      });
      STOPS.forEach((stop, index) => {
        if (index % 2 === 1) return;
        const heading = (stop as unknown as { heading: number }).heading;
        const x = stop.alight[0] + Math.cos(heading) * 1.7 + Math.sin(heading) * 1.2;
        const z = stop.alight[1] - Math.sin(heading) * 1.7 + Math.cos(heading) * 1.2;
        const avatar = avatars.create(`waiting-${index}`, appearanceFor(200 + index));
        avatar.root.position.set(x, world.groundHeight(x, z), z);
        avatar.root.rotation.y = heading + Math.PI / 2 + Math.PI;
        this.statics.push({ avatar, x, z, motion: "idle" });
      });
    }
  }

  private spawnCar(car: Car, seed: number, player: Vec2 | null) {
    const centre = player ?? this.home;
    const near = centre ? this.roads.filter((road) => road.points.some((point) => Math.hypot(point[0] - centre[0], point[1] - centre[1]) < 260)) : this.roads;
    const pool = near.length ? near : this.roads;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const road = pool[Math.floor(hash(Math.round(seed * 1000) + attempt * 17) * pool.length)]!;
      const points = densify(road.points, 4);
      const length = polylineLength(points);
      const s = hash(Math.round(seed * 777) + attempt) * length;
      const p = pointAt(points, s);
      if (player && Math.hypot(p.x - player[0], p.z - player[1]) < 70) continue;
      car.road = road;
      car.points = points;
      car.length = length;
      car.s = s;
      car.direction = road.oneway ? 1 : hash(Math.round(seed * 91)) > 0.5 ? 1 : -1;
      car.cruise = road.kind === "primary" ? 11 : road.kind === "tertiary" ? 9 : 6.5;
      car.lane = road.kind === "primary" ? -1.9 : road.oneway ? 0 : Math.min(1.7, road.width / 4);
      car.speed = car.cruise * 0.6;
      return;
    }
  }

  private spawnWalker(walker: Walker, seed: number, player: Vec2 | null) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const pool = player
        ? this.sidewalkRoads.filter((road) => road.points.some((point) => Math.hypot(point[0] - player[0], point[1] - player[1]) < 140))
        : this.sidewalkRoads;
      if (!pool.length) return;
      const road = pool[Math.floor(hash(Math.round(seed * 1000) + attempt * 13) * pool.length)]!;
      const points = densify(road.points, 3);
      const length = polylineLength(points);
      const s = hash(Math.round(seed * 333) + attempt * 7) * length;
      const side = hash(Math.round(seed * 51) + attempt) > 0.5 ? 1 : -1;
      const lateral = side * (road.width / 2 + 0.55 + 1.0);
      const p = pointAt(points, s);
      const x = p.x + p.dz * lateral;
      const z = p.z - p.dx * lateral;
      if (this.world.groundHeight(x, z) < 0.1) continue;
      if (player && Math.hypot(x - player[0], z - player[1]) < 35) continue;
      walker.points = points;
      walker.length = length;
      walker.s = s;
      walker.lateral = lateral;
      walker.direction = hash(Math.round(seed * 71) + attempt) > 0.5 ? 1 : -1;
      walker.speed = 1.15 + hash(Math.round(seed * 19)) * 0.35;
      walker.x = x;
      walker.z = z;
      return;
    }
  }

  /** Whether a point is inside (or within `margin` of) an ambient car's body. */
  carAt(x: number, y: number, z: number, margin = 0.25) {
    return this.cars.some((car) => {
      const { model } = car.view;
      if (y > model.height + margin) return false;
      const dx = x - car.view.x;
      const dz = z - car.view.z;
      const forward = dx * Math.sin(car.yaw) + dz * Math.cos(car.yaw);
      const lateral = dx * Math.cos(car.yaw) - dz * Math.sin(car.yaw);
      return Math.abs(forward) < model.length / 2 + margin && Math.abs(lateral) < model.width / 2 + margin;
    });
  }

  /** Dev-only: where each car's lane will be after `seconds` at cruise speed, for tests that need to meet one. */
  lanesAhead(seconds: number) {
    return this.cars.map((car) => {
      const s = Math.max(0, Math.min(car.length, car.s + car.cruise * car.direction * seconds));
      const p = pointAt(car.points, s);
      const dirX = p.dx * car.direction;
      const dirZ = p.dz * car.direction;
      return { x: p.x + dirZ * car.lane, z: p.z - dirX * car.lane, now: [car.view.x, car.view.z] as Vec2, kind: car.road.kind };
    });
  }

  update(dt: number, player: Vec2, buses: DanfoView[], seed: number) {
    for (const car of this.cars) {
      const p = pointAt(car.points, car.s);
      const dirX = p.dx * car.direction;
      const dirZ = p.dz * car.direction;
      const x = p.x + dirZ * car.lane;
      const z = p.z - dirX * car.lane;
      const blockedBy = (bx: number, bz: number, width: number, reach: number) => {
        const dx = bx - x;
        const dz = bz - z;
        const forward = dx * dirX + dz * dirZ;
        const lateral = Math.abs(dx * dirZ - dz * dirX);
        return forward > 1 && forward < reach && lateral < width;
      };
      let target = car.cruise;
      if (blockedBy(player[0], player[1], 1.7, 10)) target = 0;
      for (const bus of buses) if (blockedBy(bus.root.position.x, bus.root.position.z, 2.0, 12)) target = 0;
      for (const other of this.cars) {
        if (other !== car && blockedBy(other.view.x, other.view.z, 1.6, 7 + other.view.model.length / 2 + car.view.model.length / 2)) target = Math.min(target, 0);
      }
      const accel = target > car.speed ? 2.5 : 7;
      car.speed += Math.max(-accel * dt, Math.min(accel * dt, target - car.speed));
      if (car.speed < 0.2 && target === 0) {
        car.stoppedFor += dt;
        if (car.stoppedFor > 2.5 && blockedBy(player[0], player[1], 1.7, 10)) {
          car.stoppedFor = -4;
          this.honks += 1;
          this.onHonk?.();
        }
      } else if (car.stoppedFor > 0) car.stoppedFor = 0;
      car.s += car.speed * car.direction * dt;
      if (Math.hypot(x - player[0], z - player[1]) > 320) {
        this.spawnCar(car, seed + car.view.root.uniqueId * 0.11, player);
        continue;
      }
      if (car.s < 0 || car.s > car.length) {
        const far = Math.hypot(x - player[0], z - player[1]) > 90;
        if (far) this.spawnCar(car, seed + car.view.root.uniqueId * 0.13, player);
        else if (!car.road.oneway) {
          car.direction = car.direction === 1 ? -1 : 1;
          car.s = Math.max(0, Math.min(car.length, car.s));
        } else this.spawnCar(car, seed + car.view.root.uniqueId * 0.17, player);
      }
      const yaw = Math.atan2(dirX, dirZ);
      let delta = yaw - car.yaw;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      car.yaw += delta * Math.min(1, dt * 6);
      car.view.setPose(x, 0.05, z, car.yaw);
      const near = Math.hypot(x - player[0], z - player[1]) < CABIN_RANGE;
      car.view.setDetail(near);
      car.view.animate(dt, { speed: car.speed, steer: delta * 0.6, braking: target < car.speed - 0.5, accel: 0, yawRate: 0 });
    }

    for (const walker of this.walkers) {
      walker.s += walker.speed * walker.direction * dt;
      if (walker.s < 0 || walker.s > walker.length) {
        walker.direction = walker.direction === 1 ? -1 : 1;
        walker.s = Math.max(0, Math.min(walker.length, walker.s));
      }
      const p = pointAt(walker.points, walker.s);
      const x = p.x + p.dz * walker.lateral;
      const z = p.z - p.dx * walker.lateral;
      const tooFar = Math.hypot(x - player[0], z - player[1]) > 170;
      if (tooFar) {
        this.spawnWalker(walker, seed + walker.s * 0.01 + walker.avatar.root.uniqueId, player);
        continue;
      }
      const onSidewalk = this.world.groundHeight(x, z) > 0.1;
      if (!onSidewalk) {
        walker.direction = walker.direction === 1 ? -1 : 1;
        walker.s += walker.speed * walker.direction * dt * 2;
        continue;
      }
      walker.yaw = Math.atan2(p.dx * walker.direction, p.dz * walker.direction);
      walker.x = x;
      walker.z = z;
      const visible = Math.hypot(x - player[0], z - player[1]) < 90;
      walker.avatar.root.setEnabled(visible);
      if (!visible) continue;
      walker.avatar.root.position.set(x, 0.16, z);
      walker.avatar.root.rotation.y = walker.yaw;
      walker.avatar.update(walker.speed, "walk", dt);
    }

    for (const npc of this.statics) {
      const visible = Math.hypot(npc.x - player[0], npc.z - player[1]) < 90;
      npc.avatar.root.setEnabled(visible);
      if (visible) npc.avatar.update(0, npc.motion, dt);
    }
  }

  dispose() {
    for (const car of this.cars) car.view.dispose();
    for (const walker of this.walkers) walker.avatar.dispose();
    for (const npc of this.statics) npc.avatar.dispose();
  }
}
