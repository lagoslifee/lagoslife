import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { CLUB_LAYOUT, INTERIOR_ORIGIN, TRAVEL_LAYOUTS, type CharacterAppearance, type TravelInterior, type Vec2 } from "@lagos-living/shared";
import { appearanceFor, type Avatar, type AvatarFactory } from "./avatar";

/** What a member of staff carries over and hands to the player. */
export type StaffProp = "pass" | "passport" | "tray" | "drink" | "bottle" | "keys" | "bag" | "towel";

export type DeskStaff = { id: string; at: Vec2; yaw: number; look: CharacterAppearance };

type Desk = DeskStaff & { avatar: Avatar; talkUntil: number };
type Flight = { node: TransformNode; from: Vector3; to: Vector3 | null; t: number; caption: string; onDone?: (() => void) | undefined };
type Runner = {
  avatar: Avatar;
  prop: TransformNode;
  home: Vec2;
  phase: "out" | "serve" | "back";
  serveUntil: number;
  caption: string;
  onArrive?: (() => void) | undefined;
};

const [OX, OZ] = INTERIOR_ORIGIN;
const P = (x: number, z: number): Vec2 => [OX + x, OZ + z];
const EAST = Math.PI / 2;
const SOUTH = Math.PI;

/** Airline and hotel uniforms: Lagos staff use the resident looks, Dubai staff Gulf and South Asian ones. */
function staffLook(seed: number, dubai: boolean, role: "agent" | "officer" | "waiter" | "hostess"): CharacterAppearance {
  const base = appearanceFor(seed);
  const female = role === "hostess" || (role !== "officer" && seed % 2 === 1);
  if (!dubai) {
    return { ...base, body: female ? "female" : "male", hairstyle: female ? "buns" : "low-fade", outfit: female ? "office-skirt" : "office-smart", accessory: "none" };
  }
  const tones = ["golden", "light", "warm", "golden"] as const;
  if (role === "officer") return { body: "male", skinTone: tones[seed % tones.length]!, hairstyle: "parted", outfit: "kandura", accessory: seed % 2 ? "beard" : "none" };
  return { body: female ? "female" : "male", skinTone: tones[(seed + 1) % tones.length]!, hairstyle: female ? "long" : "parted", outfit: female ? "office-skirt" : "office-smart", accessory: "none" };
}

/** Club waitresses: a fitted red dress and braids in Lagos, wine lace and long hair in Dubai. */
export function clubWaitress(seed: number, dubai: boolean): CharacterAppearance {
  const base = staffLook(seed, dubai, "hostess");
  return { ...base, body: "female", hairstyle: dubai ? "long" : "braids", outfit: dubai ? "lace-wine" : "corporate-red", accessory: "none" };
}

/** Who stands behind each counter of a travel interior, as world points with the way they face. */
export function deskStaffFor(kind: TravelInterior): DeskStaff[] {
  const dubai = kind === "airport-dxb" || kind === "rooftop" || kind === "hotel" || kind === "pool";
  if (kind === "consulate") {
    return [
      { id: "reception", at: P(-4, -0.75), yaw: SOUTH, look: staffLook(31, false, "agent") },
      { id: "counter", at: P(2.6, 5.0), yaw: SOUTH, look: staffLook(32, false, "officer") },
    ];
  }
  if (kind === "airport-los" || kind === "airport-dxb") {
    const layout = TRAVEL_LAYOUTS[kind].spots;
    const [lx, lz] = layout.lounge!;
    const staff: DeskStaff[] = [
      { id: "tickets", at: P(-15.25, -3.5), yaw: EAST, look: staffLook(41, dubai, "agent") },
      { id: "checkin", at: P(-15.25, 2.5), yaw: EAST, look: staffLook(42, dubai, "agent") },
      { id: "checkin-2", at: P(-15.25, 0.8), yaw: EAST, look: staffLook(43, dubai, "agent") },
      { id: "checkin-3", at: P(-15.25, 4.2), yaw: EAST, look: staffLook(44, dubai, "agent") },
      { id: "gate", at: P(0, 9.85), yaw: SOUTH, look: staffLook(45, dubai, "agent") },
      { id: "lounge", at: P(lx + (dubai ? -2.4 : 2.4), lz - 1.6), yaw: SOUTH, look: staffLook(46, dubai, "hostess") },
    ];
    if (kind === "airport-dxb") {
      const [ix, iz] = layout.immigration!;
      for (const [index, dx] of [-2.4, 0, 2.4].entries()) staff.push({ id: index === 1 ? "immigration" : `immigration-${index}`, at: P(ix + dx, iz + 1.85), yaw: SOUTH, look: staffLook(51 + index, true, "officer") });
      const [bx, bz] = layout.baggage!;
      staff.push({ id: "baggage", at: P(bx - 0.4, bz + 3.2), yaw: SOUTH, look: staffLook(55, true, "agent") });
    }
    return staff;
  }
  if (kind === "pool") {
    return [
      { id: "bar", at: P(-8.6, 3.6), yaw: EAST, look: staffLook(63, true, "agent") },
      { id: "towels", at: P(7.4, -4.55), yaw: SOUTH, look: staffLook(64, true, "hostess") },
      { id: "lifeguard", at: P(7.6, 3.2), yaw: -EAST, look: { ...staffLook(65, true, "agent"), outfit: "beach-day" } },
    ];
  }
  if (kind === "rooftop") {
    return [
      { id: "bar", at: P(-8.0, 0), yaw: EAST, look: staffLook(61, true, "agent") },
      { id: "dining", at: P(4.75, -3.2), yaw: SOUTH, look: staffLook(62, true, "hostess") },
    ];
  }
  return [];
}

/** Seats a player can take (`approach` is how far in front of a solid sofa the player stands). */
export type Seat = { at: Vec2; yaw: number; approach: number };

export function seatsFor(kind: TravelInterior): Seat[] {
  const spots = TRAVEL_LAYOUTS[kind].spots;
  if (kind === "airport-los" || kind === "airport-dxb") {
    const [lx, lz] = spots.lounge!;
    const sx = lx + (kind === "airport-dxb" ? 1.5 : -1.5);
    return [-1.4, 1.4].flatMap((dz) => [-0.45, 0.45].map((dx) => ({ at: P(sx + dx, lz + dz), yaw: dz < 0 ? 0 : Math.PI, approach: 0.75 })));
  }
  if (kind === "rooftop") {
    return ([[3.5, 1], [6, 1], [3.5, 3.5], [6, 3.5], [3.5, -1.5], [6, -1.5]] as const).flatMap(([x, z]) => [
      { at: P(x - 0.6, z), yaw: Math.PI / 2, approach: 0 },
      { at: P(x + 0.6, z), yaw: -Math.PI / 2, approach: 0 },
    ]);
  }
  if (kind === "pool") return POOL_LOUNGERS.map(([x, z]) => ({ at: P(x, z), yaw: 0, approach: 0 }));
  return [];
}

/** Sun loungers along the pool deck, as offsets. */
export const POOL_LOUNGERS: Vec2[] = [-5.4, -3.6, -1.8, 0, 1.8, 3.6, 5.4].map((x) => [x, -4.2] as Vec2);

/** Where a runner fetches each kind of order from, for a travel interior. */
export function serviceOrigin(kind: TravelInterior): Vec2 | null {
  const spots = TRAVEL_LAYOUTS[kind].spots;
  if (kind === "hotel") return P(spots.exit![0], spots.exit![1] + 0.3);
  if (kind === "rooftop") return P(-7.9, 1.6);
  if (kind === "pool") return P(-7.6, 3.6);
  if (kind === "airport-los" || kind === "airport-dxb") {
    const [lx, lz] = spots.lounge!;
    return P(lx + (kind === "airport-dxb" ? -2.4 : 2.4), lz - 1.2);
  }
  return null;
}

/** The club bar's service point and the bartender's place behind it. */
export const CLUB_BARTENDER: Vec2 = [CLUB_LAYOUT.bar[0] - 1.45, CLUB_LAYOUT.bar[1]];

/**
 * Venue staff who are visibly present and hand over what the player pays for: desk agents behind counters, and runners
 * (waiters, hostesses, porters) who carry a prop to the player, hand it over, and walk back.
 */
export class ServiceStaff {
  private desks: Desk[] = [];
  private flights: Flight[] = [];
  private runners: Runner[] = [];
  private readonly materials: Record<"paper" | "passport" | "tray" | "glass" | "gold" | "spark" | "bag" | "metal" | "towel" | "drink", StandardMaterial>;

  constructor(
    private readonly scene: Scene,
    private readonly avatars: () => AvatarFactory | null,
    private readonly notice: (text: string) => void,
    private readonly ground: (x: number, z: number) => number,
  ) {
    const make = (name: string, hex: string, glow = false) => {
      const material = new StandardMaterial(`staff ${name}`, scene);
      material.diffuseColor = Color3.FromHexString(hex);
      material.specularColor = new Color3(0.2, 0.2, 0.2);
      if (glow) {
        material.emissiveColor = Color3.FromHexString(hex);
        material.disableLighting = true;
      }
      return material;
    };
    this.materials = {
      paper: make("paper", "#f4f1e8"),
      passport: make("passport", "#1d6b3a"),
      tray: make("tray", "#c0c4c8"),
      glass: make("glass", "#1c4a22"),
      gold: make("gold", "#d6a73c"),
      spark: make("spark", "#fff2b0", true),
      bag: make("bag", "#3a3f63"),
      metal: make("metal", "#9aa0a6"),
      towel: make("towel", "#f7f7f2"),
      drink: make("drink", "#d98c2b"),
    };
  }

  /** Puts staff behind the counters of the interior the player has just entered. */
  setDesks(staff: DeskStaff[]) {
    this.clearDesks();
    const factory = this.avatars();
    if (!factory) return;
    for (const entry of staff) {
      const avatar = factory.create(`staff ${entry.id}`, entry.look);
      avatar.root.position.set(entry.at[0], 0.02, entry.at[1]);
      avatar.root.rotation.y = entry.yaw;
      this.desks.push({ ...entry, avatar, talkUntil: 0 });
    }
  }

  clear() {
    this.clearDesks();
    for (const runner of this.runners) {
      runner.prop.dispose();
      runner.avatar.dispose();
    }
    this.runners = [];
    for (const flight of this.flights) flight.node.dispose();
    this.flights = [];
  }

  private clearDesks() {
    for (const desk of this.desks) desk.avatar.dispose();
    this.desks = [];
  }

  hasDesk(id: string) {
    return this.desks.some((desk) => desk.id === id);
  }

  /** The agent at `deskId` turns to the player, talks, and passes `prop` across the counter. */
  handOver(deskId: string, prop: StaffProp, caption: string, player: Vec2, onDone?: () => void, toDesk = false) {
    const desk = this.desks.find((entry) => entry.id === deskId);
    if (!desk) {
      this.notice(caption);
      onDone?.();
      return;
    }
    desk.talkUntil = performance.now() + 1_600;
    desk.avatar.root.rotation.y = Math.atan2(player[0] - desk.at[0], player[1] - desk.at[1]);
    const node = this.buildProp(prop);
    const hand = new Vector3(desk.at[0] + Math.sin(desk.avatar.root.rotation.y) * 0.4, 1.1, desk.at[1] + Math.cos(desk.avatar.root.rotation.y) * 0.4);
    const from = toDesk ? new Vector3(player[0], 1.0, player[1]) : hand;
    node.position.copyFrom(from);
    this.flights.push({ node, from, to: toDesk ? hand : null, t: -0.5, caption, onDone });
  }

  /** A runner walks from `from` to the player carrying `prop`, serves it, and goes back. */
  deliver(from: Vec2, look: CharacterAppearance, prop: StaffProp | TransformNode, caption: string, onArrive?: () => void) {
    const factory = this.avatars();
    if (!factory) {
      if (typeof prop !== "string") prop.dispose();
      this.notice(caption);
      onArrive?.();
      return;
    }
    const avatar = factory.create(`runner ${this.runners.length} ${Date.now()}`, look);
    avatar.root.position.set(from[0], this.ground(from[0], from[1]), from[1]);
    const node = typeof prop === "string" ? this.buildProp(prop) : prop;
    node.parent = avatar.root;
    node.position.set(0.05, 1.08, 0.36);
    this.runners.push({ avatar, prop: node, home: from, phase: "out", serveUntil: 0, caption, onArrive });
  }

  get idle() {
    return this.desks.length === 0 && this.runners.length === 0 && this.flights.length === 0;
  }

  get busy() {
    return this.runners.length > 0 || this.flights.length > 0;
  }

  update(dt: number, player: Vec2, seconds: number) {
    const now = performance.now();
    for (const desk of this.desks) {
      const talking = now < desk.talkUntil;
      if (!talking && Math.abs(desk.avatar.root.rotation.y - desk.yaw) > 0.01) desk.avatar.root.rotation.y += (desk.yaw - desk.avatar.root.rotation.y) * Math.min(1, dt * 3);
      desk.avatar.update(0, talking ? "wave" : "idle", dt);
    }
    for (const flight of [...this.flights]) {
      flight.t += dt / 0.7;
      const t = Math.max(0, Math.min(1, flight.t));
      const to = flight.to ?? new Vector3(player[0], 1.0, player[1]);
      Vector3.LerpToRef(flight.from, to, t, flight.node.position);
      flight.node.position.y += Math.sin(t * Math.PI) * 0.15;
      if (flight.t >= 1) {
        flight.node.dispose();
        this.flights = this.flights.filter((entry) => entry !== flight);
        this.notice(flight.caption);
        flight.onDone?.();
      }
    }
    for (const runner of [...this.runners]) {
      const root = runner.avatar.root;
      const spark = runner.prop.getChildren().find((child) => child.name.endsWith("spark")) as Mesh | undefined;
      if (spark) spark.scaling.setAll(0.6 + Math.abs(Math.sin(seconds * 37)) * 0.9);
      if (runner.phase === "serve") {
        runner.avatar.update(0, "wave", dt);
        if (now > runner.serveUntil) {
          runner.prop.dispose();
          runner.phase = "back";
          this.notice(runner.caption);
          runner.onArrive?.();
        }
        continue;
      }
      const target = runner.phase === "out" ? player : runner.home;
      const dx = target[0] - root.position.x;
      const dz = target[1] - root.position.z;
      const distance = Math.hypot(dx, dz);
      const stop = runner.phase === "out" ? 0.9 : 0.15;
      if (distance <= stop) {
        if (runner.phase === "out") {
          runner.phase = "serve";
          runner.serveUntil = now + 1_600;
          root.rotation.y = Math.atan2(dx, dz);
        } else {
          runner.avatar.dispose();
          this.runners = this.runners.filter((entry) => entry !== runner);
        }
        continue;
      }
      const speed = 1.35;
      const step = Math.min(distance - stop, speed * dt);
      root.position.x += (dx / distance) * step;
      root.position.z += (dz / distance) * step;
      root.position.y = this.ground(root.position.x, root.position.z);
      root.rotation.y = Math.atan2(dx, dz);
      runner.avatar.update(speed, "walk", dt);
    }
  }

  buildProp(prop: StaffProp) {
    const scene = this.scene;
    const m = this.materials;
    const root = new TransformNode(`staff prop ${prop}`, scene);
    const box = (name: string, w: number, h: number, d: number, material: StandardMaterial, x = 0, y = 0, z = 0) => {
      const mesh = MeshBuilder.CreateBox(`${prop} ${name}`, { width: w, height: h, depth: d }, scene);
      mesh.material = material;
      mesh.position.set(x, y, z);
      mesh.parent = root;
      mesh.isPickable = false;
      return mesh;
    };
    const cylinder = (name: string, height: number, top: number, bottom: number, material: StandardMaterial, x = 0, y = 0, z = 0) => {
      const mesh = MeshBuilder.CreateCylinder(`${prop} ${name}`, { height, diameterTop: top, diameterBottom: bottom, tessellation: 10 }, scene);
      mesh.material = material;
      mesh.position.set(x, y, z);
      mesh.parent = root;
      mesh.isPickable = false;
      return mesh;
    };
    if (prop === "pass") box("card", 0.2, 0.01, 0.09, m.paper);
    else if (prop === "passport") box("book", 0.1, 0.02, 0.14, m.passport);
    else if (prop === "keys") {
      box("fob", 0.05, 0.02, 0.08, m.bag);
      box("ring", 0.03, 0.005, 0.05, m.metal, 0, 0, 0.06);
    } else if (prop === "bag") {
      box("case", 0.4, 0.5, 0.22, m.bag, 0, -0.35, 0);
      box("handle", 0.12, 0.04, 0.03, m.metal, 0, -0.08, 0);
    } else if (prop === "towel") box("towel", 0.3, 0.08, 0.2, m.towel);
    else if (prop === "bottle") {
      box("tray", 0.34, 0.015, 0.34, m.tray);
      cylinder("bottle", 0.28, 0.09, 0.09, m.glass, 0, 0.15, 0);
      cylinder("neck", 0.1, 0.03, 0.07, m.gold, 0, 0.34, 0);
      box("spark", 0.06, 0.06, 0.06, m.spark, 0, 0.45, 0);
    } else if (prop === "drink") {
      box("tray", 0.3, 0.015, 0.3, m.tray);
      cylinder("glass", 0.14, 0.07, 0.05, m.drink, -0.06, 0.08, 0);
      cylinder("glass 2", 0.14, 0.07, 0.05, m.drink, 0.07, 0.08, 0.04);
    } else {
      box("tray", 0.42, 0.015, 0.32, m.tray);
      cylinder("plate", 0.02, 0.24, 0.24, m.paper, -0.04, 0.02, 0);
      box("food", 0.14, 0.05, 0.1, m.drink, -0.04, 0.05, 0);
      cylinder("glass", 0.13, 0.06, 0.05, m.drink, 0.14, 0.07, 0.08);
    }
    return root;
  }

  dispose() {
    this.clear();
    for (const material of Object.values(this.materials)) material.dispose();
  }
}

export { staffLook };
