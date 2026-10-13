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
import type { ClubSeat } from "./interior";

const SHOW_METRES = 220;
const PEOPLE_METRES = 80;
const CHAIR_Y = 0.47;
const MEN: OutfitId[] = ["agbada-royal", "senator-black", "aso-oke-wine", "senator-kaftan"];
const WOMEN: OutfitId[] = ["boubou-gold", "lace-wine", "gown-emerald", "ankara-dress"];

/** Every chair that is one of the neighbourhood's guests' for the whole party; residents sit in the others. */
const guestSeat = (table: number, seat: number) => hash01(`owambe-guest:${table}:${seat}`) < 0.3;

type Served = { sessionId: string; table: number; seat: number; dish: string };
type Waiter = { avatar: Avatar; tray: Mesh; path: Vec2[]; t: number; serve: Served; done: boolean };
type Meal = { serve: Served; plate: TransformNode; morsel: Mesh; until: number; nextBite: number };
type Guest = { avatar: Avatar; at: Vec2; yaw: number; pose: "sit" | "dance" | "idle"; morsel: Mesh | null; nextBite: number };

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
  readonly seats: ClubSeat[];

  constructor(
    private readonly scene: Scene,
    private readonly avatars: AvatarFactory,
    private readonly ground: (x: number, z: number) => number,
    private readonly addCaster: (meshes: AbstractMesh[]) => void,
    private readonly eater: (sessionId: string) => OwambeEater,
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
      for (const z of [-D / 2, D / 2]) part(MeshBuilder.CreateCylinder("owambe pole", { diameter: 0.12, height: H }, this.scene), steel, x, H / 2, z);
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
    const add = (seed: number, at: Vec2, yaw: number, pose: Guest["pose"], look?: CharacterAppearance) => {
      const avatar = this.avatars.create(`owambe guest ${seed}`, look ?? this.guestLook(seed + Math.floor(this.party!.startsAt / OWAMBE.partyMs)));
      avatar.onMeshes = (meshes) => this.addCaster(meshes);
      avatar.root.position.set(at[0], this.ground(...at) + (pose === "sit" ? CHAIR_Y : 0), at[1]);
      avatar.root.rotation.y = yaw;
      this.people.push({ avatar, at, yaw, pose, morsel: null, nextBite: this.time + hash01(`bite:${seed}`) * 6 });
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
    couple.forEach((look, index) => add(100 + index, [hx + (couple.length === 1 ? 0 : index ? 0.55 : -0.55), hz + 0.8], Math.PI, "sit", look));
    for (let i = 0; i < 3; i++) add(200 + i, [OWAMBE_GROUND.centre[0] - 2 + i * 2, OWAMBE_GROUND.centre[1] + 2 + (i % 2)], hash01(`dance:${i}`) * Math.PI * 2, "dance");
    add(300, [OWAMBE_GROUND.centre[0] - 8.6, OWAMBE_GROUND.centre[1] + 3.6], Math.PI, "idle", { body: "male", skinTone: "deep", hairstyle: "locs", outfit: "denim-street", accessory: "glasses" });
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
    this.root?.dispose(false, true);
    this.banner?.dispose();
    Object.assign(this, { root: null, banner: null, asoEbi: null, trim: null });
  }

  private morsel(dish: string) {
    const hand = owambeDish(dish)?.hand ?? false;
    const mesh = MeshBuilder.CreateSphere("owambe morsel", { diameter: hand ? 0.06 : 0.035, segments: 6 }, this.scene);
    mesh.material = this.material("owambe morsel", dish === "amala" ? "#5b4a3c" : dish === "pounded-yam" ? "#efe9dc" : dish === "small-chops" ? "#c58a3c" : "#d0662b", 0.1);
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
    const tray = MeshBuilder.CreateCylinder("owambe tray", { diameter: 0.42, height: 0.03 }, this.scene);
    tray.material = this.material("owambe tray", "#c9ccd1", 0.15);
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
    const china = MeshBuilder.CreateCylinder("owambe china", { diameter: 0.3, height: 0.02, tessellation: 20 }, this.scene);
    china.material = this.material("owambe china", "#ffffff", 0.3);
    china.parent = plate;
    const food = (hex: string, x: number, z: number, d: number, h: number) => {
      const mesh = MeshBuilder.CreateSphere("owambe food", { diameter: d, segments: 8 }, this.scene);
      mesh.scaling.y = h / d;
      mesh.position.set(x, 0.02, z);
      mesh.material = this.material("owambe food", hex, 0.12);
      mesh.parent = plate;
    };
    const dish = served.dish;
    if (dish === "amala") {
      food("#5b4a3c", -0.04, 0, 0.13, 0.08);
      food("#2f6b2a", 0.06, 0.05, 0.1, 0.03);
      food("#d6902c", 0.06, -0.05, 0.1, 0.03);
      food("#6b2b1d", 0.03, 0, 0.05, 0.04);
    } else if (dish === "pounded-yam") {
      food("#efe9dc", -0.04, 0, 0.13, 0.08);
      food("#c99b2e", 0.07, 0, 0.12, 0.035);
    } else if (dish === "small-chops") {
      for (let i = 0; i < 6; i++) food(i % 2 ? "#c58a3c" : "#a8642a", Math.cos(i) * 0.07, Math.sin(i) * 0.07, 0.05, 0.04);
    } else {
      food(dish === "fried-rice" ? "#d8c070" : "#d0662b", -0.03, 0, 0.17, 0.05);
      food("#8a4a22", 0.07, 0.04, 0.07, 0.05);
      food(dish === "fried-rice" ? "#d29a52" : "#e8b13a", 0.07, -0.05, 0.07, 0.03);
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
    meal.plate.dispose(false, true);
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
    for (const guest of this.people) {
      const { avatar } = guest;
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
