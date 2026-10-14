import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import {
  hash01,
  OWAMBE,
  OWAMBE_GROUND,
  OWAMBE_HIGH_TABLE,
  OWAMBE_KITCHEN,
  OWAMBE_STYLE,
  owambeDish,
  owambeTables,
  type CharacterAppearance,
  type OutfitId,
  type OwambeParty,
  type Vec2,
} from "@lagos-living/shared";
import { appearanceFor, type Avatar, type AvatarFactory } from "./avatar";
import { equipSinger, equipWaiter } from "./costume-kit";
import type { ClubSeat } from "./interior";

type Obstacles = { add(a: Vec2, b: Vec2, r: number): { a: Vec2; b: Vec2; r: number }; remove(items: Array<{ a: Vec2; b: Vec2; r: number }>): void };

const SHOW_METRES = 220;
const PEOPLE_METRES = 80;
export const OWAMBE_CHAIR_Y = 0.47;
const CHAIR_Y = OWAMBE_CHAIR_Y;
const MEN: OutfitId[] = ["agbada-royal", "senator-black", "aso-oke-wine", "senator-kaftan"];
const WOMEN: OutfitId[] = ["boubou-gold", "lace-wine", "gown-emerald", "ankara-dress"];
/** Where the highlife singer stands (relative to the ground's centre): at the stage's edge, singing to the hall. */
const SINGER: Vec2 = [3.4, 5.1];
const DRUMMER: Vec2 = [4.6, 5.3];

/** Every chair that is one of the neighbourhood's guests' for the whole party; residents sit in the others. */
const guestSeat = (table: number, seat: number) => hash01(`owambe-guest:${table}:${seat}`) < 0.3;

type Served = { sessionId: string; table: number; seat: number; dish: string };
type Waiter = { avatar: Avatar; tray: Mesh; path: Vec2[]; t: number; serve: Served; done: boolean };
type Meal = { serve: Served; plate: TransformNode; morsel: Mesh; until: number; nextBite: number };
type Role = "guest" | "celebrant" | "singer" | "drummer";
type Guest = { avatar: Avatar; at: Vec2; yaw: number; pose: "sit" | "dance" | "idle"; morsel: Mesh | null; nextBite: number; role: Role; floor: Vec2 | null };

export type OwambeEater = { avatar: Avatar; local: boolean } | null;

/**
 * The owambe on the event ground: a white marquee dressed in the party's aso-ebi, round tables of eight with covered
 * chairs, the high table under a banner with the celebrant's name, a DJ stand, the dance floor and the caterers' tent.
 * Guests in aso-ebi fill a third of the chairs and a few are always dancing; waiters bring a plate to whoever orders,
 * and residents eat at the table, by hand for the swallows.
 */
export class OwambeView {
  private root: TransformNode | null = null;
  private people: Guest[] = [];
  private waiters: Waiter[] = [];
  private meals: Meal[] = [];
  private asoEbi: StandardMaterial | null = null;
  private trim: StandardMaterial | null = null;
  private banner: DynamicTexture | null = null;
  private party: OwambeParty | null = null;
  private time = 0;
  private celebrateUntil = 0;
  private blockers: Array<{ a: Vec2; b: Vec2; r: number }> = [];
  private readonly shades = new Map<string, StandardMaterial>();
  readonly seats: ClubSeat[];

  constructor(
    private readonly scene: Scene,
    private readonly avatars: AvatarFactory,
    private readonly ground: (x: number, z: number) => number,
    private readonly addCaster: (meshes: AbstractMesh[]) => void,
    private readonly eater: (sessionId: string) => OwambeEater,
    private readonly obstacles: () => Obstacles | null = () => null,
  ) {
    this.seats = owambeTables().flatMap((table) =>
      table.seats.flatMap((seat, index) => (guestSeat(table.no, index) ? [] : [{ at: seat.at, yaw: seat.yaw, y: this.ground(...seat.at) + CHAIR_Y, stool: false, table: table.no * 10 + index }])),
    );
  }

  private material(name: string, hex: string, glow = 0) {
    const material = new StandardMaterial(name, this.scene);
    material.diffuseColor = Color3.FromHexString(hex);
    material.emissiveColor = Color3.FromHexString(hex).scale(glow);
    material.specularColor = new Color3(0.06, 0.06, 0.06);
    return material;
  }

  /** Shared food and prop colours, kept across plates (plates and morsels never dispose their materials). */
  private shade(hex: string, glow = 0.12, specks?: string[]) {
    const key = `${hex}:${glow}:${specks?.join(",") ?? ""}`;
    let material = this.shades.get(key);
    if (!material) {
      material = this.material(`owambe shade ${key}`, hex, glow);
      if (specks) {
        // Grains of rice, peas and carrot, or the pepper in a stew: dots of colour over the base.
        const texture = new DynamicTexture(`owambe grain ${key}`, { width: 128, height: 128 }, this.scene, true);
        const context = texture.getContext() as CanvasRenderingContext2D;
        context.fillStyle = hex;
        context.fillRect(0, 0, 128, 128);
        for (let i = 0; i < 420; i++) {
          context.fillStyle = specks[i % specks.length]!;
          const x = hash01(`grain:${key}:${i}:x`) * 128;
          const y = hash01(`grain:${key}:${i}:y`) * 128;
          context.beginPath();
          context.ellipse(x, y, 2.6, 1.3, hash01(`grain:${i}:r`) * Math.PI, 0, Math.PI * 2);
          context.fill();
        }
        texture.update();
        material.diffuseTexture = texture;
        material.diffuseColor = Color3.White();
      }
      this.shades.set(key, material);
    }
    return material;
  }

  private block(a: Vec2, b: Vec2, r: number) {
    const grid = this.obstacles();
    if (grid) this.blockers.push(grid.add(a, b, r));
  }

  /** Tables, chairs, the stage and the DJ's kit stop people walking through them while the marquee is up. */
  private addBlockers() {
    const [cx, cz] = OWAMBE_GROUND.centre;
    const at = (x: number, z: number): Vec2 => [cx + x, cz + z];
    for (const table of owambeTables()) {
      this.block(table.at, table.at, 0.86);
      for (const seat of table.seats) this.block(seat.at, seat.at, 0.25);
    }
    const [hx, hz] = OWAMBE_HIGH_TABLE;
    this.block([hx - 3, hz + 0.6], [hx + 3, hz + 0.6], 1.5);
    this.block(at(-9.2, 3), at(-8, 3), 0.4);
    for (const z of [1.2, 4.8]) this.block(at(-10.6, z), at(-10.6, z), 0.38);
    const [kx, kz] = OWAMBE_KITCHEN;
    this.block([kx - 1.2, kz + 0.6], [kx + 1.2, kz + 0.6], 0.42);
    this.block([kx - 1, kz - 0.9], [kx + 1, kz - 0.9], 0.24);
    const [W, D] = [OWAMBE_GROUND.width, OWAMBE_GROUND.depth];
    for (let x = -W / 2; x <= W / 2 + 0.01; x += W / 4) for (const z of x === 0 ? [D / 2] : [-D / 2, D / 2]) this.block(at(x, z), at(x, z), 0.1);
    for (const z of [-D / 4, 0, D / 4]) for (const x of [-W / 2, W / 2]) this.block(at(x, z), at(x, z), 0.1);
    this.block(at(SINGER[0], SINGER[1] - 0.55), at(SINGER[0], SINGER[1] - 0.55), 0.16);
  }

  private removeBlockers() {
    this.obstacles()?.remove(this.blockers);
    this.blockers = [];
  }

  private build() {
    const [cx, cz] = OWAMBE_GROUND.centre;
    const root = new TransformNode("owambe", this.scene);
    root.position.set(cx, this.ground(cx, cz), cz);
    const style = OWAMBE_STYLE[this.party?.kind ?? "wedding"];
    const white = this.material("owambe white", "#f6f4ef", 0.18);
    const canvas = this.material("owambe canvas", "#fbfaf6", 0.35);
    const asoEbi = this.material("owambe aso-ebi", style.asoEbi, 0.25);
    const trim = this.material("owambe trim", style.trim, 0.35);
    const steel = this.material("owambe steel", "#9aa0a6", 0.05);
    const black = this.material("owambe black", "#141416", 0.05);
    const carpet = this.material("owambe carpet", "#a3121e", 0.12);
    const floor = this.material("owambe floor", "#2a2a30", 0.1);
    const gold = this.material("owambe gold", "#d6a93a", 0.3);
    this.asoEbi = asoEbi;
    this.trim = trim;
    const parts: Mesh[] = [];
    const part = (mesh: Mesh, material: StandardMaterial, x: number, y: number, z: number, cast = true) => {
      mesh.material = material;
      mesh.parent = root;
      mesh.position.set(x, y, z);
      mesh.isPickable = false;
      if (cast) parts.push(mesh);
      return mesh;
    };
    const [W, D] = [OWAMBE_GROUND.width, OWAMBE_GROUND.depth];
    const H = 3.6;
    // Marquee: poles all round, a white pitched roof, and swags of the aso-ebi along every edge.
    for (let x = -W / 2; x <= W / 2 + 0.01; x += W / 4) {
      // The middle of the front stays open over the carpet.
      for (const z of x === 0 ? [D / 2] : [-D / 2, D / 2]) part(MeshBuilder.CreateCylinder("owambe pole", { diameter: 0.12, height: H }, this.scene), steel, x, H / 2, z);
    }
    for (const z of [-D / 4, 0, D / 4]) for (const x of [-W / 2, W / 2]) part(MeshBuilder.CreateCylinder("owambe pole", { diameter: 0.12, height: H }, this.scene), steel, x, H / 2, z);
    const pitch = Math.atan2(1.4, W / 2);
    for (const side of [-1, 1]) {
      const roof = part(MeshBuilder.CreateBox("owambe roof", { width: Math.hypot(W / 2, 1.4) + 0.3, height: 0.06, depth: D + 0.4 }, this.scene), canvas, (side * W) / 4, H + 0.7, 0, false);
      roof.rotation.z = -side * pitch;
      part(MeshBuilder.CreateBox("owambe valance", { width: 0.05, height: 0.45, depth: D + 0.4 }, this.scene), asoEbi, (side * (W + 0.3)) / 2, H - 0.2, 0, false);
      part(MeshBuilder.CreateBox("owambe valance end", { width: W + 0.3, height: 0.45, depth: 0.05 }, this.scene), asoEbi, 0, H - 0.2, (side * (D + 0.4)) / 2, false);
      part(MeshBuilder.CreateBox("owambe gable", { width: W + 0.3, height: 0.06, depth: 0.06 }, this.scene), trim, 0, H + 0.02, (side * (D + 0.4)) / 2, false);
    }
    // Ceiling drapes, gathered at the ridge.
    for (let x = -W / 2 + 2; x < W / 2; x += 4) {
      const drape = part(MeshBuilder.CreateBox("owambe drape", { width: 0.5, height: 0.02, depth: D }, this.scene), x % 8 === 0 ? asoEbi : white, x, H + 0.5, 0, false);
      drape.rotation.z = (x < 0 ? -1 : 1) * pitch;
    }
    // Red carpet from the entrance up to the high table, and a dance floor in front of it.
    part(MeshBuilder.CreateBox("owambe carpet", { width: 1.6, height: 0.02, depth: D }, this.scene), carpet, 0, 0.02, 0, false);
    part(MeshBuilder.CreateBox("owambe dance floor", { width: 10, height: 0.04, depth: 4.6 }, this.scene), floor, 0, 0.03, 2.4, false);
    for (let i = 0; i < 5; i++) part(MeshBuilder.CreateBox("owambe floor stripe", { width: 10, height: 0.005, depth: 0.05 }, this.scene), gold, 0, 0.052, 0.4 + i, false);
    // Round tables of eight: white cloth to the ground, a bow of the aso-ebi on every chair.
    const centrepiece = this.material("owambe flowers", "#f2e6c8", 0.3);
    for (const table of owambeTables()) {
      const tx = table.at[0] - cx;
      const tz = table.at[1] - cz;
      part(MeshBuilder.CreateCylinder("owambe table cloth", { diameter: 1.75, diameterTop: 1.6, height: 0.74, tessellation: 24 }, this.scene), white, tx, 0.37, tz);
      part(MeshBuilder.CreateCylinder("owambe table top", { diameter: 1.62, height: 0.03, tessellation: 24 }, this.scene), white, tx, 0.755, tz);
      part(MeshBuilder.CreateCylinder("owambe runner", { diameter: 0.7, height: 0.005, tessellation: 20 }, this.scene), asoEbi, tx, 0.772, tz, false);
      part(MeshBuilder.CreateCylinder("owambe vase", { diameter: 0.12, diameterBottom: 0.08, height: 0.35 }, this.scene), gold, tx, 0.95, tz);
      part(MeshBuilder.CreateSphere("owambe flowers", { diameter: 0.34, segments: 6 }, this.scene), centrepiece, tx, 1.2, tz);
      for (const seat of table.seats) {
        const chair = new TransformNode("owambe chair", this.scene);
        chair.parent = root;
        chair.position.set(seat.at[0] - cx, 0, seat.at[1] - cz);
        chair.rotation.y = seat.yaw;
        const piece = (mesh: Mesh, material: StandardMaterial, x: number, y: number, z: number) => {
          mesh.material = material;
          mesh.parent = chair;
          mesh.position.set(x, y, z);
          mesh.isPickable = false;
          parts.push(mesh);
          return mesh;
        };
        piece(MeshBuilder.CreateBox("owambe seat", { width: 0.46, height: 0.06, depth: 0.46 }, this.scene), white, 0, CHAIR_Y - 0.03, 0);
        piece(MeshBuilder.CreateBox("owambe chair skirt", { width: 0.47, height: CHAIR_Y - 0.06, depth: 0.47 }, this.scene), white, 0, (CHAIR_Y - 0.06) / 2, 0);
        piece(MeshBuilder.CreateBox("owambe chair back", { width: 0.46, height: 0.62, depth: 0.05 }, this.scene), white, 0, CHAIR_Y + 0.31, -0.22);
        piece(MeshBuilder.CreateBox("owambe sash", { width: 0.48, height: 0.1, depth: 0.07 }, this.scene), asoEbi, 0, CHAIR_Y + 0.28, -0.24);
        piece(MeshBuilder.CreateBox("owambe bow", { width: 0.16, height: 0.12, depth: 0.04 }, this.scene), asoEbi, 0, CHAIR_Y + 0.28, -0.28);
      }
    }
    // High table on a low stage under the banner, with gold chairs for the celebrants.
    const [hx, hz] = [OWAMBE_HIGH_TABLE[0] - cx, OWAMBE_HIGH_TABLE[1] - cz];
    part(MeshBuilder.CreateBox("owambe stage", { width: 9, height: 0.25, depth: 3 }, this.scene), floor, hx, 0.125, hz + 0.6);
    part(MeshBuilder.CreateBox("owambe high table", { width: 5.5, height: 0.76, depth: 0.8 }, this.scene), white, hx, 0.25 + 0.38, hz);
    part(MeshBuilder.CreateBox("owambe high table skirt", { width: 5.52, height: 0.3, depth: 0.82 }, this.scene), asoEbi, hx, 0.25 + 0.6, hz);
    for (const offset of [-1.6, -0.55, 0.55, 1.6]) {
      part(MeshBuilder.CreateBox("owambe throne", { width: 0.6, height: 1.3, depth: 0.12 }, this.scene), gold, hx + offset, 0.25 + 0.65, hz + 1.05);
      part(MeshBuilder.CreateBox("owambe throne seat", { width: 0.6, height: 0.08, depth: 0.55 }, this.scene), gold, hx + offset, 0.25 + CHAIR_Y, hz + 0.8);
    }
    const backdrop = part(MeshBuilder.CreatePlane("owambe banner", { width: 8, height: 2.2 }, this.scene), this.material("owambe banner", "#ffffff", 0.75), hx, 2.3, hz + 2.05, false);
    this.banner = new DynamicTexture("owambe banner", { width: 1024, height: 280 }, this.scene, true);
    const bannerMaterial = backdrop.material as StandardMaterial;
    bannerMaterial.diffuseTexture = this.banner;
    bannerMaterial.emissiveTexture = this.banner;
    for (const side of [-1, 1]) part(MeshBuilder.CreateBox("owambe backdrop post", { width: 0.12, height: 3.4, depth: 0.12 }, this.scene), gold, hx + side * 4.05, 1.7, hz + 2.1);
    // DJ stand and speaker stacks on the left of the dance floor.
    part(MeshBuilder.CreateBox("owambe dj table", { width: 1.8, height: 0.95, depth: 0.7 }, this.scene), black, -8.6, 0.475, 3);
    part(MeshBuilder.CreateBox("owambe dj deck", { width: 1.2, height: 0.08, depth: 0.45 }, this.scene), steel, -8.6, 0.99, 3);
    for (const z of [1.2, 4.8]) {
      part(MeshBuilder.CreateBox("owambe speaker", { width: 0.6, height: 1.1, depth: 0.55 }, this.scene), black, -10.6, 0.55, z);
      part(MeshBuilder.CreateBox("owambe speaker top", { width: 0.5, height: 0.7, depth: 0.45 }, this.scene), black, -10.6, 1.45, z);
      part(MeshBuilder.CreateCylinder("owambe cone", { diameter: 0.4, height: 0.02 }, this.scene), steel, -10.6 + 0.31, 0.6, z).rotation.z = Math.PI / 2;
    }
    // The caterers' tent beside the marquee: a table of coolers and chafing dishes.
    const [kx, kz] = [OWAMBE_KITCHEN[0] - cx, OWAMBE_KITCHEN[1] - cz];
    for (const [dx, dz] of [[-1.8, -1.4], [1.8, -1.4], [-1.8, 1.4], [1.8, 1.4]] as const) part(MeshBuilder.CreateCylinder("owambe kitchen pole", { diameter: 0.08, height: 2.6 }, this.scene), steel, kx + dx, 1.3, kz + dz);
    part(MeshBuilder.CreateBox("owambe kitchen roof", { width: 4, height: 0.06, depth: 3.2 }, this.scene), asoEbi, kx, 2.62, kz, false);
    part(MeshBuilder.CreateBox("owambe kitchen table", { width: 3, height: 0.78, depth: 0.8 }, this.scene), white, kx, 0.39, kz + 0.6);
    const coolers = [this.material("owambe cooler blue", "#2d64b3", 0.15), this.material("owambe cooler red", "#c0392b", 0.15)];
    for (const [index, dx] of [-1.1, -0.35, 0.4, 1.1].entries()) {
      part(MeshBuilder.CreateCylinder("owambe cooler", { diameter: 0.5, height: 0.42 }, this.scene), coolers[index % 2]!, kx + dx, 0.99, kz + 0.6);
      part(MeshBuilder.CreateCylinder("owambe cooler lid", { diameter: 0.52, height: 0.05 }, this.scene), white, kx + dx, 1.22, kz + 0.6);
    }
    for (const dx of [-1, 0, 1]) part(MeshBuilder.CreateBox("owambe chafer", { width: 0.6, height: 0.22, depth: 0.4 }, this.scene), steel, kx + dx, 0.11, kz - 0.9);
    for (const mesh of parts) mesh.freezeWorldMatrix();
    this.addCaster(parts);
    this.root = root;
    this.addBlockers();
    this.drawBanner();
  }

  private drawBanner() {
    const banner = this.banner;
    if (!banner || !this.party) return;
    const style = OWAMBE_STYLE[this.party.kind];
    const context = banner.getContext() as CanvasRenderingContext2D;
    context.fillStyle = style.asoEbi;
    context.fillRect(0, 0, 1024, 280);
    context.strokeStyle = style.trim;
    context.lineWidth = 10;
    context.strokeRect(14, 14, 996, 252);
    context.fillStyle = "#ffffff";
    context.textAlign = "center";
    context.font = "bold 30px serif";
    context.fillText(`${style.emoji}  ${style.label.toUpperCase()}  ${style.emoji}`, 512, 70);
    const line = style.banner(this.party.celebrant);
    let size = 64;
    do {
      context.font = `italic bold ${size}px serif`;
      size -= 4;
    } while (context.measureText(line).width > 940 && size > 28);
    context.fillText(line, 512, 165);
    context.font = "26px sans-serif";
    context.fillText(this.party.host ? `Hosted by ${this.party.host} · come and chop!` : "Everyone is welcome · food and drinks on the family", 512, 232);
    banner.update();
  }

  setParty(party: OwambeParty) {
    const changed = this.party?.kind !== party.kind || this.party?.celebrant !== party.celebrant || this.party?.startsAt !== party.startsAt;
    this.party = party;
    if (!changed) return;
    const style = OWAMBE_STYLE[party.kind];
    this.asoEbi?.diffuseColor.copyFrom(Color3.FromHexString(style.asoEbi));
    this.asoEbi?.emissiveColor.copyFrom(Color3.FromHexString(style.asoEbi).scale(0.25));
    this.trim?.diffuseColor.copyFrom(Color3.FromHexString(style.trim));
    this.drawBanner();
    if (this.people.length) {
      this.clearPeople();
      this.spawnPeople();
    }
  }

  private guestLook(seed: number): CharacterAppearance {
    const base = appearanceFor(seed);
    const female = base.body === "female";
    const outfit = (female ? WOMEN : MEN)[Math.floor(hash01(`owambe-outfit:${seed}`) * 4)]!;
    return { ...base, outfit, accessory: female ? "headwrap" : base.accessory === "beard" ? "beard" : "cap" };
  }

  private spawnPeople() {
    if (!this.party) return;
    const kind = this.party.kind;
    const add = (seed: number, at: Vec2, yaw: number, pose: Guest["pose"], look?: CharacterAppearance, role: Role = "guest", floor: Vec2 | null = null) => {
      const avatar = this.avatars.create(`owambe guest ${seed}`, look ?? this.guestLook(seed + Math.floor(this.party!.startsAt / OWAMBE.partyMs)));
      avatar.onMeshes = (meshes) => this.addCaster(meshes);
      avatar.root.position.set(at[0], this.ground(...at) + (pose === "sit" ? CHAIR_Y : 0), at[1]);
      avatar.root.rotation.y = yaw;
      this.people.push({ avatar, at, yaw, pose, morsel: null, nextBite: this.time + hash01(`bite:${seed}`) * 6, role, floor });
      return avatar;
    };
    let seed = 0;
    for (const table of owambeTables()) {
      table.seats.forEach((seat, index) => {
        if (guestSeat(table.no, index) && seed < 11) add(seed++, seat.at, seat.yaw, "sit");
      });
    }
    // The celebrants at the high table, facing the hall.
    const [hx, hz] = OWAMBE_HIGH_TABLE;
    const couple: CharacterAppearance[] =
      kind === "wedding"
        ? [{ body: "male", skinTone: "rich", hairstyle: "low-fade", outfit: "agbada-royal", accessory: "cap" }, { body: "female", skinTone: "warm", hairstyle: "buns", outfit: "boubou-gold", accessory: "headwrap" }]
        : kind === "birthday"
          ? [{ body: "female", skinTone: "deep", hairstyle: "buns", outfit: "lace-wine", accessory: "headwrap" }]
          : [{ body: "male", skinTone: "deep", hairstyle: "low-fade", outfit: "senator-black", accessory: "cap" }, { body: "female", skinTone: "rich", hairstyle: "braids", outfit: "lace-wine", accessory: "headwrap" }];
    couple.forEach((look, index) => {
      const dx = couple.length === 1 ? 0 : index ? 0.6 : -0.6;
      add(100 + index, [hx + dx, hz + 0.8], Math.PI, "sit", look, "celebrant", [hx + dx, hz - 2.1]);
    });
    // The live band: a singer in agbada at the microphone and a talking drummer beside him.
    const [cx, cz] = OWAMBE_GROUND.centre;
    const singer = add(400, [cx + SINGER[0], cz + SINGER[1]], Math.PI, "idle", { body: "male", skinTone: "deep", hairstyle: "low-fade", outfit: "aso-oke-wine", accessory: "cap" }, "singer");
    equipSinger(this.scene, singer);
    const drummer = add(401, [cx + DRUMMER[0], cz + DRUMMER[1]], Math.PI - 0.35, "idle", { body: "male", skinTone: "rich", hairstyle: "low-fade", outfit: "senator-kaftan", accessory: "cap" }, "drummer");
    const drum = this.talkingDrum();
    drummer.hold(drum, "hand");
    drummer.root.onDisposeObservable.addOnce(() => drum.dispose());
    for (let i = 0; i < 3; i++) add(200 + i, [OWAMBE_GROUND.centre[0] - 2 + i * 2, OWAMBE_GROUND.centre[1] + 2 + (i % 2)], hash01(`dance:${i}`) * Math.PI * 2, "dance");
    add(300, [OWAMBE_GROUND.centre[0] - 8.6, OWAMBE_GROUND.centre[1] + 3.6], Math.PI, "idle", { body: "male", skinTone: "deep", hairstyle: "locs", outfit: "denim-street", accessory: "glasses" });
  }

  /** Gangan: an hourglass of two cones laced with tension cords, carried under the arm. */
  private talkingDrum() {
    const drum = new TransformNode("owambe talking drum", this.scene);
    const wood = this.shade("#7a4a24", 0.12);
    const skin = this.shade("#e3cfa4", 0.18);
    const cord = this.shade("#3a2a1c", 0.05);
    for (const side of [-1, 1]) {
      const cone = MeshBuilder.CreateCylinder("talking drum half", { diameterTop: side > 0 ? 0.17 : 0.07, diameterBottom: side > 0 ? 0.07 : 0.17, height: 0.13, tessellation: 14 }, this.scene);
      cone.material = wood;
      cone.parent = drum;
      cone.position.x = side * 0.065;
      cone.rotation.z = Math.PI / 2;
      const head = MeshBuilder.CreateCylinder("talking drum head", { diameter: 0.17, height: 0.008, tessellation: 14 }, this.scene);
      head.material = skin;
      head.parent = drum;
      head.position.x = side * 0.13;
      head.rotation.z = Math.PI / 2;
    }
    for (let i = 0; i < 8; i++) {
      const turn = (i / 8) * Math.PI * 2;
      const lace = MeshBuilder.CreateBox("talking drum cord", { width: 0.26, height: 0.006, depth: 0.006 }, this.scene);
      lace.material = cord;
      lace.parent = drum;
      lace.position.set(0, Math.sin(turn) * 0.06, Math.cos(turn) * 0.06);
    }
    for (const mesh of drum.getChildMeshes()) mesh.isPickable = false;
    return drum;
  }

  /** The celebrants come down off the stage and dance while the guests spray them. */
  celebrate(seconds: number) {
    this.celebrateUntil = Math.max(this.celebrateUntil, this.time + seconds);
  }

  private clearPeople() {
    for (const guest of this.people) {
      guest.morsel?.dispose();
      guest.avatar.dispose();
    }
    this.people = [];
  }

  private teardown() {
    this.clearPeople();
    for (const waiter of this.waiters) {
      waiter.avatar.dispose();
      waiter.tray.dispose();
    }
    this.waiters = [];
    for (const meal of this.meals) this.endMeal(meal);
    this.meals = [];
    this.removeBlockers();
    this.root?.dispose(false, true);
    this.banner?.dispose();
    Object.assign(this, { root: null, banner: null, asoEbi: null, trim: null });
  }

  private morsel(dish: string) {
    const hand = owambeDish(dish)?.hand ?? false;
    const mesh = MeshBuilder.CreateSphere("owambe morsel", { diameter: hand ? 0.06 : 0.035, segments: 6 }, this.scene);
    mesh.material = this.shade(dish === "amala" ? "#5b4a3c" : dish === "pounded-yam" ? "#efe9dc" : dish === "small-chops" ? "#c58a3c" : "#d0662b", 0.1);
    mesh.isPickable = false;
    return mesh;
  }

  /** A waiter leaves the caterers' tent with a plate for a guest at their seat. */
  serve(served: Served) {
    if (!this.root) return;
    const seat = owambeTables()[served.table]?.seats[served.seat];
    if (!seat) return;
    const avatar = this.avatars.create(`owambe waiter ${served.sessionId}`, { ...appearanceFor(900 + served.table * 8 + served.seat), outfit: "office-smart", accessory: "none" });
    avatar.onMeshes = (meshes) => this.addCaster(meshes);
    equipWaiter(this.scene, avatar);
    const tray = MeshBuilder.CreateCylinder("owambe tray", { diameter: 0.42, height: 0.03 }, this.scene);
    tray.material = this.shade("#c9ccd1", 0.15);
    const cover = MeshBuilder.CreateSphere("owambe cloche", { diameter: 0.3, segments: 8, slice: 0.5 }, this.scene);
    cover.material = this.shade("#dfe2e6", 0.25);
    cover.parent = tray;
    cover.position.y = 0.015;
    cover.isPickable = false;
    tray.isPickable = false;
    const outside: Vec2 = [seat.at[0] - Math.sin(seat.yaw) * 0.7, seat.at[1] - Math.cos(seat.yaw) * 0.7];
    // Along the side of the marquee, in through the aisle between the rows, then to the guest's shoulder.
    const path: Vec2[] = [OWAMBE_KITCHEN, [OWAMBE_KITCHEN[0] - 3, OWAMBE_GROUND.centre[1] - 4.3], [outside[0], OWAMBE_GROUND.centre[1] - 4.3], outside];
    this.waiters.push({ avatar, tray, path, t: 0, serve: served, done: false });
  }

  private plate(served: Served) {
    const table = owambeTables()[served.table]!;
    const seat = table.seats[served.seat]!;
    const plate = new TransformNode("owambe plate", this.scene);
    const at: Vec2 = [seat.at[0] + (table.at[0] - seat.at[0]) * 0.42, seat.at[1] + (table.at[1] - seat.at[1]) * 0.42];
    plate.position.set(at[0], this.ground(...table.at) + 0.79, at[1]);
    plate.rotation.y = seat.yaw;
    const add = <T extends Mesh>(mesh: T, material: StandardMaterial, x: number, y: number, z: number) => {
      mesh.material = material;
      mesh.parent = plate;
      mesh.position.set(x, y, z);
      return mesh;
    };
    const china = this.shade("#ffffff", 0.3);
    add(MeshBuilder.CreateCylinder("owambe china", { diameter: 0.32, diameterBottom: 0.2, height: 0.022, tessellation: 24 }, this.scene), china, 0, 0, 0);
    add(MeshBuilder.CreateTorus("owambe china rim", { diameter: 0.3, thickness: 0.012, tessellation: 24 }, this.scene), this.shade("#d6a93a", 0.3), 0, 0.012, 0);
    const mound = (hex: string, x: number, z: number, d: number, h: number, specks?: string[]) => {
      const mesh = add(MeshBuilder.CreateSphere("owambe food", { diameter: d, segments: 10 }, this.scene), this.shade(hex, 0.12, specks), x, 0.012, z);
      mesh.scaling.y = h / d;
      return mesh;
    };
    const bowl = (x: number, z: number, soup: string, specks?: string[]) => {
      add(MeshBuilder.CreateCylinder("owambe bowl", { diameterTop: 0.16, diameterBottom: 0.09, height: 0.06, tessellation: 18 }, this.scene), china, x, 0.03, z);
      add(MeshBuilder.CreateCylinder("owambe soup", { diameter: 0.145, height: 0.006, tessellation: 18 }, this.scene), this.shade(soup, 0.12, specks), x, 0.056, z);
    };
    const meat = (x: number, z: number, hex = "#6b2b1d") => {
      const chunk = add(MeshBuilder.CreateBox("owambe meat", { width: 0.035, height: 0.025, depth: 0.03 }, this.scene), this.shade(hex, 0.08), x, 0.065, z);
      chunk.rotation.y = hash01(`meat:${x}:${z}`) * Math.PI;
    };
    /** A drumstick: a browned bulb of meat on a pale bone. */
    const leg = (x: number, z: number, hex: string, size = 1) => {
      const bulb = mound(hex, x, z, 0.075 * size, 0.045 * size);
      bulb.scaling.x = 1.5;
      const bone = add(MeshBuilder.CreateCylinder("owambe bone", { diameter: 0.012 * size, height: 0.05 * size }, this.scene), this.shade("#efe6d2", 0.2), x + 0.06 * size, 0.03, z);
      bone.rotation.z = Math.PI / 2;
    };
    const dodo = (x: number, z: number, count: number) => {
      for (let i = 0; i < count; i++) {
        const slice = add(MeshBuilder.CreateCylinder("owambe dodo", { diameter: 0.04, height: 0.012, tessellation: 10 }, this.scene), this.shade(i % 2 ? "#e1902a" : "#c8701d", 0.15), x + (i % 3) * 0.028 - 0.028, 0.02 + (i > 2 ? 0.01 : 0), z + Math.floor(i / 3) * 0.03);
        slice.scaling.x = 1.6;
        slice.rotation.y = 0.5 + i * 0.4;
      }
    };
    const dish = served.dish;
    if (dish === "amala") {
      // Amala wrapped smooth and dark, a bowl of ewedu poured over gbegiri, and assorted: beef, shaki, ponmo.
      mound("#4e3b2e", -0.05, 0, 0.13, 0.09);
      bowl(0.07, 0.02, "#d4902a", ["#2f6b2a", "#3d7f33", "#d4902a", "#a8501e"]);
      meat(0.05, 0.03);
      meat(0.09, 0.0, "#efe1c4");
      meat(0.08, 0.05, "#c9a46c");
      add(MeshBuilder.CreateCylinder("owambe water", { diameter: 0.06, height: 0.1, tessellation: 12 }, this.scene), this.shade("#bfe3f2", 0.3), -0.04, 0.05, 0.13);
    } else if (dish === "pounded-yam") {
      mound("#f1ece0", -0.05, 0, 0.13, 0.09);
      bowl(0.07, 0.02, "#d8b23e", ["#d8b23e", "#c79a2e", "#2f6b2a", "#9a3a1d"]);
      meat(0.06, 0.0);
      meat(0.09, 0.04);
      meat(0.05, 0.05, "#3a2a20");
    } else if (dish === "small-chops") {
      for (let i = 0; i < 4; i++) mound("#c07a2c", -0.07 + (i % 2) * 0.045, -0.04 + Math.floor(i / 2) * 0.045, 0.045, 0.042);
      for (let i = 0; i < 3; i++) {
        const samosa = add(MeshBuilder.CreateCylinder("owambe samosa", { diameter: 0.055, height: 0.022, tessellation: 3 }, this.scene), this.shade("#d8a24a", 0.15), 0.06, 0.024, -0.06 + i * 0.05);
        samosa.rotation.y = i;
      }
      for (let i = 0; i < 3; i++) {
        const roll = add(MeshBuilder.CreateCylinder("owambe spring roll", { diameter: 0.022, height: 0.08, tessellation: 10 }, this.scene), this.shade("#c99140", 0.15), -0.01, 0.024, 0.07 - i * 0.025);
        roll.rotation.z = Math.PI / 2;
      }
      leg(0.0, -0.09, "#9a4a1c", 0.7);
      for (let i = 0; i < 2; i++) add(MeshBuilder.CreateCylinder("owambe toothpick", { diameter: 0.003, height: 0.06 }, this.scene), this.shade("#e8d6a8", 0.2), -0.07 + i * 0.045, 0.06, -0.04);
    } else if (dish === "fried-rice") {
      mound("#d7bf6b", -0.03, 0, 0.18, 0.055, ["#e6d48c", "#f1e3a6", "#4c8a2e", "#e07a2a", "#b8322a"]);
      // Moi moi turned out of its tin, and a turkey wing in pepper sauce.
      add(MeshBuilder.CreateCylinder("owambe moi moi", { diameterTop: 0.06, diameterBottom: 0.07, height: 0.05, tessellation: 16 }, this.scene), this.shade("#d9835a", 0.15, ["#d9835a", "#c4704a", "#efe0b0"]), 0.08, 0.035, 0.05);
      leg(0.07, -0.05, "#8a3a18", 1.1);
      dodo(-0.06, 0.08, 3);
    } else {
      mound("#d4572a", -0.03, 0, 0.18, 0.055, ["#d4572a", "#e0683a", "#b9441f", "#f08a4a"]);
      leg(0.06, -0.04, "#7e3414");
      dodo(0.06, 0.05, 5);
      mound("#e9e4c9", -0.07, 0.09, 0.06, 0.025, ["#e9e4c9", "#7fae4a", "#e07a2a"]);
    }
    for (const mesh of plate.getChildMeshes()) mesh.isPickable = false;
    return plate;
  }

  private startMeal(served: Served) {
    const eater = this.eater(served.sessionId);
    const plate = this.plate(served);
    const morsel = this.morsel(served.dish);
    eater?.avatar.hold(morsel);
    this.meals.push({ serve: served, plate, morsel, until: this.time + OWAMBE.eatMs / 1_000, nextBite: this.time + 1 });
  }

  private endMeal(meal: Meal) {
    const eater = this.eater(meal.serve.sessionId);
    eater?.avatar.hold(null);
    meal.morsel.dispose();
    meal.plate.dispose();
  }

  /** The guest eating at this seat right now, if any, so their seat isn't offered to anyone else. */
  eating(sessionId: string) {
    return this.meals.some((meal) => meal.serve.sessionId === sessionId);
  }

  update(x: number, z: number, hidden: boolean, dt: number) {
    this.time += dt;
    const distance = Math.hypot(OWAMBE_GROUND.centre[0] - x, OWAMBE_GROUND.centre[1] - z);
    if (!this.root && !hidden && this.party && distance < SHOW_METRES) this.build();
    else if (this.root && distance > SHOW_METRES + 80) this.teardown();
    if (!this.root) return;
    this.root.setEnabled(!hidden);
    const near = !hidden && distance < PEOPLE_METRES;
    if (near && !this.people.length) this.spawnPeople();
    else if (!near && this.people.length) this.clearPeople();
    const celebrating = this.time < this.celebrateUntil;
    const [cx, cz] = OWAMBE_GROUND.centre;
    for (const guest of this.people) {
      const { avatar } = guest;
      if (guest.role === "celebrant" && guest.floor) {
        const pose = celebrating ? "dance" : "sit";
        if (pose !== guest.pose) {
          guest.pose = pose;
          avatar.hold(null);
          guest.morsel?.dispose();
          guest.morsel = null;
          if (pose === "dance") {
            avatar.root.position.set(guest.floor[0], this.ground(...guest.floor), guest.floor[1]);
            avatar.root.rotation.y = Math.PI;
          }
        }
        if (pose === "dance") {
          avatar.root.rotation.y = Math.PI + Math.sin(this.time * 1.7 + guest.floor[0]) * 0.6;
          avatar.update(0, "dance", dt);
          continue;
        }
      }
      if (guest.role === "singer" || guest.role === "drummer") {
        // Swaying on the spot to the band; the singer brings the microphone up for each verse.
        const home = guest.role === "singer" ? SINGER : DRUMMER;
        const sway = Math.sin(this.time * 2.2 + (guest.role === "singer" ? 0 : 1.3));
        avatar.root.position.set(cx + home[0] + sway * 0.05, this.ground(cx + home[0], cz + home[1]), cz + home[1]);
        avatar.root.rotation.y = guest.yaw + sway * 0.18;
        if (guest.role === "singer" && this.time > guest.nextBite) {
          avatar.sip(5.5);
          guest.nextBite = this.time + 7;
        }
        avatar.update(0, "idle", dt);
        continue;
      }
      avatar.update(0, guest.pose, dt);
      if (guest.pose === "sit") {
        avatar.root.position.set(guest.at[0], this.ground(...guest.at) + CHAIR_Y, guest.at[1]);
        avatar.seatHips(this.ground(...guest.at) + CHAIR_Y, guest.at);
        // Seated guests eat with their right hand, a bite every few seconds.
        if (this.time > guest.nextBite) {
          guest.morsel ??= this.morsel(hash01(`dish:${guest.at[0]}`) < 0.5 ? "amala" : "jollof");
          avatar.hold(guest.morsel);
          avatar.sip(0.9);
          guest.nextBite = this.time + 3 + hash01(`next:${guest.at[1]}:${Math.floor(this.time)}`) * 5;
        }
      }
    }
    for (const waiter of [...this.waiters]) this.walkWaiter(waiter, dt);
    for (const meal of [...this.meals]) {
      if (this.time > meal.until) {
        this.endMeal(meal);
        this.meals = this.meals.filter((entry) => entry !== meal);
        continue;
      }
      if (this.time > meal.nextBite) {
        const eater = this.eater(meal.serve.sessionId);
        eater?.avatar.hold(meal.morsel);
        eater?.avatar.sip(0.9);
        meal.nextBite = this.time + 2.6;
      }
    }
  }

  private walkWaiter(waiter: Waiter, dt: number) {
    const speed = 1.5;
    waiter.t += dt * speed;
    let remaining = waiter.t;
    const { avatar, tray } = waiter;
    for (let index = 0; index < waiter.path.length - 1; index++) {
      const a = waiter.path[index]!;
      const b = waiter.path[index + 1]!;
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (remaining <= length) {
        const f = remaining / length;
        const px = a[0] + (b[0] - a[0]) * f;
        const pz = a[1] + (b[1] - a[1]) * f;
        avatar.root.position.set(px, this.ground(px, pz), pz);
        avatar.root.rotation.y = Math.atan2(b[0] - a[0], b[1] - a[1]);
        avatar.update(speed, "walk", dt);
        const yaw = avatar.root.rotation.y;
        tray.position.set(px + Math.sin(yaw) * 0.35, avatar.root.position.y + 1.08, pz + Math.cos(yaw) * 0.35);
        return;
      }
      remaining -= length;
    }
    if (!waiter.done) {
      waiter.done = true;
      tray.dispose();
      this.startMeal(waiter.serve);
      avatar.update(0, "idle", dt);
      window.setTimeout(() => {
        avatar.dispose();
        this.waiters = this.waiters.filter((entry) => entry !== waiter);
      }, 2_000);
    }
  }
}
