import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Constants } from "@babylonjs/core/Engines/constants";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { CLUBS, PLACES, POLICE_CHECKPOINTS, type CharacterAppearance, type Vec2 } from "@lagos-living/shared";
import type { Avatar, AvatarFactory } from "./avatar";
import { equipPolice, equipSecurity } from "./security-kit";
import { CHECKPOINT_BOOM } from "./traffic";
import type { VehicleFactory, VehicleView } from "./vehicles";

/** Crews are built when the player comes this close and removed past SHOW + 80 m. */
const SHOW_METRES = 260;

type Person = { avatar: Avatar; waving: boolean };
type Crew = {
  id: string;
  point: Vec2;
  root: TransformNode;
  people: Person[];
  truck: VehicleView | null;
  stopped: VehicleView | null;
  lights: Mesh[];
  flash: Mesh | null;
  scan: { beam: Mesh; from: Vec2; to: Vec2; y: number } | null;
  torches: Mesh[];
  /** One boom per direction; together they close the whole road. `way` 1 is traffic along the checkpoint's yaw. */
  booms: Array<{ hinge: TransformNode; way: 1 | -1; at: Vec2; lift: number; openUntil: number }>;
  oneway: boolean;
};

const OFFICER: CharacterAppearance = { body: "male", skinTone: "rich", hairstyle: "low-fade", outfit: "police-uniform", accessory: "cap" };
const OFFICER_2: CharacterAppearance = { body: "female", skinTone: "deep", hairstyle: "buns", outfit: "police-uniform", accessory: "cap" };
const OFFICER_3: CharacterAppearance = { body: "male", skinTone: "deep", hairstyle: "low-fade", outfit: "police-uniform", accessory: "cap" };
const OFFICER_4: CharacterAppearance = { body: "male", skinTone: "warm", hairstyle: "low-fade", outfit: "police-uniform", accessory: "cap" };
const STOPPED_CARS = [["toyota-corolla", "#7a1f2b"], ["toyota-camry", "#2f4a6d"], ["honda-accord", "#5b5f63"], ["lexus-rx350", "#1f3d2b"]] as const;
const BOUNCER: CharacterAppearance = { body: "male", skinTone: "deep", hairstyle: "low-fade", outfit: "security-uniform", accessory: "glasses" };
const BOUNCER_2: CharacterAppearance = { body: "male", skinTone: "rich", hairstyle: "low-fade", outfit: "security-uniform", accessory: "beard" };

type Site = { id: string; kind: "checkpoint" | "club"; point: Vec2; yaw: number };

const SITES: Site[] = [
  ...POLICE_CHECKPOINTS.map((checkpoint) => ({ id: checkpoint.id, kind: "checkpoint" as const, point: checkpoint.point, yaw: checkpoint.yaw })),
  ...PLACES.filter((place) => CLUBS[place.id]).map((place) => ({ id: place.id, kind: "club" as const, point: place.door, yaw: place.facing })),
];

/**
 * Police checkpoints and bouncers at club doors. A checkpoint is a marked Hilux with a flashing light bar, a row of
 * striped drums down the centre line, a red-and-white boom across each side of the road (so the whole road is shut
 * until the officers wave a car through), a cone taper and barrier on the kerb side, a sign, and uniformed officers:
 * one flags traffic at the line, two inspect a pulled-over car with a torch and a handheld scanner whose beam sweeps it.
 */
export class StreetCrews {
  private crews = new Map<string, Crew>();
  private flagged: string | null = null;
  private time = 0;
  private readonly cone: StandardMaterial;
  private readonly red: StandardMaterial;
  private readonly blue: StandardMaterial;
  private readonly glow: StandardMaterial;
  private readonly signMaterial: StandardMaterial;
  private readonly white: StandardMaterial;
  private readonly drum: StandardMaterial;
  private readonly beam: StandardMaterial;
  private readonly torch: StandardMaterial;
  private readonly screen: StandardMaterial;
  private readonly dark: StandardMaterial;
  private readonly decal: StandardMaterial;

  constructor(
    private readonly scene: Scene,
    private readonly avatars: AvatarFactory,
    private readonly vehicles: VehicleFactory,
    private readonly ground: (x: number, z: number) => number,
    private readonly addCaster: (meshes: AbstractMesh[]) => void,
    /** The carriageway at a point (half its width, and whether it is one-way), so the booms reach kerb to kerb. */
    private readonly roadAt: (x: number, z: number) => { half: number; oneway: boolean } = () => ({ half: 5, oneway: false }),
  ) {
    const flat = (name: string, hex: string, glow = 0) => {
      const material = new StandardMaterial(name, scene);
      material.diffuseColor = Color3.FromHexString(hex);
      material.emissiveColor = Color3.FromHexString(hex).scale(glow);
      material.specularColor = new Color3(0.1, 0.1, 0.1);
      return material;
    };
    this.cone = flat("traffic cone", "#ff6a13", 0.25);
    this.red = flat("light bar red", "#ff2a2a", 1);
    this.blue = flat("light bar blue", "#2a6bff", 1);
    this.glow = new StandardMaterial("checkpoint glow", scene);
    this.glow.disableLighting = true;
    this.glow.emissiveColor = this.red.diffuseColor.clone();
    this.glow.alpha = 0.16;
    this.glow.alphaMode = Constants.ALPHA_ADD;
    this.glow.backFaceCulling = false;
    const texture = new DynamicTexture("checkpoint sign", { width: 512, height: 256 }, scene, true);
    const context = texture.getContext() as CanvasRenderingContext2D;
    context.fillStyle = "#14213d";
    context.fillRect(0, 0, 512, 256);
    context.fillStyle = "#ffffff";
    context.fillRect(12, 12, 488, 232);
    context.fillStyle = "#14213d";
    context.fillRect(24, 24, 464, 96);
    context.fillStyle = "#ffffff";
    context.textAlign = "center";
    context.font = "bold 64px sans-serif";
    context.fillText("POLICE", 256, 96);
    context.fillStyle = "#c62828";
    context.font = "bold 46px sans-serif";
    context.fillText("CHECKPOINT · STOP", 256, 200);
    texture.update();
    this.signMaterial = new StandardMaterial("checkpoint sign", scene);
    this.signMaterial.diffuseTexture = texture;
    this.signMaterial.emissiveColor = new Color3(0.4, 0.4, 0.4);
    this.signMaterial.specularColor = Color3.Black();
    this.white = flat("barrier white", "#f2f2f2", 0.15);
    this.dark = flat("scanner body", "#1b1d22");
    this.screen = flat("scanner screen", "#39ff9a", 1);
    this.torch = flat("torch beam", "#fff6cc", 1);
    this.torch.alpha = 0.35;
    this.beam = flat("scanner beam", "#ff3030", 1);
    this.beam.alpha = 0.55;
    this.beam.backFaceCulling = false;
    const stripes = new DynamicTexture("drum stripes", { width: 64, height: 128 }, scene, true);
    const sctx = stripes.getContext() as CanvasRenderingContext2D;
    for (let band = 0; band < 4; band += 1) {
      sctx.fillStyle = band % 2 ? "#f4f4f4" : "#d62020";
      sctx.fillRect(0, band * 32, 64, 32);
    }
    stripes.update();
    this.drum = new StandardMaterial("checkpoint drum", scene);
    this.drum.diffuseTexture = stripes;
    this.drum.emissiveColor = new Color3(0.2, 0.2, 0.2);
    this.drum.specularColor = new Color3(0.1, 0.1, 0.1);
    const lettering = new DynamicTexture("police lettering", { width: 512, height: 128 }, scene, true);
    const lctx = lettering.getContext() as CanvasRenderingContext2D;
    lctx.clearRect(0, 0, 512, 128);
    lctx.fillStyle = "#ffffff";
    lctx.font = "bold 96px sans-serif";
    lctx.textAlign = "center";
    lctx.fillText("POLICE", 256, 100);
    lettering.hasAlpha = true;
    lettering.update();
    this.decal = new StandardMaterial("police lettering", scene);
    this.decal.diffuseTexture = lettering;
    this.decal.useAlphaFromDiffuseTexture = true;
    this.decal.emissiveColor = new Color3(0.5, 0.5, 0.5);
    this.decal.specularColor = Color3.Black();
  }

  private part(mesh: Mesh, material: StandardMaterial, root: TransformNode) {
    mesh.material = material;
    mesh.parent = root;
    mesh.isPickable = false;
    return mesh;
  }

  /** Officers wave an ambient car through: lift that direction's boom for a few seconds. */
  openGate(checkpointId: string, way: 1 | -1) {
    const crew = this.crews.get(checkpointId);
    for (const boom of crew?.booms ?? []) if (crew!.oneway || boom.way === way) boom.openUntil = this.time + 4;
  }

  /** How far each boom at a checkpoint is lifted (0 shut, 1 up); for tests. */
  booms(checkpointId: string) {
    return this.crews.get(checkpointId)?.booms.map((boom) => ({ way: boom.way, lift: boom.lift, at: boom.at })) ?? null;
  }

  /** The officers at this checkpoint wave the player down; null when no stop is pending. */
  setFlagged(checkpointId: string | null) {
    this.flagged = checkpointId;
  }

  private person(name: string, look: CharacterAppearance, x: number, z: number, yaw: number) {
    const avatar = this.avatars.create(name, look);
    avatar.onMeshes = (meshes) => this.addCaster(meshes);
    avatar.root.position.set(x, this.ground(x, z), z);
    avatar.root.rotation.y = yaw;
    return { avatar, waving: false };
  }

  private build(site: Site): Crew {
    const root = new TransformNode(`crew ${site.id}`, this.scene);
    const [px, pz] = site.point;
    const fx = Math.sin(site.yaw);
    const fz = Math.cos(site.yaw);
    // Nigeria drives on the right, so the kerb is to the right of the direction of travel.
    const rx = Math.cos(site.yaw);
    const rz = -Math.sin(site.yaw);
    const at = (forward: number, right: number): Vec2 => [px + fx * forward + rx * right, pz + fz * forward + rz * right];
    const crew: Crew = { id: site.id, point: site.point, root, people: [], truck: null, stopped: null, lights: [], flash: null, scan: null, torches: [], booms: [], oneway: false };
    if (site.kind === "club") {
      const [ax, az] = at(0.6, -1.5);
      const [bx, bz] = at(0.6, 1.5);
      const bouncers = [this.person(`bouncer ${site.id} a`, BOUNCER, ax, az, site.yaw), this.person(`bouncer ${site.id} b`, BOUNCER_2, bx, bz, site.yaw)];
      for (const bouncer of bouncers) equipSecurity(this.scene, bouncer.avatar, false);
      crew.people.push(...bouncers);
      return crew;
    }
    const y = (x: number, z: number) => this.ground(x, z);
    const truck = this.vehicles.create(`police ${site.id}`, "toyota-hilux", "#1d2b4f");
    const [tx, tz] = at(-7, 4.4);
    truck.setPose(tx, y(tx, tz), tz, site.yaw);
    this.addCaster(truck.meshes);
    crew.truck = truck;
    for (const [index, material] of [this.red, this.blue].entries()) {
      const bar = MeshBuilder.CreateBox(`light bar ${site.id} ${index}`, { width: 0.5, height: 0.14, depth: 0.25 }, this.scene);
      bar.material = material;
      bar.parent = truck.root;
      bar.position.set(index ? 0.3 : -0.3, 2.05, 0.2);
      bar.isPickable = false;
      crew.lights.push(bar);
    }
    for (const side of [-1, 1]) {
      const word = MeshBuilder.CreatePlane(`police word ${site.id}`, { width: 1.6, height: 0.4 }, this.scene);
      this.part(word, this.decal, truck.root as unknown as TransformNode);
      word.position.set(side * (truck.model.width / 2 + 0.02), 0.95, 0.1);
      word.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
    }
    // A self-lit wash on the road rather than a real light: adding a scene light recompiles every material in the city.
    const flash = MeshBuilder.CreateDisc(`checkpoint flash ${site.id}`, { radius: 7, tessellation: 24 }, this.scene);
    flash.material = this.glow;
    flash.rotation.x = Math.PI / 2;
    flash.position.set(tx, y(tx, tz) + 0.06, tz);
    flash.isPickable = false;
    flash.parent = root;
    crew.flash = flash;

    // Striped drums down the centre line with a STOP plank across the middle pair.
    for (let index = 0; index < 5; index += 1) {
      const [dx, dz] = at(-6 + index * 3, 0);
      const drum = this.part(MeshBuilder.CreateCylinder(`drum ${site.id}`, { diameter: 0.58, height: 0.88, tessellation: 14 }, this.scene), this.drum, root);
      drum.position.set(dx, y(dx, dz) + 0.44, dz);
    }
    // A boom across each side of the road, hinged at the kerb, from kerb to the centre drums.
    // On a one-way carriageway both booms close the same line, so every lane meets one.
    const road = this.roadAt(px, pz);
    const roadHalf = Math.max(3, Math.min(9, road.half));
    crew.oneway = road.oneway;
    for (const way of [1, -1] as const) {
      const line = road.oneway ? CHECKPOINT_BOOM : way * CHECKPOINT_BOOM;
      const [hx, hz] = at(line, way * (roadHalf + 0.6));
      const post = this.part(MeshBuilder.CreateBox(`boom post ${site.id}`, { width: 0.3, height: 1.2, depth: 0.3 }, this.scene), this.dark, root);
      post.position.set(hx, y(hx, hz) + 0.6, hz);
      post.rotation.y = site.yaw;
      const hinge = new TransformNode(`boom hinge ${site.id} ${way}`, this.scene);
      hinge.parent = root;
      hinge.position.set(hx, y(hx, hz) + 1.05, hz);
      hinge.rotation.y = site.yaw;
      const reach = roadHalf + 0.3;
      const pieces = 6;
      for (let index = 0; index < pieces; index += 1) {
        const arm = this.part(MeshBuilder.CreateBox(`boom arm ${site.id}`, { width: reach / pieces, height: 0.14, depth: 0.1 }, this.scene), index % 2 ? this.white : this.red, hinge);
        arm.position.set(-way * (index + 0.5) * (reach / pieces), 0, 0);
      }
      const drum = this.part(MeshBuilder.CreateCylinder(`boom rest ${site.id}`, { diameter: 0.5, height: 0.9, tessellation: 12 }, this.scene), this.drum, root);
      const [rx0, rz0] = at(line, way * 0.5);
      drum.position.set(rx0, y(rx0, rz0) + 0.45, rz0);
      crew.booms.push({ hinge, way, at: at(line, way * roadHalf * 0.5), lift: 0, openUntil: 0 });
    }

    const [mx, mz] = at(1.5, 0);
    const plank = this.part(MeshBuilder.CreateBox(`stop plank ${site.id}`, { width: 0.12, height: 0.22, depth: 3.6 }, this.scene), this.white, root);
    plank.position.set(mx, y(mx, mz) + 0.98, mz);
    plank.rotation.y = site.yaw;
    // Cones taper in from the kerb to a red-and-white barrier closing the shoulder ahead of the inspection bay.
    for (let index = 0; index < 7; index += 1) {
      const [cx, cz] = at(-16 + index * 2.4, 5.6 - index * 0.32);
      const cone = this.part(MeshBuilder.CreateCylinder(`cone ${site.id}`, { diameterTop: 0.05, diameterBottom: 0.36, height: 0.7, tessellation: 10 }, this.scene), this.cone, root);
      cone.position.set(cx, y(cx, cz) + 0.35, cz);
    }
    const [bx, bz] = at(8, 4.4);
    for (const offset of [-1.3, 1.3]) {
      const leg = this.part(MeshBuilder.CreateBox(`barrier leg ${site.id}`, { width: 0.08, height: 1.0, depth: 0.5 }, this.scene), this.dark, root);
      leg.position.set(bx + rx * offset, y(bx, bz) + 0.5, bz + rz * offset);
      leg.rotation.y = site.yaw;
    }
    for (const [index, height] of [0.55, 0.9].entries()) {
      const rail = this.part(MeshBuilder.CreateBox(`barrier rail ${site.id}`, { width: 2.9, height: 0.16, depth: 0.05 }, this.scene), index ? this.white : this.red, root);
      rail.position.set(bx, y(bx, bz) + height, bz);
      rail.rotation.y = site.yaw;
    }
    const [sx, sz] = at(-22, 5.6);
    for (const offset of [-0.7, 0.7]) {
      const post = MeshBuilder.CreateBox(`checkpoint sign post ${site.id}`, { width: 0.07, height: 1.6, depth: 0.07 }, this.scene);
      post.position.set(sx + rx * offset, y(sx, sz) + 0.8, sz + rz * offset);
      post.parent = root;
    }
    const board = MeshBuilder.CreatePlane(`checkpoint sign ${site.id}`, { width: 1.8, height: 0.9, sideOrientation: Mesh.DOUBLESIDE }, this.scene);
    board.material = this.signMaterial;
    board.position.set(sx, y(sx, sz) + 1.75, sz);
    board.rotation.y = site.yaw + Math.PI;
    board.parent = root;

    // A pulled-over car in the inspection bay; one officer at the driver's window with a torch, one scanning it.
    const [model, colour] = STOPPED_CARS[Math.floor(Math.abs(Math.sin(px * 0.13 + pz * 0.07)) * STOPPED_CARS.length)]!;
    const stopped = this.vehicles.create(`checked car ${site.id}`, model, colour);
    const [cx, cz] = at(2, 4.4);
    stopped.setPose(cx, y(cx, cz), cz, site.yaw);
    this.addCaster(stopped.meshes);
    crew.stopped = stopped;
    const half = stopped.model.length / 2;
    crew.scan = {
      beam: this.part(MeshBuilder.CreateBox(`scan beam ${site.id}`, { width: stopped.model.width + 0.3, height: 0.03, depth: 0.08 }, this.scene), this.beam, root),
      from: at(2 - half, 4.4),
      to: at(2 + half, 4.4),
      y: y(cx, cz) + stopped.model.height + 0.04,
    };
    crew.scan.beam.rotation.y = site.yaw;

    const [ox, oz] = at(0, 2.9);
    const [qx, qz] = at(-3, 3.0);
    const [wx, wz] = at(2.6, 4.4 - stopped.model.width / 2 - 0.55);
    const [kx, kz] = at(2 + half + 0.9, 4.4);
    const flagger = this.person(`officer ${site.id} a`, OFFICER, ox, oz, site.yaw + Math.PI * 0.75);
    const window = this.person(`officer ${site.id} b`, OFFICER_2, wx, wz, site.yaw + Math.PI / 2);
    const scanner = this.person(`officer ${site.id} c`, OFFICER_3, kx, kz, site.yaw + Math.PI);
    const guard = this.person(`officer ${site.id} d`, OFFICER_4, qx, qz, site.yaw + Math.PI);
    crew.people.push(flagger, window, scanner, guard);
    for (const officer of crew.people) equipPolice(this.scene, officer.avatar);
    const torch = this.part(MeshBuilder.CreateCylinder(`torch ${site.id}`, { diameterTop: 0.04, diameterBottom: 0.5, height: 1.1, tessellation: 12 }, this.scene), this.torch, window.avatar.root as unknown as TransformNode);
    torch.rotation.x = -Math.PI / 2 + 0.25;
    torch.position.set(0.22, 1.25, 0.65);
    crew.torches.push(torch);
    const device = this.part(MeshBuilder.CreateBox(`scanner ${site.id}`, { width: 0.12, height: 0.06, depth: 0.2 }, this.scene), this.dark, scanner.avatar.root as unknown as TransformNode);
    device.position.set(0.25, 1.1, 0.35);
    const display = this.part(MeshBuilder.CreateBox(`scanner screen ${site.id}`, { width: 0.09, height: 0.01, depth: 0.12 }, this.scene), this.screen, device as unknown as TransformNode);
    display.position.y = 0.035;
    return crew;
  }

  private dispose(crew: Crew) {
    for (const torch of crew.torches) torch.dispose();
    for (const person of crew.people) person.avatar.dispose();
    crew.truck?.dispose();
    crew.stopped?.dispose();
    crew.flash?.dispose();
    crew.root.dispose(false, false);
  }

  update(dt: number, x: number, z: number, outdoors: boolean) {
    this.time += dt;
    for (const site of SITES) {
      const distance = Math.hypot(site.point[0] - x, site.point[1] - z);
      const crew = this.crews.get(site.id);
      if (!crew && outdoors && distance < SHOW_METRES) this.crews.set(site.id, this.build(site));
      else if (crew && (!outdoors || distance > SHOW_METRES + 80)) {
        this.dispose(crew);
        this.crews.delete(site.id);
      }
    }
    const flash = Math.floor(this.time * 3) % 2 === 0;
    this.glow.emissiveColor.copyFrom(flash ? this.red.diffuseColor : this.blue.diffuseColor);
    for (const crew of this.crews.values()) {
      crew.lights[0]?.setEnabled(flash);
      crew.lights[1]?.setEnabled(!flash);
      crew.truck?.track(dt);
      if (crew.scan) {
        const f = 0.5 - 0.5 * Math.cos(this.time * 1.6);
        const { from, to } = crew.scan;
        crew.scan.beam.position.set(from[0] + (to[0] - from[0]) * f, crew.scan.y, from[1] + (to[1] - from[1]) * f);
      }
      for (const boom of crew.booms) {
        // The player isn't held at the boom by force: it lifts as they come up unless they've been flagged down
        // (and still lifts if they push on through, which counts as driving off).
        const playerGap = Math.hypot(boom.at[0] - x, boom.at[1] - z);
        const open = this.time < boom.openUntil || (playerGap < 14 && (this.flagged !== crew.id || playerGap < 4));
        boom.lift += Math.max(-1.5 * dt, Math.min(1.5 * dt, (open ? 1 : 0) - boom.lift));
        boom.hinge.rotation.z = -boom.way * boom.lift * 1.35;
      }
      for (const [index, person] of crew.people.entries()) {
        const waving = index === 0 && this.flagged === crew.id;
        person.avatar.update(0, waving ? "wave" : "idle", dt);
      }
    }
  }

  disposeAll() {
    for (const crew of this.crews.values()) this.dispose(crew);
    this.crews.clear();
  }
}
