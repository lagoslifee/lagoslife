import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { MultiMaterial } from "@babylonjs/core/Materials/multiMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Matrix } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { Scene } from "@babylonjs/core/scene";
import { getPlace, TRANSIT, type Vec2 } from "@lagos-living/shared";
import type { Avatar, AvatarFactory } from "./avatar";
import type { DanfoView } from "./danfo";
import { densify, hash, pointAt, polylineLength } from "./geometry";
import type { Materials, Quality } from "./materials";
import type { WorldRoad } from "./street-index";
import type { BuiltWorld } from "./world-builder";

const CAR_COLORS = ["#e8e8e6", "#a9adb1", "#16181b", "#1d2f52", "#8d1d1d", "#b9a37e", "#e7e2d6"];

type Car = {
  mesh: Mesh;
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

function carTemplate(scene: Scene, materials: Materials) {
  const body = MeshBuilder.CreateBox("car body", { width: 1.78, height: 0.62, depth: 4.4 }, scene);
  body.bakeTransformIntoVertices(Matrix.Translation(0, 0.62, 0));
  const nose = MeshBuilder.CreateBox("car hood", { width: 1.74, height: 0.18, depth: 4.2 }, scene);
  nose.bakeTransformIntoVertices(Matrix.Translation(0, 0.98, 0));
  const cabin = MeshBuilder.CreateBox("car cabin", { width: 1.58, height: 0.52, depth: 2.3 }, scene);
  cabin.bakeTransformIntoVertices(Matrix.Translation(0, 1.33, -0.25));
  const wheels: Mesh[] = [];
  for (const [x, z] of [[-0.82, 1.35], [0.82, 1.35], [-0.82, -1.35], [0.82, -1.35]] as const) {
    const wheel = MeshBuilder.CreateCylinder("car wheel", { diameter: 0.64, height: 0.24, tessellation: 12 }, scene);
    wheel.bakeTransformIntoVertices(Matrix.RotationZ(Math.PI / 2).multiply(Matrix.Translation(x, 0.32, z)));
    wheels.push(wheel);
  }
  const lights = MeshBuilder.CreateBox("car lights", { width: 1.5, height: 0.12, depth: 4.42 }, scene);
  lights.bakeTransformIntoVertices(Matrix.Translation(0, 0.78, 0));
  const merged = Mesh.MergeMeshes([body, nose, cabin, ...wheels, lights], true, true, undefined, false, true)!;
  merged.isPickable = false;
  void materials;
  return merged;
}

/** Client-only ambient traffic and pedestrians; they yield to the player and to danfos. */
export class AmbientLife {
  private cars: Car[] = [];
  private walkers: Walker[] = [];
  private statics: Array<{ avatar: Avatar; x: number; z: number; motion: "idle" | "sit" | "wave" }> = [];
  private roads: WorldRoad[];
  private sidewalkRoads: WorldRoad[];
  private template: Mesh;
  honks = 0;
  onHonk: (() => void) | null = null;

  constructor(
    private readonly scene: Scene,
    private readonly world: BuiltWorld,
    roads: WorldRoad[],
    materials: Materials,
    private readonly avatars: AvatarFactory | null,
    quality: Quality,
  ) {
    this.roads = roads.filter((road) => ["primary", "tertiary", "unclassified", "residential"].includes(road.kind) && polylineLength(road.points) > 120);
    this.sidewalkRoads = roads.filter((road) => ["primary", "tertiary", "unclassified", "residential"].includes(road.kind) && polylineLength(road.points) > 60);
    this.template = carTemplate(scene, materials);
    this.template.setEnabled(false);
    const carCount = quality === "low" ? 10 : quality === "medium" ? 18 : 26;
    const walkerCount = avatars ? (quality === "low" ? 5 : quality === "medium" ? 10 : 16) : 0;
    const variants = CAR_COLORS.map((hex, index) => {
      const paint = new PBRMaterial(`car paint ${index}`, scene);
      paint.albedoColor = Color3.FromHexString(hex);
      paint.metallic = 0.6;
      paint.roughness = 0.32;
      const multi = new MultiMaterial(`car ${index}`, scene);
      // Submesh order follows the merge order: body, hood, cabin, 4 wheels, lights.
      multi.subMaterials = [paint, paint, materials.glass, materials.rubber, materials.rubber, materials.rubber, materials.rubber, materials.lamp];
      return multi;
    });
    for (let index = 0; index < carCount; index += 1) {
      const mesh = this.template.clone(`car ${index}`, null)!;
      mesh.setEnabled(true);
      mesh.material = variants[index % variants.length]!;
      const car: Car = { mesh, road: this.roads[0]!, points: [], length: 0, s: 0, direction: 1, speed: 0, cruise: 8, lane: 1.9, stoppedFor: 0, yaw: 0 };
      this.spawnCar(car, index * 7.31, null);
      this.cars.push(car);
    }
    for (let index = 0; index < walkerCount; index += 1) {
      const avatar = avatars!.create(`walker-${index}`, 1 + (index % 5));
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
        const avatar = avatars.create(`static-${index}`, 2 + index);
        avatar.root.position.set(x, world.groundHeight(x, z), z);
        avatar.root.rotation.y = yaw;
        this.statics.push({ avatar, x, z, motion: spot.motion });
      });
      TRANSIT.stops.forEach((stop, index) => {
        if (index % 2 === 1) return;
        const heading = (stop as unknown as { heading: number }).heading;
        const x = stop.alight[0] + Math.cos(heading) * 1.7 + Math.sin(heading) * 1.2;
        const z = stop.alight[1] - Math.sin(heading) * 1.7 + Math.cos(heading) * 1.2;
        const avatar = avatars.create(`waiting-${index}`, 3 + index);
        avatar.root.position.set(x, world.groundHeight(x, z), z);
        avatar.root.rotation.y = heading + Math.PI / 2 + Math.PI;
        this.statics.push({ avatar, x, z, motion: "idle" });
      });
    }
  }

  private spawnCar(car: Car, seed: number, player: Vec2 | null) {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const road = this.roads[Math.floor(hash(Math.round(seed * 1000) + attempt * 17) * this.roads.length)]!;
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
        if (other !== car && blockedBy(other.mesh.position.x, other.mesh.position.z, 1.6, 11)) target = Math.min(target, 0);
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
      if (car.s < 0 || car.s > car.length) {
        const far = Math.hypot(x - player[0], z - player[1]) > 90;
        if (far) this.spawnCar(car, seed + car.mesh.uniqueId * 0.13, player);
        else if (!car.road.oneway) {
          car.direction = car.direction === 1 ? -1 : 1;
          car.s = Math.max(0, Math.min(car.length, car.s));
        } else this.spawnCar(car, seed + car.mesh.uniqueId * 0.17, player);
      }
      const yaw = Math.atan2(dirX, dirZ);
      let delta = yaw - car.yaw;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      car.yaw += delta * Math.min(1, dt * 6);
      car.mesh.position.set(x, 0.05, z);
      car.mesh.rotation.y = car.yaw;
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
    for (const car of this.cars) car.mesh.dispose();
    for (const walker of this.walkers) walker.avatar.dispose();
    for (const npc of this.statics) npc.avatar.dispose();
    this.template.dispose();
  }
}
