import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { brandColours, FUEL, FUEL_STATIONS, type CharacterAppearance, type FuelStationSite, type Vec2 } from "@lagos-living/shared";
import type { Avatar, AvatarFactory } from "./avatar";

const SHOW_METRES = 240;
const ATTENDANT: CharacterAppearance = { body: "male", skinTone: "deep", hairstyle: "low-fade", outfit: "taxi-uniform", accessory: "cap" };

type Visit = { to: Vec2; started: number; until: number };
type Station = { site: FuelStationSite; root: TransformNode | null; attendant: Avatar | null; pos: Mesh | null; home: Vec2; visit: Visit | null; price: number; board: DynamicTexture | null };

/**
 * Filling stations along the main roads: a canopy in the marketer's colours over two pumps, a price board, and an
 * attendant in uniform who walks to the driver's door with the POS when a resident buys petrol.
 */
export class FuelStationsView {
  private readonly stations = new Map<string, Station>();
  private time = 0;

  constructor(
    private readonly scene: Scene,
    private readonly avatars: AvatarFactory,
    private readonly ground: (x: number, z: number) => number,
    private readonly addCaster: (meshes: AbstractMesh[]) => void,
  ) {
    for (const site of FUEL_STATIONS) {
      // The pumps stand on the pavement; the attendant waits beside them, facing the road.
      const home = this.offset(site, 0, -1.2);
      this.stations.set(site.id, { site, root: null, attendant: null, pos: null, home, visit: null, price: FUEL.marketerPrice, board: null });
    }
  }

  /** A point `forward` metres along the road and `out` metres towards the road (negative is further onto the pavement). */
  private offset(site: FuelStationSite, forward: number, out: number): Vec2 {
    const [x, z] = site.point;
    // Traffic keeps right, so the kerb is on the right of the direction of travel and the road on its left.
    return [x + Math.sin(site.yaw) * forward - Math.cos(site.yaw) * out, z + Math.cos(site.yaw) * forward + Math.sin(site.yaw) * out];
  }

  private material(name: string, hex: string, glow = 0) {
    const material = new StandardMaterial(name, this.scene);
    material.diffuseColor = Color3.FromHexString(hex);
    material.emissiveColor = Color3.FromHexString(hex).scale(glow);
    material.specularColor = new Color3(0.1, 0.1, 0.1);
    return material;
  }

  private drawBoard(station: Station) {
    const board = station.board;
    if (!board) return;
    const context = board.getContext() as CanvasRenderingContext2D;
    const colours = brandColours(station.site.brand);
    context.fillStyle = colours.body;
    context.fillRect(0, 0, 256, 384);
    context.fillStyle = colours.trim;
    context.fillRect(0, 0, 256, 96);
    context.fillStyle = "#ffffff";
    context.textAlign = "center";
    context.font = "bold 44px sans-serif";
    context.fillText(station.site.brand === "TotalEnergies" ? "TOTAL" : station.site.brand.toUpperCase(), 128, 64);
    context.fillStyle = "#111";
    context.fillRect(20, 130, 216, 220);
    context.fillStyle = "#ffb000";
    context.font = "bold 30px monospace";
    context.fillText("PMS", 128, 180);
    context.font = "bold 58px monospace";
    context.fillText(`₦${station.price}`, 128, 260);
    context.font = "bold 22px monospace";
    context.fillText("PER LITRE", 128, 310);
    board.update();
  }

  private build(station: Station) {
    const { site } = station;
    const root = new TransformNode(`fuel station ${site.id}`, this.scene);
    const [x, z] = site.point;
    root.position.set(x, this.ground(x, z), z);
    root.rotation.y = site.yaw;
    const colours = brandColours(site.brand);
    const body = this.material(`fuel ${site.id} body`, colours.body, 0.15);
    const trim = this.material(`fuel ${site.id} trim`, colours.trim, 0.35);
    const steel = this.material(`fuel ${site.id} steel`, "#c9ccd1", 0.1);
    const glass = this.material(`fuel ${site.id} glass`, "#1b2530", 0.4);
    const parts: Mesh[] = [];
    const part = (mesh: Mesh, material: StandardMaterial, px: number, py: number, pz: number) => {
      mesh.material = material;
      mesh.parent = root;
      mesh.position.set(px, py, pz);
      mesh.isPickable = false;
      parts.push(mesh);
      return mesh;
    };
    // Local axes: +z along the road, -x towards the road.
    part(MeshBuilder.CreateBox(`fuel ${site.id} island`, { width: 1.4, height: 0.18, depth: 7 }, this.scene), steel, 0.2, 0.09, 0);
    for (const along of [-2, 2]) {
      part(MeshBuilder.CreateBox(`fuel ${site.id} pump`, { width: 0.6, height: 1.6, depth: 0.9 }, this.scene), body, 0.2, 0.98, along);
      part(MeshBuilder.CreateBox(`fuel ${site.id} pump band`, { width: 0.62, height: 0.25, depth: 0.92 }, this.scene), trim, 0.2, 1.62, along);
      part(MeshBuilder.CreateBox(`fuel ${site.id} pump screen`, { width: 0.64, height: 0.3, depth: 0.5 }, this.scene), glass, 0.2, 1.25, along);
      part(MeshBuilder.CreateCylinder(`fuel ${site.id} nozzle`, { diameter: 0.08, height: 0.5 }, this.scene), steel, -0.15, 1.05, along + 0.3);
    }
    for (const along of [-3.2, 3.2]) part(MeshBuilder.CreateCylinder(`fuel ${site.id} column`, { diameter: 0.28, height: 4.6 }, this.scene), steel, 0.2, 2.3, along);
    part(MeshBuilder.CreateBox(`fuel ${site.id} canopy`, { width: 7, height: 0.35, depth: 9 }, this.scene), body, -1.6, 4.75, 0);
    part(MeshBuilder.CreateBox(`fuel ${site.id} canopy band`, { width: 7.05, height: 0.45, depth: 9.05 }, this.scene), trim, -1.6, 4.4, 0);
    const totem = part(MeshBuilder.CreatePlane(`fuel ${site.id} board`, { width: 1.4, height: 2.1 }, this.scene), this.material(`fuel ${site.id} board`, "#ffffff", 0.6), 1.4, 2.6, -5.4);
    // Faces the road.
    totem.rotation.y = Math.PI / 2;
    station.board = new DynamicTexture(`fuel ${site.id} board`, { width: 256, height: 384 }, this.scene, true);
    const boardMaterial = totem.material as StandardMaterial;
    boardMaterial.diffuseTexture = station.board;
    boardMaterial.emissiveTexture = station.board;
    part(MeshBuilder.CreateBox(`fuel ${site.id} board post`, { width: 0.2, height: 1.6, depth: 0.2 }, this.scene), steel, 1.4, 0.8, -5.4);
    this.drawBoard(station);
    for (const mesh of parts) mesh.freezeWorldMatrix();
    this.addCaster(parts);
    station.root = root;
    const attendant = this.avatars.create(`fuel attendant ${site.id}`, ATTENDANT);
    attendant.onMeshes = (meshes) => this.addCaster(meshes);
    attendant.root.position.set(station.home[0], this.ground(...station.home), station.home[1]);
    attendant.root.rotation.y = site.yaw - Math.PI / 2;
    station.attendant = attendant;
    const pos = MeshBuilder.CreateBox(`fuel ${site.id} pos`, { width: 0.09, height: 0.17, depth: 0.03 }, this.scene);
    pos.material = this.material(`fuel ${site.id} pos`, "#20242b", 0.2);
    pos.isPickable = false;
    pos.setEnabled(false);
    station.pos = pos;
  }

  private teardown(station: Station) {
    station.root?.dispose(false, true);
    station.attendant?.dispose();
    station.pos?.dispose(false, true);
    station.board?.dispose();
    Object.assign(station, { root: null, attendant: null, pos: null, board: null });
  }

  /** Pump prices on the boards, by station id. */
  setPrices(prices: Record<string, number>) {
    for (const station of this.stations.values()) {
      const price = prices[station.site.id];
      if (price === undefined || price === station.price) continue;
      station.price = price;
      this.drawBoard(station);
    }
  }

  /** The attendant walks to the driver's door at `door` and holds out the POS until released (or 40 s pass). */
  serve(stationId: string, door: Vec2) {
    const station = this.stations.get(stationId);
    if (station) station.visit = { to: door, started: this.time, until: this.time + 40 };
  }

  /** Done at the pump: the attendant walks back to the island. */
  release(stationId: string) {
    const station = this.stations.get(stationId);
    if (station?.visit) station.visit = null;
  }

  update(x: number, z: number, hidden: boolean, dt: number) {
    this.time += dt;
    for (const station of this.stations.values()) {
      const distance = Math.hypot(station.site.point[0] - x, station.site.point[1] - z);
      if (!station.root && !hidden && distance < SHOW_METRES) this.build(station);
      else if (station.root && distance > SHOW_METRES + 80) this.teardown(station);
      if (!station.root) continue;
      station.root.setEnabled(!hidden);
      const attendant = station.attendant!;
      attendant.root.setEnabled(!hidden);
      if (hidden) continue;
      const visit = station.visit && this.time < station.visit.until ? station.visit : null;
      if (!visit) station.visit = null;
      const target = visit ? visit.to : station.home;
      const at = attendant.root.position;
      const dx = target[0] - at.x;
      const dz = target[1] - at.z;
      const gap = Math.hypot(dx, dz);
      const step = Math.min(gap, 2.2 * dt);
      if (gap > 0.05) {
        at.x += (dx / gap) * step;
        at.z += (dz / gap) * step;
        at.y = this.ground(at.x, at.z);
        attendant.root.rotation.y = Math.atan2(dx, dz);
      } else if (!visit) attendant.root.rotation.y = station.site.yaw - Math.PI / 2;
      else attendant.root.rotation.y = Math.atan2(station.home[0] - at.x, station.home[1] - at.z) + Math.PI;
      attendant.update(gap > 0.05 ? 2.2 : 0, gap > 0.05 ? "walk" : "idle", dt);
      // Arrived at the door: the POS is held out at chest height for the card tap.
      const holding = Boolean(visit) && gap < 0.4;
      station.pos!.setEnabled(holding);
      if (holding) {
        const yaw = attendant.root.rotation.y;
        station.pos!.position.set(at.x + Math.sin(yaw) * 0.35, at.y + 1.15, at.z + Math.cos(yaw) * 0.35);
        station.pos!.rotation.set(-0.6, yaw, 0);
      }
    }
  }
}
