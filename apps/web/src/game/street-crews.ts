import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { CLUBS, PLACES, POLICE_CHECKPOINTS, type CharacterAppearance, type Vec2 } from "@lagos-living/shared";
import type { Avatar, AvatarFactory } from "./avatar";
import type { VehicleFactory, VehicleView } from "./vehicles";

/** Crews are built when the player comes this close and removed past SHOW + 80 m. */
const SHOW_METRES = 260;

type Person = { avatar: Avatar; waving: boolean };
type Crew = { id: string; point: Vec2; root: TransformNode; people: Person[]; truck: VehicleView | null; lights: Mesh[] };

const OFFICER: CharacterAppearance = { body: "male", skinTone: "rich", hairstyle: "low-fade", outfit: "office-smart", accessory: "cap" };
const OFFICER_2: CharacterAppearance = { body: "female", skinTone: "deep", hairstyle: "buns", outfit: "office-skirt", accessory: "none" };
const BOUNCER: CharacterAppearance = { body: "male", skinTone: "deep", hairstyle: "low-fade", outfit: "office-smart", accessory: "glasses" };
const BOUNCER_2: CharacterAppearance = { body: "male", skinTone: "rich", hairstyle: "low-fade", outfit: "office-smart", accessory: "beard" };

type Site = { id: string; kind: "checkpoint" | "club"; point: Vec2; yaw: number };

const SITES: Site[] = [
  ...POLICE_CHECKPOINTS.map((checkpoint) => ({ id: checkpoint.id, kind: "checkpoint" as const, point: checkpoint.point, yaw: checkpoint.yaw })),
  ...PLACES.filter((place) => CLUBS[place.id]).map((place) => ({ id: place.id, kind: "club" as const, point: place.door, yaw: place.facing })),
];

/** Police checkpoints (a marked Hilux, flashing light bar, officers, cones and a sign) and bouncers at club doors. */
export class StreetCrews {
  private crews = new Map<string, Crew>();
  private flagged: string | null = null;
  private time = 0;
  private readonly cone: StandardMaterial;
  private readonly red: StandardMaterial;
  private readonly blue: StandardMaterial;
  private readonly signMaterial: StandardMaterial;

  constructor(
    private readonly scene: Scene,
    private readonly avatars: AvatarFactory,
    private readonly vehicles: VehicleFactory,
    private readonly ground: (x: number, z: number) => number,
    private readonly addCaster: (meshes: AbstractMesh[]) => void,
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
    const crew: Crew = { id: site.id, point: site.point, root, people: [], truck: null, lights: [] };
    if (site.kind === "club") {
      const [ax, az] = at(0.6, -1.5);
      const [bx, bz] = at(0.6, 1.5);
      crew.people.push(this.person(`bouncer ${site.id} a`, BOUNCER, ax, az, site.yaw), this.person(`bouncer ${site.id} b`, BOUNCER_2, bx, bz, site.yaw));
      return crew;
    }
    const truck = this.vehicles.create(`police ${site.id}`, "toyota-hilux", "#1d2b4f");
    const [tx, tz] = at(-6, 3.2);
    truck.setPose(tx, this.ground(tx, tz), tz, site.yaw);
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
    // Cones taper the lane in from the kerb side ahead of the officers.
    for (let index = 0; index < 7; index += 1) {
      const [cx, cz] = at(-14 + index * 2.4, 3.4 - index * 0.35);
      const cone = MeshBuilder.CreateCylinder(`cone ${site.id}`, { diameterTop: 0.05, diameterBottom: 0.36, height: 0.7, tessellation: 10 }, this.scene);
      cone.material = this.cone;
      cone.position.set(cx, this.ground(cx, cz) + 0.35, cz);
      cone.parent = root;
      cone.isPickable = false;
    }
    const [sx, sz] = at(-20, 4.2);
    for (const offset of [-0.7, 0.7]) {
      const post = MeshBuilder.CreateBox(`checkpoint sign post ${site.id}`, { width: 0.07, height: 1.6, depth: 0.07 }, this.scene);
      post.position.set(sx + rx * offset, this.ground(sx, sz) + 0.8, sz + rz * offset);
      post.parent = root;
    }
    const board = MeshBuilder.CreatePlane(`checkpoint sign ${site.id}`, { width: 1.8, height: 0.9, sideOrientation: Mesh.DOUBLESIDE }, this.scene);
    board.material = this.signMaterial;
    board.position.set(sx, this.ground(sx, sz) + 1.75, sz);
    board.rotation.y = site.yaw + Math.PI;
    board.parent = root;
    const [ox, oz] = at(0, 1.8);
    const [qx, qz] = at(-2.5, 2.8);
    crew.people.push(this.person(`officer ${site.id} a`, OFFICER, ox, oz, site.yaw + Math.PI * 0.75), this.person(`officer ${site.id} b`, OFFICER_2, qx, qz, site.yaw + Math.PI));
    return crew;
  }

  private dispose(crew: Crew) {
    for (const person of crew.people) person.avatar.dispose();
    crew.truck?.dispose();
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
    for (const crew of this.crews.values()) {
      crew.lights[0]?.setEnabled(flash);
      crew.lights[1]?.setEnabled(!flash);
      crew.truck?.track(dt);
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
