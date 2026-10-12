import { getVehicleModel, propertyPlace, TOW, walkable, type Notice, type TowStage, type TowState, type Vec2 } from "@lagos-living/shared";
import type { RoomVehicle } from "../vehicle-service.js";
import { roadNavigator } from "../world-roads.js";
import {
  activeTows,
  cancelTow,
  collectTow,
  deliverTow,
  firstHome,
  homeDelivery,
  mechanicDelivery,
  setTowStage,
  type DeliverySpot,
  type TowJobRow,
} from "../tow-service.js";

export type TowHost = {
  vehicles: Map<string, RoomVehicle>;
  /** Null when the owner is not in this room. */
  /** `door` is set while the owner is inside a building: deliveries go to its entrance. */
  owner(userId: string): { onStreet: boolean; x: number; z: number; door: Vec2 | null } | null;
  send(userId: string, type: string, payload: unknown): void;
  notify(userId: string, notice: Notice): void;
  /** Driver parks and steps out, passengers step out: nobody rides onto the truck. */
  clearOccupants(vehicleId: string): Promise<void>;
  personNear(x: number, z: number, radius: number): boolean;
};

type Job = TowJobRow & {
  truck: RoomVehicle | null;
  path: Vec2[];
  pathIndex: number;
  speed: number;
  stageStartedAt: number;
  stageEndsAt: number | null;
  carStart: { x: number; z: number; yaw: number } | null;
  delivery: { spot: DeliverySpot; label: string; note: string | null } | null;
  destinationLabel: string;
  message: string | null;
  busy: boolean;
  leaving: boolean;
  unloadStartedAt: number | null;
  express: boolean;
};

const LOAD_SLIDE = 0.55;
const KERB_OFFSET = 2.6;
/** Off-road drop spots: the truck drives straight in over this distance instead of following a road. */
const DIRECT_METRES = 8;
const OFF_ROAD = 15;

function pathLength(from: Vec2, path: Vec2[], index: number) {
  let total = 0;
  let previous = from;
  for (let i = index; i < path.length; i += 1) {
    total += Math.hypot(path[i]![0] - previous[0], path[i]![1] - previous[1]);
    previous = path[i]!;
  }
  return total;
}

/** Road route ending `ahead` metres past the road point nearest `to`, keeping only its last `back` metres. */
function approach(to: Vec2, back: number, ahead = 6) {
  const nav = roadNavigator();
  const road = nav.snap(to);
  const forward: Vec2 = [Math.sin(road.yaw), Math.cos(road.yaw)];
  const stop: Vec2 = [road.point[0] + forward[0] * ahead, road.point[1] + forward[1] * ahead];
  const start = nav.snap([road.point[0] - forward[0] * back, road.point[1] - forward[1] * back]).point;
  const plan = nav.plan(start, stop);
  const points = plan.reachable && plan.metres < back * 3 ? plan.points : [start, stop];
  const kept: Vec2[] = [points[points.length - 1]!];
  let metres = 0;
  for (let i = points.length - 2; i >= 0 && metres < back * 1.5; i -= 1) {
    metres += Math.hypot(points[i]![0] - kept[0]![0], points[i]![1] - kept[0]![1]);
    kept.unshift(points[i]!);
  }
  return { path: kept, stop, yaw: road.yaw };
}

function destinationLabel(job: TowJobRow) {
  if (job.destination.kind === "here") return "Your current location";
  return propertyPlace(job.destination.propertyId)?.name ?? "Home";
}

/**
 * Ade Recovery jobs in this room. The truck is a server-driven vehicle, so everyone nearby sees it
 * arrive, winch the car up, leave, and later bring the same car back.
 */
export class TowDispatcher {
  private jobs = new Map<string, Job>();

  constructor(private host: TowHost) {}

  async load() {
    for (const row of await activeTows()) {
      const job = this.track(row);
      if (row.stage === "arriving" || row.stage === "requested" || row.stage === "loading") {
        if (this.host.vehicles.has(row.vehicleId)) this.beginArriving(job, Date.now());
        else await this.collect(job, Date.now());
      } else {
        job.collectedAt = Date.now() - TOW.departSeconds * 1_000;
        this.setStage(job, "repairing", Date.now());
      }
    }
  }

  /** Whether a car is spoken for by a recovery job (no driving or riding in it). */
  busy(vehicleId: string) {
    for (const job of this.jobs.values()) if (job.vehicleId === vehicleId) return true;
    return false;
  }

  start(row: TowJobRow, express = false) {
    if (this.jobs.has(row.id)) return this.send(this.jobs.get(row.id)!);
    const job = this.track(row);
    job.express = express;
    if (express) void this.beginExpress(job);
    else this.beginArriving(job, Date.now());
  }

  /** Express: the car is lifted at once and the truck rolls up beside the drop spot with it on the bed. */
  private async beginExpress(job: Job) {
    job.busy = true;
    let garage = false;
    try {
      await this.host.clearOccupants(job.vehicleId).catch(() => undefined);
      const car = this.host.vehicles.get(job.vehicleId);
      if (car) job.carStart = { x: car.x, z: car.z, yaw: car.yaw };
      if (!(await collectTow(job.id))) {
        this.jobs.delete(job.id);
        return;
      }
      this.host.vehicles.delete(job.vehicleId);
      job.collectedAt = Date.now();
      job.delivery = await this.prepareDelivery(job);
      const now = Date.now();
      if (job.delivery.spot.kind === "garage") {
        garage = true;
        return;
      }
      this.spawnTruck(job, this.directPath(job.delivery.spot), true);
      job.speed = 6;
      this.setStage(job, "returning", now, now + TOW.expressSeconds * 1_000);
    } catch (error) {
      console.error("Express tow failed", job.id, error);
    } finally {
      job.busy = false;
      if (garage) void this.finish(job);
    }
  }

  /** A short straight run that stops just ahead of the spot, used where there is no road to follow. */
  private directPath(spot: { x: number; z: number; yaw: number }): Vec2[] {
    const forward: Vec2 = [Math.sin(spot.yaw), Math.cos(spot.yaw)];
    const stop: Vec2 = [spot.x + forward[0] * 6, spot.z + forward[1] * 6];
    return [[stop[0] - forward[0] * DIRECT_METRES, stop[1] - forward[1] * DIRECT_METRES], stop];
  }

  states(userId: string) {
    return [...this.jobs.values()].filter((job) => job.userId === userId && !job.leaving).map((job) => this.state(job));
  }

  async cancel(userId: string, towId: string) {
    const job = this.jobs.get(towId);
    if (!job || job.userId !== userId) return null;
    if (job.busy || !["requested", "arriving", "loading"].includes(job.stage) || job.collectedAt) return "late" as const;
    job.busy = true;
    try {
      const result = await cancelTow(towId, userId, "owner cancelled");
      if (!result) return "late" as const;
      const car = this.host.vehicles.get(job.vehicleId);
      if (car && job.carStart) [car.x, car.z, car.yaw] = [job.carStart.x, job.carStart.z, job.carStart.yaw];
      job.stage = "cancelled";
      job.message = result.refunded ? `Cancelled. ₦${result.refunded.toLocaleString("en-NG")} refunded.` : "Cancelled.";
      this.send(job);
      this.dismissTruck(job);
      this.jobs.delete(job.id);
      return result;
    } finally {
      job.busy = false;
    }
  }

  tick(seconds: number, now: number) {
    for (const job of this.jobs.values()) {
      if (job.busy) continue;
      try {
        this.advance(job, seconds, now);
      } catch (error) {
        console.error("Tow job failed to advance", job.id, error);
      }
    }
  }

  private track(row: TowJobRow) {
    const job: Job = {
      ...row,
      truck: null,
      path: [],
      pathIndex: 0,
      speed: 0,
      stageStartedAt: Date.now(),
      stageEndsAt: null,
      carStart: null,
      delivery: null,
      destinationLabel: destinationLabel(row),
      message: null,
      busy: false,
      leaving: false,
      unloadStartedAt: null,
      express: false,
    };
    this.jobs.set(row.id, job);
    return job;
  }

  private state(job: Job): TowState {
    const point: [number, number] | null =
      job.delivery?.spot.kind === "kerb" ? [job.delivery.spot.x, job.delivery.spot.z] : job.collectedAt ? null : job.carStart ? [job.carStart.x, job.carStart.z] : job.from;
    return {
      id: job.id,
      vehicleId: job.vehicleId,
      plate: job.vehicle.plate,
      modelName: job.vehicle.modelName,
      stage: job.stage,
      destinationLabel: job.delivery?.label ?? job.destinationLabel,
      quote: job.quote,
      truck: job.truck ? [job.truck.x, job.truck.z] : null,
      stageEndsAt: job.stageEndsAt,
      point,
      message: job.message,
    };
  }

  private send(job: Job) {
    this.host.send(job.userId, "tow", this.state(job));
  }

  private setStage(job: Job, stage: TowStage, now: number, endsAt: number | null = null) {
    job.stage = stage;
    job.stageStartedAt = now;
    job.stageEndsAt = endsAt;
    if (stage !== "delivered") void setTowStage(job.id, stage).catch(() => undefined);
    this.send(job);
  }

  private spawnTruck(job: Job, path: Vec2[], carrying: boolean) {
    const [x, z] = path[0]!;
    const next = path[1] ?? path[0]!;
    const truck: RoomVehicle = {
      id: `tow-${job.id}`,
      ownerUserId: job.userId,
      ownerName: TOW.truckName,
      modelId: TOW.truckModelId,
      colour: TOW.truckColour,
      plate: "ADE 001 TW",
      condition: 100,
      x,
      z,
      yaw: Math.atan2(next[0] - x, next[1] - z),
      driverSessionId: null,
      lights: true,
      locked: true,
      npc: true,
      tow: { carrying: carrying ? { ...job.vehicle } : null, lift: carrying ? 1 : 0 },
    };
    job.truck = truck;
    job.path = path;
    job.pathIndex = 1;
    job.speed = 0;
    this.host.vehicles.set(truck.id, truck);
  }

  private dismissTruck(job: Job) {
    if (job.truck) this.host.vehicles.delete(job.truck.id);
    job.truck = null;
  }

  /** Moves the truck along its path at town speed, easing into the stop. True once it is there. */
  private drive(job: Job, seconds: number) {
    const truck = job.truck;
    if (!truck) return true;
    const remaining = pathLength([truck.x, truck.z], job.path, job.pathIndex);
    const target = Math.min(TOW.truckSpeed, Math.sqrt(2 * 2.2 * Math.max(0, remaining - 0.2)) + 0.4);
    job.speed += Math.max(-5 * seconds, Math.min(2.5 * seconds, target - job.speed));
    let step = Math.max(0, job.speed) * seconds;
    while (step > 0 && job.pathIndex < job.path.length) {
      const [tx, tz] = job.path[job.pathIndex]!;
      const distance = Math.hypot(tx - truck.x, tz - truck.z);
      if (distance > 0.05) {
        const wanted = Math.atan2(tx - truck.x, tz - truck.z);
        const delta = Math.atan2(Math.sin(wanted - truck.yaw), Math.cos(wanted - truck.yaw));
        truck.yaw += delta * Math.min(1, seconds * 6);
      }
      if (distance <= step) {
        truck.x = tx;
        truck.z = tz;
        step -= distance;
        job.pathIndex += 1;
      } else {
        truck.x += ((tx - truck.x) / distance) * step;
        truck.z += ((tz - truck.z) / distance) * step;
        step = 0;
      }
    }
    return job.pathIndex >= job.path.length;
  }

  private beginArriving(job: Job, now: number) {
    const car = this.host.vehicles.get(job.vehicleId);
    if (!car) return;
    job.carStart = { x: car.x, z: car.z, yaw: car.yaw };
    const route = approach([car.x, car.z], TOW.spawnMetres);
    this.spawnTruck(job, route.path, false);
    const metres = pathLength(route.path[0]!, route.path, 1);
    this.setStage(job, "arriving", now, now + (metres / TOW.truckSpeed + 2) * 1_000);
  }

  private advance(job: Job, seconds: number, now: number) {
    const elapsed = (now - job.stageStartedAt) / 1_000;
    switch (job.stage) {
      case "requested":
      case "arriving": {
        const arrived = this.drive(job, seconds);
        const stuck = elapsed > TOW.approachTimeoutSeconds;
        if (stuck && job.truck) [job.truck.x, job.truck.z] = job.path[job.path.length - 1]!;
        if (arrived || stuck) {
          job.busy = true;
          void this.host
            .clearOccupants(job.vehicleId)
            .catch(() => undefined)
            .finally(() => {
              job.busy = false;
              const car = this.host.vehicles.get(job.vehicleId);
              if (car) job.carStart = { x: car.x, z: car.z, yaw: car.yaw };
              this.setStage(job, "loading", Date.now(), Date.now() + TOW.loadSeconds * 1_000);
            });
        }
        return;
      }
      case "loading": {
        const progress = Math.min(1, elapsed / TOW.loadSeconds);
        const truck = job.truck;
        const car = this.host.vehicles.get(job.vehicleId);
        if (truck && car && job.carStart && progress < LOAD_SLIDE) {
          const t = progress / LOAD_SLIDE;
          const ease = t * t * (3 - 2 * t);
          const rear = getVehicleModel(TOW.truckModelId).length / 2 + getVehicleModel(car.modelId).length / 2 - 1.5;
          const bx = truck.x - Math.sin(truck.yaw) * rear;
          const bz = truck.z - Math.cos(truck.yaw) * rear;
          car.x = job.carStart.x + (bx - job.carStart.x) * ease;
          car.z = job.carStart.z + (bz - job.carStart.z) * ease;
          const turn = Math.atan2(Math.sin(truck.yaw - job.carStart.yaw), Math.cos(truck.yaw - job.carStart.yaw));
          car.yaw = job.carStart.yaw + turn * ease;
          return;
        }
        if (!job.collectedAt) {
          void this.collect(job, now);
          return;
        }
        if (truck?.tow) truck.tow.lift = Math.min(1, (progress - LOAD_SLIDE) / (1 - LOAD_SLIDE));
        if (progress >= 1) {
          const road = roadNavigator().snap([truck?.x ?? 0, truck?.z ?? 0]);
          const forward: Vec2 = truck ? [Math.sin(truck.yaw), Math.cos(truck.yaw)] : [0, 1];
          if (truck) {
            job.path = [[truck.x, truck.z], [road.point[0] + forward[0] * 40, road.point[1] + forward[1] * 40]];
            job.pathIndex = 1;
          }
          this.setStage(job, "collected", now, job.collectedAt + TOW.repairReturnSeconds * 1_000);
        }
        return;
      }
      case "collected": {
        this.drive(job, seconds);
        if (elapsed >= TOW.departSeconds) {
          this.dismissTruck(job);
          this.setStage(job, "repairing", now, (job.collectedAt ?? now) + TOW.repairReturnSeconds * 1_000);
        }
        return;
      }
      case "repairing": {
        const returnBudget = (TOW.returnApproachMetres / TOW.truckSpeed + TOW.unloadSeconds + 1) * 1_000;
        const deliverAt = (job.collectedAt ?? now) + TOW.repairReturnSeconds * 1_000;
        if (now < deliverAt - returnBudget) return;
        job.busy = true;
        void this.prepareDelivery(job)
          .then((delivery) => {
            job.delivery = delivery;
            const at = Date.now();
            if (delivery.spot.kind === "garage") return this.finish(job);
            const offRoad = roadNavigator().snap([delivery.spot.x, delivery.spot.z]).distance > OFF_ROAD;
            const path = offRoad ? this.directPath(delivery.spot) : approach([delivery.spot.x, delivery.spot.z], TOW.returnApproachMetres).path;
            this.spawnTruck(job, path, true);
            this.setStage(job, "returning", at, Math.max(deliverAt, at + (pathLength(path[0]!, path, 1) / TOW.truckSpeed + TOW.unloadSeconds) * 1_000));
          })
          .catch((error) => console.error("Tow delivery could not be prepared", job.id, error))
          .finally(() => {
            job.busy = false;
          });
        return;
      }
      case "returning": {
        const truck = job.truck;
        if (job.leaving) {
          this.drive(job, seconds);
          if (elapsed >= 3) {
            this.dismissTruck(job);
            this.jobs.delete(job.id);
          }
          return;
        }
        const arrived = this.drive(job, seconds) || elapsed > TOW.approachTimeoutSeconds;
        if (!arrived) return;
        if (truck?.tow) {
          job.unloadStartedAt ??= now;
          const unloaded = Math.min(1, (now - job.unloadStartedAt) / (TOW.unloadSeconds * 1_000));
          truck.tow.lift = 1 - unloaded;
          if (unloaded < 1) return;
          truck.tow.carrying = null;
        }
        void this.finish(job);
        return;
      }
      default:
    }
  }

  private async collect(job: Job, now: number) {
    job.busy = true;
    try {
      const ok = await collectTow(job.id);
      if (!ok) {
        this.dismissTruck(job);
        this.jobs.delete(job.id);
        return;
      }
      this.host.vehicles.delete(job.vehicleId);
      job.collectedAt = now;
      if (job.truck?.tow) job.truck.tow = { carrying: { ...job.vehicle }, lift: 0 };
      job.message = null;
      if (!job.truck) {
        job.stage = "collected";
        this.setStage(job, "repairing", Date.now(), now + TOW.repairReturnSeconds * 1_000);
      }
    } finally {
      job.busy = false;
    }
  }

  private async finish(job: Job) {
    if (!job.delivery || job.busy) return;
    job.busy = true;
    try {
      await deliverTow(job.id, job.delivery.spot, job.delivery.note);
      const now = Date.now();
      job.message = job.delivery.note;
      this.setStage(job, "delivered", now, null);
      this.host.notify(job.userId, {
        tone: "success",
        text: `Ade Recovery: your ${job.vehicle.modelName} (${job.vehicle.plate}) is back, repaired to 100% and left ${job.delivery.label}.${job.delivery.note ? ` ${job.delivery.note}` : ""}`,
      });
      if (job.truck) {
        const truck = job.truck;
        const forward: Vec2 = [Math.sin(truck.yaw), Math.cos(truck.yaw)];
        job.path = [[truck.x, truck.z], [truck.x + forward[0] * 30, truck.z + forward[1] * 30]];
        job.pathIndex = 1;
        job.speed = 0;
        job.leaving = true;
        job.stage = "returning";
        job.stageStartedAt = now;
      } else {
        this.jobs.delete(job.id);
      }
    } catch (error) {
      console.error("Tow delivery failed", job.id, error);
    } finally {
      job.busy = false;
    }
  }

  /** A clear roadside spot near the owner: on the kerb, not in a building, not on another car or person. */
  private kerbsideNear(x: number, z: number, range: number = TOW.hereRoadRange) {
    const nav = roadNavigator();
    const road = nav.snap([x, z]);
    if (road.distance > range) return null;
    const forward: Vec2 = [Math.sin(road.yaw), Math.cos(road.yaw)];
    const right: Vec2 = [Math.cos(road.yaw), -Math.sin(road.yaw)];
    for (const offset of [0, 7, -7, 14, -14, 21, -21, 28, -28]) {
      for (const side of [1, -1]) {
        const cx = road.point[0] + forward[0] * offset + right[0] * side * KERB_OFFSET;
        const cz = road.point[1] + forward[1] * offset + right[1] * side * KERB_OFFSET;
        if (nav.snap([cx, cz]).distance > KERB_OFFSET + 1.5) continue;
        const clear = [-2.4, 0, 2.4].every((along) => walkable(cx + forward[0] * along, cz + forward[1] * along, 0.3));
        if (!clear) continue;
        if ([...this.host.vehicles.values()].some((vehicle) => Math.hypot(vehicle.x - cx, vehicle.z - cz) < 5.5)) continue;
        if (this.host.personNear(cx, cz, 2.2)) continue;
        return { x: cx, z: cz, yaw: road.yaw };
      }
    }
    return null;
  }

  /** Open ground right next to the owner, for when there is no road close by (a beach, a compound, a field). */
  private clearSpotNear(x: number, z: number) {
    for (const radius of [4, 5.5, 7.5, 10, 14]) {
      for (let i = 0; i < 12; i += 1) {
        const angle = (i * Math.PI) / 6;
        const cx = x + Math.cos(angle) * radius;
        const cz = z + Math.sin(angle) * radius;
        const yaw = Math.atan2(-Math.sin(angle), Math.cos(angle));
        const forward: Vec2 = [Math.sin(yaw), Math.cos(yaw)];
        const clear = [-2.6, 0, 2.6].every((along) => walkable(cx + forward[0] * along, cz + forward[1] * along, 0.9));
        if (!clear) continue;
        if ([...this.host.vehicles.values()].some((vehicle) => Math.hypot(vehicle.x - cx, vehicle.z - cz) < 5.5)) continue;
        if (this.host.personNear(cx, cz, 2.2)) continue;
        return { x: cx, z: cz, yaw };
      }
    }
    return null;
  }

  /** Checked when the return is prepared, so "here" means where the owner is now. */
  private async prepareDelivery(job: Job): Promise<{ spot: DeliverySpot; label: string; note: string | null }> {
    let reason: string | null = null;
    if (job.destination.kind === "here") {
      const owner = this.host.owner(job.userId);
      if (owner) {
        const [x, z] = owner.door ?? [owner.x, owner.z];
        const kerb = this.kerbsideNear(x, z, 25);
        if (kerb) return { spot: { kind: "kerb", ...kerb }, label: owner.door ? "at the roadside by the door" : "at the roadside near you", note: null };
        const open = this.clearSpotNear(x, z) ?? this.kerbsideNear(x, z);
        if (open) return { spot: { kind: "kerb", ...open }, label: owner.door ? "outside the door" : "right next to you", note: null };
        reason = "There was no clear spot near you";
      } else {
        reason = "You were offline";
      }
    }
    const propertyId = job.destination.kind === "home" ? job.destination.propertyId : await firstHome(job.userId);
    if (propertyId) {
      const home = await homeDelivery(job.userId, propertyId, job.vehicleId);
      if (home) {
        const label = home.spot.kind === "garage" ? `in the garage at ${home.name}` : `outside ${home.name}`;
        return { spot: home.spot, label, note: reason ? `${reason}, so we took it home.` : null };
      }
      reason ??= "Your home was unavailable";
    }
    return {
      spot: await mechanicDelivery(job.vehicleId),
      label: "outside Ade Auto Works",
      note: `${reason ?? "No other safe spot was found"}, so it is waiting at the workshop.`,
    };
  }
}
